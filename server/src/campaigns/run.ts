/**
 * Running a campaign: the power dialler, and the throttled WhatsApp send.
 *
 * The rules that decide who may be messaged are in guard.ts and are pure; this
 * is the part that talks to the database and to Meta.
 */
import type { PoolConnection } from 'mysql2/promise';
import { execute, getPool, query, queryOne, withRetryingTransaction, type Executor } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { badRequest } from '../lib/errors.js';
import { writeAudit, SYSTEM_ACTOR, type AuditActor } from '../audit/audit.js';
import { enqueue } from '../jobs/queue.js';
import { sendWhatsApp } from '../messaging/send.js';
import { moveStage } from '../services/opportunities.js';
import { resolveListContacts } from '../lists/store.js';
import {
  batchSize, DEFAULT_BULK_POLICY, describeSkipped, shouldPause, splitByEligibility,
  type ConsentCheck, type QualityRating,
} from './guard.js';

export type CampaignOutcome =
  | 'answered' | 'no_answer' | 'busy' | 'wrong_number' | 'not_interested' | 'interested';

/** Outcomes that mean the agent actually spoke to someone. */
const REACHED: CampaignOutcome[] = ['answered', 'interested', 'not_interested'];

/* ── Building a campaign ──────────────────────────────────────────────── */

export interface BuildResult {
  campaignId: string;
  total: number;
  eligible: number;
  skipped: number;
  warning: string;
}

/**
 * Fills a campaign from its list.
 *
 * A WhatsApp campaign is filtered through the consent rules here, once, and the
 * skipped count is stored — so the warning the owner confirms is the same
 * number the campaign actually acts on, not a fresh guess at send time.
 */
export async function buildMembers(
  actor: AuditActor,
  campaignId: string,
  exec: Executor = getPool(),
): Promise<BuildResult> {
  const campaign = await queryOne<{ id: string; kind: 'call' | 'whatsapp'; list_id: string | null }>(
    'SELECT id, kind, list_id FROM campaigns WHERE id = ?',
    [campaignId],
    exec,
  );
  if (!campaign) throw badRequest('That campaign does not exist');
  if (!campaign.list_id) throw badRequest('That campaign has no list');

  // Goes through resolveListContacts so a smart list works too: it has no
  // stored members, and reading list_members directly would build a campaign
  // of nobody.
  const contacts = await resolveListContacts(campaign.list_id, exec);

  const checks: ConsentCheck[] = contacts.map((row) => ({
    contactId: row.contact_id,
    dnc: row.dnc === 1,
    whatsappConsent: Number(row.consented) === 1,
    hasWaId: Boolean(row.wa_id),
  }));

  // A call campaign only has to respect the do-not-contact list; consent for
  // WhatsApp is not consent to be phoned, and vice versa.
  const split =
    campaign.kind === 'whatsapp'
      ? splitByEligibility(checks)
      : {
          eligible: checks.filter((check) => !check.dnc).map((check) => check.contactId),
          skipped: checks
            .filter((check) => check.dnc)
            .map((check) => ({ contactId: check.contactId, reason: 'On the do-not-contact list' })),
        };

  const byContact = new Map(contacts.map((row) => [row.contact_id, row]));
  let position = 0;
  for (const contactId of split.eligible) {
    const row = byContact.get(contactId);
    await execute(
      `INSERT INTO campaign_members (id, campaign_id, contact_id, opportunity_id, assigned_user_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)`,
      [newId(), campaignId, contactId, row?.opportunity_id ?? null, row?.owner_user_id ?? null, position++],
      exec,
    );
  }
  for (const entry of split.skipped) {
    const row = byContact.get(entry.contactId);
    await execute(
      `INSERT INTO campaign_members (id, campaign_id, contact_id, opportunity_id, status, skip_reason, sort_order)
       VALUES (?, ?, ?, ?, 'skipped', ?, ?)
       ON DUPLICATE KEY UPDATE status = 'skipped', skip_reason = VALUES(skip_reason)`,
      [newId(), campaignId, entry.contactId, row?.opportunity_id ?? null, entry.reason, position++],
      exec,
    );
  }

  const warning = describeSkipped(split);
  await execute(
    'UPDATE campaigns SET total_members = ?, skipped_no_consent = ? WHERE id = ?',
    [split.eligible.length, split.skipped.length, campaignId],
    exec,
  );
  await writeAudit(
    {
      actor,
      action: 'campaign.built',
      entityType: 'campaign',
      entityId: campaignId,
      after: { eligible: split.eligible.length, skipped: split.skipped.length },
    },
    exec,
  );

  return {
    campaignId,
    total: checks.length,
    eligible: split.eligible.length,
    skipped: split.skipped.length,
    warning,
  };
}

/* ── The power dialler ────────────────────────────────────────────────── */

export interface DiallerCard {
  memberId: string;
  contactId: string;
  opportunityId: string | null;
  fullName: string | null;
  phone: string | null;
  language: string | null;
  leadScore: number;
  projectName: string | null;
  budgetBand: string | null;
  budgetMinAed: number | null;
  budgetMaxAed: number | null;
  stageKey: string | null;
  lastContactedAt: string | null;
  attempts: number;
  progress: { done: number; total: number };
}

/**
 * Hands the agent the next lead to call.
 *
 * Locked and marked in progress in one transaction, so two agents working the
 * same campaign never get the same person — which is the whole point of a
 * dialler and the fastest way to annoy a lead if it goes wrong.
 */
export async function nextForAgent(
  campaignId: string,
  userId: string,
  /**
   * Managers and owners may work any row on the campaign, not just their own
   * and the unassigned ones — they run the campaign, and a desk of leads
   * belonging to an agent who is off today should not stall it. An agent never
   * gets handed a colleague's lead.
   */
  options: { includeOthers?: boolean } = {},
): Promise<DiallerCard | null> {
  return withRetryingTransaction(async (tx: PoolConnection) => {
    /*
     * Two plain LIMIT 1 queries, not one clever query.
     *
     * `FOR UPDATE SKIP LOCKED` only skips rows another session already holds.
     * Anything this statement *returns* it locks — so `LIMIT 25` would lock 25
     * rows and starve every other agent, and an `ORDER BY` on an expression
     * forces a filesort that reads and locks the whole matching set before it
     * can sort. Either one hands the first agent the entire queue.
     *
     * Ordering straight along idx_campaign_member_work with LIMIT 1 locks
     * exactly one row, which is what lets four agents on one campaign get four
     * different people. Preferring an agent's own leads is therefore a separate
     * query rather than a term in the sort.
     */
    const claim = async (scope: 'mine' | 'unassigned' | 'any') =>
      queryOne<{ id: string; contact_id: string; opportunity_id: string | null; attempts: number }>(
        `SELECT id, contact_id, opportunity_id, attempts
           FROM campaign_members
          WHERE campaign_id = ? AND status = 'pending'
            ${scope === 'mine' ? 'AND assigned_user_id = ?' : ''}
            ${scope === 'unassigned' ? 'AND assigned_user_id IS NULL' : ''}
          ORDER BY sort_order ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        scope === 'mine' ? [campaignId, userId] : [campaignId],
        tx,
      );

    const member =
      (await claim('mine')) ??
      (await claim('unassigned')) ??
      (options.includeOthers ? await claim('any') : undefined);
    if (!member) return null;

    await execute(
      `UPDATE campaign_members
          SET status = 'in_progress', assigned_user_id = ?, attempts = attempts + 1, last_attempt_at = NOW(3)
        WHERE id = ?`,
      [userId, member.id],
      tx,
    );

    const detail = await queryOne<{
      full_name: string | null; phone_e164: string | null; language: string | null; lead_score: number;
      project_name: string | null; budget_band: string | null;
      budget_min_aed: number | null; budget_max_aed: number | null;
      stage_key: string | null; last_contacted_at: string | null;
    }>(
      `SELECT c.full_name, c.phone_e164, c.language, c.lead_score,
              o.project_name, o.budget_band, o.budget_min_aed, o.budget_max_aed, o.stage_key,
              -- NULLIF keeps "never contacted" as null. GREATEST over two
              -- COALESCEd epochs would report 1 Jan 1970 instead, which reads
              -- on screen as a date rather than as "never".
              NULLIF(
                GREATEST(COALESCE(c.last_inbound_at, '1970-01-01'), COALESCE(o.first_touch_at, '1970-01-01')),
                '1970-01-01'
              ) AS last_contacted_at
         FROM contacts c
         LEFT JOIN opportunities o ON o.id = ?
        WHERE c.id = ?`,
      [member.opportunity_id, member.contact_id],
      tx,
    );

    const progress = await queryOne<{ done: number; total: number }>(
      `SELECT SUM(CASE WHEN status IN ('done','skipped','failed') THEN 1 ELSE 0 END) AS done,
              COUNT(*) AS total
         FROM campaign_members WHERE campaign_id = ?`,
      [campaignId],
      tx,
    );

    return {
      memberId: member.id,
      contactId: member.contact_id,
      opportunityId: member.opportunity_id,
      fullName: detail?.full_name ?? null,
      phone: detail?.phone_e164 ?? null,
      language: detail?.language ?? null,
      leadScore: Number(detail?.lead_score ?? 0),
      projectName: detail?.project_name ?? null,
      budgetBand: detail?.budget_band ?? null,
      budgetMinAed: detail?.budget_min_aed === null || detail?.budget_min_aed === undefined ? null : Number(detail.budget_min_aed),
      budgetMaxAed: detail?.budget_max_aed === null || detail?.budget_max_aed === undefined ? null : Number(detail.budget_max_aed),
      stageKey: detail?.stage_key ?? null,
      lastContactedAt: detail?.last_contacted_at ?? null,
      attempts: Number(member.attempts ?? 0) + 1,
      progress: { done: Number(progress?.done ?? 0), total: Number(progress?.total ?? 0) },
    };
  });
}

/**
 * Records what happened on the call.
 *
 * "Interested" is the one outcome that changes the pipeline: the lead moves to
 * Engaged / Qualified, which is what the specification means by an interested
 * lead moving into the main pipeline. Everything else is recorded and the
 * dialler moves on.
 */
export async function logOutcome(
  actor: AuditActor,
  memberId: string,
  outcome: CampaignOutcome,
  notes: string | null,
  exec: Executor = getPool(),
): Promise<void> {
  const member = await queryOne<{
    id: string; campaign_id: string; contact_id: string; opportunity_id: string | null;
  }>(
    'SELECT id, campaign_id, contact_id, opportunity_id FROM campaign_members WHERE id = ?',
    [memberId],
    exec,
  );
  if (!member) throw badRequest('That campaign row does not exist');

  await execute(
    "UPDATE campaign_members SET status = 'done', outcome = ?, notes = ?, completed_at = NOW(3) WHERE id = ?",
    [outcome, notes, memberId],
    exec,
  );

  await execute(
    `INSERT INTO activities (id, contact_id, opportunity_id, user_id, type, title, body, created_at)
     VALUES (?, ?, ?, ?, 'call.logged', ?, ?, NOW(3))`,
    [
      newId(),
      member.contact_id,
      member.opportunity_id,
      actor.userId,
      `Call outcome: ${outcome.replace(/_/g, ' ')}`,
      notes,
    ],
    exec,
  );

  if (outcome === 'interested' && member.opportunity_id && actor.role) {
    try {
      await moveStage({
        opportunityId: member.opportunity_id,
        to: 'engaged_qualified',
        subStatus: 'engaged',
        actor: { ...actor, role: actor.role },
        actingUserId: actor.userId,
      });
    } catch (err) {
      // A lead already further along the pipeline cannot move back to Engaged,
      // and that is not a reason to lose the call outcome we just recorded.
      logger.info('campaign outcome did not move the stage', {
        opportunityId: member.opportunity_id,
        error: String(err),
      });
    }
  }

  if (outcome === 'wrong_number') {
    await execute(
      `INSERT INTO activities (id, contact_id, type, title, created_at)
       VALUES (?, ?, 'contact.flagged', 'Wrong number reported on a campaign call', NOW(3))`,
      [newId(), member.contact_id],
      exec,
    );
  }

  await writeAudit(
    {
      actor,
      action: 'campaign.outcome',
      entityType: 'campaign',
      entityId: member.campaign_id,
      after: { contactId: member.contact_id, outcome },
    },
    exec,
  );
}

/** Puts a lead back in the queue, e.g. the agent had to stop mid-call. */
export async function releaseMember(memberId: string, exec: Executor = getPool()): Promise<void> {
  await execute(
    "UPDATE campaign_members SET status = 'pending' WHERE id = ? AND status = 'in_progress'",
    [memberId],
    exec,
  );
}

/* ── The WhatsApp send ────────────────────────────────────────────────── */

/** The quality Meta last reported for this campaign's template. */
async function templateQuality(
  templateName: string | null,
  language: string | null,
  exec: Executor,
): Promise<QualityRating> {
  if (!templateName) return 'UNKNOWN';
  const row = await queryOne<{ quality_score: string | null; status: string }>(
    'SELECT quality_score, status FROM wa_templates WHERE name = ? AND language = ?',
    [templateName, language ?? 'en'],
    exec,
  );
  if (!row) return 'UNKNOWN';
  // A template Meta has paused is as bad as a red rating.
  if (row.status === 'PAUSED' || row.status === 'DISABLED' || row.status === 'REJECTED') return 'RED';
  const score = (row.quality_score ?? '').toUpperCase();
  if (score.includes('RED')) return 'RED';
  if (score.includes('YELLOW')) return 'YELLOW';
  if (score.includes('GREEN')) return 'GREEN';
  return 'UNKNOWN';
}

export async function pauseCampaign(
  actor: AuditActor,
  campaignId: string,
  reason: string,
  exec: Executor = getPool(),
): Promise<void> {
  await execute(
    "UPDATE campaigns SET status = 'paused', paused_reason = ? WHERE id = ? AND status = 'running'",
    [reason.slice(0, 250), campaignId],
    exec,
  );
  await writeAudit(
    { actor, action: 'campaign.paused', entityType: 'campaign', entityId: campaignId, after: { reason } },
    exec,
  );
  logger.warn('campaign paused', { campaignId, reason });
}

export interface BatchResult {
  sent: number;
  failed: number;
  remaining: number;
  paused: boolean;
  pauseReason?: string;
}

/**
 * Sends one throttled batch of a WhatsApp campaign and schedules the next.
 *
 * Before every batch it re-checks the quality rating and the failure rate, so a
 * campaign that starts healthy and turns bad stops within a minute rather than
 * running to the end of a list of four thousand.
 */
export async function sendBatch(campaignId: string, exec: Executor = getPool()): Promise<BatchResult> {
  const campaign = await queryOne<{
    id: string; status: string; template_name: string | null; template_language: string | null;
    throttle_per_minute: number;
  }>(
    'SELECT id, status, template_name, template_language, throttle_per_minute FROM campaigns WHERE id = ?',
    [campaignId],
    exec,
  );
  if (!campaign) throw badRequest('That campaign does not exist');
  if (campaign.status !== 'running') return { sent: 0, failed: 0, remaining: 0, paused: true };
  if (!campaign.template_name) {
    // Outside the 24-hour window Meta accepts nothing else, so a campaign with
    // no template can never send and must not pretend to be running.
    await pauseCampaign(SYSTEM_ACTOR, campaignId, 'No approved template is selected', exec);
    return { sent: 0, failed: 0, remaining: 0, paused: true, pauseReason: 'No approved template is selected' };
  }

  const health = await queryOne<{ attempted: number; failed: number }>(
    `SELECT SUM(CASE WHEN status IN ('sent','failed') THEN 1 ELSE 0 END) AS attempted,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM campaign_members WHERE campaign_id = ?`,
    [campaignId],
    exec,
  );
  const quality = await templateQuality(campaign.template_name, campaign.template_language, exec);
  const decision = shouldPause({
    quality,
    attempted: Number(health?.attempted ?? 0),
    failed: Number(health?.failed ?? 0),
  });
  if (decision.pause) {
    await pauseCampaign(SYSTEM_ACTOR, campaignId, decision.reason, exec);
    return { sent: 0, failed: 0, remaining: 0, paused: true, pauseReason: decision.reason };
  }

  const policy = { ...DEFAULT_BULK_POLICY, throttlePerMinute: campaign.throttle_per_minute };
  const members = await query<{ id: string; contact_id: string; opportunity_id: string | null; full_name: string | null }>(
    `SELECT cm.id, cm.contact_id, cm.opportunity_id, c.full_name
       FROM campaign_members cm JOIN contacts c ON c.id = cm.contact_id
      WHERE cm.campaign_id = ? AND cm.status = 'pending'
      ORDER BY cm.sort_order
      LIMIT ${batchSize(policy)}`,
    [campaignId],
    exec,
  );

  let sent = 0;
  let failed = 0;

  for (const member of members) {
    // Every message still goes through sendWhatsApp, so quiet hours, the
    // three-a-day cap and the bot pause all apply on top of the bulk guard.
    const outcome = await sendWhatsApp({
      contactId: member.contact_id,
      automated: true,
      kind: 'template',
      templateName: campaign.template_name,
      templateLanguage: campaign.template_language ?? 'en',
      bodyParams: [member.full_name ?? 'there'],
      opportunityId: member.opportunity_id,
    });

    if (outcome.sent) {
      await execute("UPDATE campaign_members SET status = 'sent', last_attempt_at = NOW(3), attempts = attempts + 1 WHERE id = ?", [member.id], exec);
      sent += 1;
    } else if ('blocked' in outcome) {
      // A guard refused it — quiet hours, the daily cap, consent withdrawn
      // since the campaign was built. Recorded, not counted as a failure,
      // because nothing went wrong with the number.
      await execute(
        "UPDATE campaign_members SET status = 'skipped', skip_reason = ?, last_attempt_at = NOW(3) WHERE id = ?",
        [outcome.blocked.message.slice(0, 150), member.id],
        exec,
      );
    } else {
      await execute("UPDATE campaign_members SET status = 'failed', last_attempt_at = NOW(3), attempts = attempts + 1 WHERE id = ?", [member.id], exec);
      failed += 1;
    }
  }

  const remaining = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM campaign_members WHERE campaign_id = ? AND status = 'pending'",
    [campaignId],
    exec,
  );
  const left = Number(remaining?.n ?? 0);

  if (left > 0) {
    // One batch a minute is the throttle.
    await enqueue(
      'campaign.send_batch',
      { campaignId },
      { runAt: new Date(Date.now() + 60_000), dedupeKey: `campaign-batch:${campaignId}:${Date.now()}` },
    );
  } else {
    await execute("UPDATE campaigns SET status = 'completed', finished_at = NOW(3) WHERE id = ?", [campaignId], exec);
  }

  return { sent, failed, remaining: left, paused: false };
}

/* ── Reporting ────────────────────────────────────────────────────────── */

export interface CampaignStats {
  total: number;
  done: number;
  pending: number;
  skipped: number;
  contactedPct: number;
  reachedPct: number;
  interested: number;
  appointments: number;
  byAgent: {
    userId: string | null;
    name: string | null;
    done: number;
    reached: number;
    interested: number;
  }[];
  outcomes: { outcome: string; n: number }[];
}

export async function campaignStats(campaignId: string, exec: Executor = getPool()): Promise<CampaignStats> {
  const totals = await queryOne<{
    total: number; done: number; pending: number; skipped: number; reached: number; interested: number;
  }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status IN ('done','sent') THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN status IN ('pending','in_progress') THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN outcome IN ('answered','interested','not_interested') THEN 1 ELSE 0 END) AS reached,
            SUM(CASE WHEN outcome = 'interested' THEN 1 ELSE 0 END) AS interested
       FROM campaign_members WHERE campaign_id = ?`,
    [campaignId],
    exec,
  );

  const appointments = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM campaign_members cm JOIN opportunities o ON o.id = cm.opportunity_id
      WHERE cm.campaign_id = ? AND o.stage_key IN ('appointment_scheduled','deal_sent','won')`,
    [campaignId],
    exec,
  );

  const byAgent = await query<{
    user_id: string | null; name: string | null; done: number; reached: number; interested: number;
  }>(
    `SELECT cm.assigned_user_id AS user_id, u.name,
            SUM(CASE WHEN cm.status IN ('done','sent') THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN cm.outcome IN ('answered','interested','not_interested') THEN 1 ELSE 0 END) AS reached,
            SUM(CASE WHEN cm.outcome = 'interested' THEN 1 ELSE 0 END) AS interested
       FROM campaign_members cm LEFT JOIN users u ON u.id = cm.assigned_user_id
      WHERE cm.campaign_id = ?
      GROUP BY cm.assigned_user_id, u.name
      ORDER BY interested DESC, done DESC`,
    [campaignId],
    exec,
  );

  const outcomes = await query<{ outcome: string; n: number }>(
    'SELECT outcome, COUNT(*) AS n FROM campaign_members WHERE campaign_id = ? AND outcome IS NOT NULL GROUP BY outcome',
    [campaignId],
    exec,
  );

  const total = Number(totals?.total ?? 0);
  const done = Number(totals?.done ?? 0);
  const workable = total - Number(totals?.skipped ?? 0);

  return {
    total,
    done,
    pending: Number(totals?.pending ?? 0),
    skipped: Number(totals?.skipped ?? 0),
    // Contacted counts attempts; reached counts the ones who answered.
    contactedPct: workable > 0 ? Math.round((done / workable) * 100) : 0,
    reachedPct: done > 0 ? Math.round((Number(totals?.reached ?? 0) / done) * 100) : 0,
    interested: Number(totals?.interested ?? 0),
    appointments: Number(appointments?.n ?? 0),
    byAgent: byAgent.map((row) => ({
      userId: row.user_id,
      name: row.name,
      done: Number(row.done ?? 0),
      reached: Number(row.reached ?? 0),
      interested: Number(row.interested ?? 0),
    })),
    outcomes: outcomes.map((row) => ({ outcome: row.outcome, n: Number(row.n) })),
  };
}

export { REACHED };
