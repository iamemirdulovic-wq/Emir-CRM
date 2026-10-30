/**
 * Email campaigns: the same email to a list, slowly.
 *
 * The things that go wrong with bulk email are not subtle, and each one has
 * a specific answer here:
 *
 * - **Emailing someone who opted out.** Every member goes through the same
 *   guards as a one-to-one send. Nothing has a fast path round them.
 * - **Emailing the same person twice.** A unique key on (campaign, contact),
 *   and the member row is claimed before the send rather than after, so a
 *   retried job finds it already taken.
 * - **Sending a thousand in a minute and being blocked.** A throttle per
 *   hour, enforced by scheduling the next batch rather than by sleeping.
 * - **Nobody noticing a campaign is doing badly.** Bounces and complaints
 *   are counted and the campaign pauses itself when they get high.
 */
import { randomUUID } from 'node:crypto';
import { execute, query, queryOne, type Executor, getPool } from '../db/client.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { logger, errorContext } from '../lib/logger.js';
import { enqueue } from '../jobs/queue.js';
import { sendClientEmail } from './send-client.js';

/** How many go out in one pass of the job. */
export const BATCH_SIZE = 25;

/**
 * Pause the campaign if this fraction of what has been sent bounces.
 *
 * Five per cent is where mailbox providers start treating a sender as a
 * problem. Below that it is a bad list; above it, carrying on damages the
 * domain for every other email the brokerage sends, including the one-to-one
 * replies that actually matter.
 */
export const BOUNCE_PAUSE_RATE = 0.05;
/** Not applied until there is enough sent for the rate to mean anything. */
export const BOUNCE_PAUSE_MIN_SENT = 20;

export interface CampaignRow {
  id: string;
  name: string;
  list_id: string | null;
  subject: string;
  body: string;
  preview_text: string | null;
  from_user_id: string | null;
  status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'cancelled';
  scheduled_at: string | null;
  throttle_per_hour: number;
  total_members: number;
  skipped_no_consent: number;
  sent_count: number;
  opened_count: number;
  clicked_count: number;
  bounced_count: number;
  unsubscribed_count: number;
  failed_count: number;
}

export async function getCampaign(id: string, exec: Executor = getPool()): Promise<CampaignRow | null> {
  return queryOne<CampaignRow>(
    `SELECT id, name, list_id, subject, body, preview_text, from_user_id, status, scheduled_at,
            throttle_per_hour, total_members, skipped_no_consent, sent_count, opened_count,
            clicked_count, bounced_count, unsubscribed_count, failed_count
       FROM email_campaigns WHERE id = ? AND deleted_at IS NULL`,
    [id],
    exec,
  );
}

/**
 * Work out who would receive it, and say who would not and why.
 *
 * Run before sending and shown in the UI, because "this will go to 812 people
 * and skip 94 who never agreed to be emailed" is the last moment anyone can
 * change their mind.
 */
export interface Audience {
  willReceive: number;
  skipped: Array<{ reason: string; count: number }>;
}

export async function audienceFor(listId: string, exec: Executor = getPool()): Promise<Audience> {
  const row = await queryOne<{
    total: number; no_email: number; dnc: number; no_consent: number; suppressed: number;
  }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN c.email IS NULL OR c.email = '' THEN 1 ELSE 0 END) AS no_email,
       SUM(CASE WHEN c.dnc = 1 THEN 1 ELSE 0 END) AS dnc,
       SUM(CASE WHEN NOT EXISTS (
             SELECT 1 FROM consents cs
              WHERE cs.contact_id = c.id AND cs.channel IN ('email','all') AND cs.granted = 1
                AND cs.created_at = (SELECT MAX(cs2.created_at) FROM consents cs2
                                      WHERE cs2.contact_id = c.id AND cs2.channel = cs.channel)
           ) THEN 1 ELSE 0 END) AS no_consent,
       SUM(CASE WHEN EXISTS (
             SELECT 1 FROM suppressions s WHERE s.kind = 'email' AND s.value = c.email
           ) THEN 1 ELSE 0 END) AS suppressed
     FROM list_members lm
     JOIN contacts c ON c.id = lm.contact_id
    WHERE lm.list_id = ? AND c.deleted_at IS NULL`,
    [listId],
    exec,
  );

  const total = Number(row?.total ?? 0);
  const skipped = [
    { reason: 'No email address', count: Number(row?.no_email ?? 0) },
    { reason: 'On the do-not-contact list', count: Number(row?.dnc ?? 0) },
    { reason: 'Never agreed to be emailed', count: Number(row?.no_consent ?? 0) },
    { reason: 'Unsubscribed', count: Number(row?.suppressed ?? 0) },
  ].filter((entry) => entry.count > 0);

  /* Deliberately not subtracting the skip counts from the total: one person
     can fall into two of them, so the sum would double-count. The real
     number is settled when the members are staged. */
  return { willReceive: total, skipped };
}

/**
 * Freeze the audience into member rows.
 *
 * Done once, when the campaign starts, so that a list someone edits halfway
 * through does not change who is mid-send. Contacts with no address are
 * recorded as skipped rather than dropped, so the report adds up.
 */
export async function stageMembers(campaignId: string, listId: string): Promise<{ staged: number; skipped: number }> {
  const contacts = await query<{ id: string; email: string | null }>(
    `SELECT c.id, c.email
       FROM list_members lm
       JOIN contacts c ON c.id = lm.contact_id
      WHERE lm.list_id = ? AND c.deleted_at IS NULL`,
    [listId],
  );

  let staged = 0;
  let skipped = 0;

  for (const contact of contacts) {
    const hasEmail = Boolean(contact.email && contact.email.trim());
    await execute(
      `INSERT IGNORE INTO email_campaign_members (id, campaign_id, contact_id, status, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [
        randomUUID(), campaignId, contact.id,
        hasEmail ? 'pending' : 'skipped',
        hasEmail ? null : 'No email address',
      ],
    );
    if (hasEmail) staged += 1;
    else skipped += 1;
  }

  await execute(
    'UPDATE email_campaigns SET total_members = ?, skipped_no_consent = ? WHERE id = ?',
    [staged, skipped, campaignId],
  );
  return { staged, skipped };
}

export async function startCampaign(actor: AuditActor, campaignId: string): Promise<void> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw Object.assign(new Error('That campaign does not exist'), { status: 404 });
  if (campaign.status === 'sending') return;
  if (!campaign.list_id) {
    throw Object.assign(new Error('Choose a list before sending'), { status: 400 });
  }

  await stageMembers(campaignId, campaign.list_id);
  await execute(
    "UPDATE email_campaigns SET status = 'sending', started_at = COALESCE(started_at, NOW(3)) WHERE id = ?",
    [campaignId],
  );
  await writeAudit({
    actor, action: 'email_campaign.started', entityType: 'email_campaign', entityId: campaignId,
    after: { name: campaign.name, members: campaign.total_members },
  });
  await enqueue('email.campaign_batch', { campaignId }, {
    priority: 6, dedupeKey: `email-campaign:${campaignId}`,
  });
}

export async function pauseCampaign(actor: AuditActor, campaignId: string, reason: string): Promise<void> {
  await execute("UPDATE email_campaigns SET status = 'paused' WHERE id = ? AND status = 'sending'", [campaignId]);
  await writeAudit({
    actor, action: 'email_campaign.paused', entityType: 'email_campaign', entityId: campaignId,
    after: { reason },
  });
  logger.info('email campaign paused', { campaignId, reason });
}

/**
 * Send one batch, then ask to be woken for the next.
 *
 * Scheduling rather than sleeping: a worker asleep for twenty minutes is a
 * worker not doing anything else, and a process restart in the middle of it
 * loses the campaign.
 */
export async function runCampaignBatch(campaignId: string): Promise<{ sent: number; done: boolean }> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) return { sent: 0, done: true };
  if (campaign.status !== 'sending') {
    logger.info('campaign batch skipped: it is not sending', { campaignId, status: campaign.status });
    return { sent: 0, done: true };
  }

  const members = await query<{ id: string; contact_id: string }>(
    `SELECT id, contact_id FROM email_campaign_members
      WHERE campaign_id = ? AND status = 'pending'
      ORDER BY created_at LIMIT ?`,
    [campaignId, BATCH_SIZE],
  );

  if (members.length === 0) {
    await execute(
      "UPDATE email_campaigns SET status = 'sent', finished_at = NOW(3) WHERE id = ? AND status = 'sending'",
      [campaignId],
    );
    logger.info('email campaign finished', { campaignId, sent: campaign.sent_count });
    return { sent: 0, done: true };
  }

  let sent = 0;
  for (const member of members) {
    /*
     * Claim the row before sending. If this update changes nothing, another
     * worker already has it — which is the only thing standing between a
     * retried job and a client receiving the same email twice.
     */
    const claim = await execute(
      "UPDATE email_campaign_members SET status = 'sent', sent_at = NOW(3) WHERE id = ? AND status = 'pending'",
      [member.id],
    );
    if (claim.affectedRows === 0) continue;

    try {
      const outcome = await sendClientEmail({
        contactId: member.contact_id,
        userId: campaign.from_user_id,
        subject: campaign.subject,
        body: campaign.body,
        previewText: campaign.preview_text,
        campaignId,
        automated: true,
      });

      if (outcome.sent) {
        sent += 1;
        await execute(
          `UPDATE email_campaign_members SET message_id = ? WHERE id = ?`,
          ['messageId' in outcome ? outcome.messageId : null, member.id],
        );
      } else {
        const reason = 'blocked' in outcome
          ? outcome.blocked.message
          : 'The provider would not take it';
        await execute(
          "UPDATE email_campaign_members SET status = 'skipped', reason = ? WHERE id = ?",
          [reason.slice(0, 160), member.id],
        );
      }
    } catch (err) {
      /* One contact failing must never stop the campaign; the row records it
         and the batch carries on. */
      logger.warn('a campaign email threw', { campaignId, contactId: member.contact_id, ...errorContext(err) });
      await execute(
        "UPDATE email_campaign_members SET status = 'failed', reason = ? WHERE id = ?",
        [(err instanceof Error ? err.message : 'Unknown error').slice(0, 160), member.id],
      );
    }
  }

  await execute(
    `UPDATE email_campaigns ec
        SET sent_count = (SELECT COUNT(*) FROM email_campaign_members
                           WHERE campaign_id = ec.id AND status = 'sent'),
            failed_count = (SELECT COUNT(*) FROM email_campaign_members
                             WHERE campaign_id = ec.id AND status = 'failed')
      WHERE ec.id = ?`,
    [campaignId],
  );

  if (await shouldPauseForBounces(campaignId)) {
    await execute("UPDATE email_campaigns SET status = 'paused' WHERE id = ?", [campaignId]);
    logger.warn('email campaign paused itself: too many bounces', { campaignId });
    return { sent, done: true };
  }

  /* The next batch, spaced so the hourly throttle is respected. */
  const perHour = Math.max(1, campaign.throttle_per_hour);
  const delayMs = Math.round((BATCH_SIZE / perHour) * 60 * 60 * 1000);
  await enqueue('email.campaign_batch', { campaignId }, {
    priority: 6,
    runAt: new Date(Date.now() + delayMs),
    dedupeKey: `email-campaign:${campaignId}`,
  });

  return { sent, done: false };
}

/** Is this campaign bouncing badly enough to stop? */
export async function shouldPauseForBounces(
  campaignId: string,
  exec: Executor = getPool(),
): Promise<boolean> {
  const row = await queryOne<{ sent_count: number; bounced_count: number }>(
    'SELECT sent_count, bounced_count FROM email_campaigns WHERE id = ?',
    [campaignId],
    exec,
  );
  if (!row) return false;
  return bounceRateTooHigh(Number(row.sent_count), Number(row.bounced_count));
}

/** Pure, so the rule can be read and tested without a database. */
export function bounceRateTooHigh(sent: number, bounced: number): boolean {
  if (sent < BOUNCE_PAUSE_MIN_SENT) return false;
  return bounced / sent >= BOUNCE_PAUSE_RATE;
}

/** How long a whole campaign will take, so the UI can say so before it starts. */
export function estimatedMinutes(members: number, throttlePerHour: number): number {
  if (members <= 0) return 0;
  const perHour = Math.max(1, throttlePerHour);
  return Math.ceil((members / perHour) * 60);
}
