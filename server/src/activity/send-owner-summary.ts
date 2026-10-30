/**
 * Gathering yesterday's numbers and mailing them to the owners.
 *
 * Everything here is counted in Dubai time, because "yesterday" to an owner
 * in Dubai is not the UTC day. Getting that wrong would put the last four
 * hours of every evening into the wrong report, which in this business is
 * most of the evening's work.
 */
import { query, queryOne } from '../db/client.js';
import { env } from '../config/env.js';
import { logger, errorContext } from '../lib/logger.js';
import { sendInternalEmail } from '../messaging/email/internal.js';
import { buildOwnerSummary, summaryText, type SummaryNumbers } from './owner-summary.js';

/** Yesterday, in Dubai, as a date string for the subject line. */
export function yesterdayInDubai(now: Date = new Date()): string {
  const dubai = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  dubai.setUTCDate(dubai.getUTCDate() - 1);
  return dubai.toISOString().slice(0, 10);
}

/** The window for "yesterday", in UTC, so the SQL can use it directly. */
export function yesterdayWindow(now: Date = new Date()): { from: Date; to: Date } {
  const dubai = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const startOfDubaiToday = Date.UTC(
    dubai.getUTCFullYear(), dubai.getUTCMonth(), dubai.getUTCDate(),
  ) - 4 * 60 * 60 * 1000;
  return {
    from: new Date(startOfDubaiToday - 24 * 60 * 60 * 1000),
    to: new Date(startOfDubaiToday),
  };
}

export async function gatherSummaryNumbers(now: Date = new Date()): Promise<SummaryNumbers> {
  const { from, to } = yesterdayWindow(now);
  const dayBefore = new Date(from.getTime() - 24 * 60 * 60 * 1000);

  const leads = await queryOne<{
    new_leads: number; previous: number; contacted: number; unassigned: number;
  }>(
    `SELECT
       SUM(CASE WHEN o.created_at >= ? AND o.created_at < ? THEN 1 ELSE 0 END) AS new_leads,
       SUM(CASE WHEN o.created_at >= ? AND o.created_at < ? THEN 1 ELSE 0 END) AS previous,
       SUM(CASE WHEN o.created_at >= ? AND o.created_at < ?
                 AND o.last_contact_at IS NOT NULL THEN 1 ELSE 0 END) AS contacted,
       SUM(CASE WHEN o.created_at >= ? AND o.created_at < ?
                 AND o.owner_user_id IS NULL THEN 1 ELSE 0 END) AS unassigned
     FROM opportunities o
    WHERE o.deleted_at IS NULL AND o.created_at >= ?`,
    [from, to, dayBefore, from, from, to, from, to, dayBefore],
  );

  const stages = await queryOne<{ appointments: number; reservations: number }>(
    `SELECT
       SUM(CASE WHEN a.type = 'stage_changed' AND a.title LIKE '%ppointment%' THEN 1 ELSE 0 END) AS appointments,
       SUM(CASE WHEN a.type = 'stage_changed' AND a.title LIKE '%on%' AND a.title LIKE '%eserv%' THEN 1 ELSE 0 END) AS reservations
     FROM activities a
    WHERE a.created_at >= ? AND a.created_at < ?`,
    [from, to],
  );

  const open = await queryOne<{ overdue: number; no_next_step: number }>(
    `SELECT
       SUM(CASE WHEN o.next_step_at IS NOT NULL AND o.next_step_at < NOW(3) THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN o.next_step_at IS NULL THEN 1 ELSE 0 END) AS no_next_step
     FROM opportunities o
    WHERE o.deleted_at IS NULL AND o.status = 'open' AND o.stage_key NOT IN ('won','lost')`,
  );

  const breaches = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM activities
      WHERE type = 'sla_breached' AND created_at >= ? AND created_at < ?`,
    [from, to],
  );

  const top = await query<{ name: string; n: number }>(
    `SELECT u.name, COUNT(DISTINCT a.contact_id) AS n
       FROM activities a
       JOIN users u ON u.id = a.user_id
      WHERE a.created_at >= ? AND a.created_at < ?
        AND a.type IN ('call_logged','whatsapp_sent','email_sent','message_sent')
      GROUP BY u.id, u.name
      ORDER BY n DESC LIMIT 1`,
    [from, to],
  );

  const flagged = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM session_log
      WHERE level IN ('watch','alarm') AND signed_in_at >= ? AND signed_in_at < ?`,
    [from, to],
  );

  return {
    newLeads: Number(leads?.new_leads ?? 0),
    newLeadsPrevious: Number(leads?.previous ?? 0),
    contacted: Number(leads?.contacted ?? 0),
    slaBreaches: Number(breaches?.n ?? 0),
    appointments: Number(stages?.appointments ?? 0),
    reservations: Number(stages?.reservations ?? 0),
    overdue: Number(open?.overdue ?? 0),
    noNextStep: Number(open?.no_next_step ?? 0),
    unassigned: Number(leads?.unassigned ?? 0),
    topAgent: top[0] ? { name: top[0].name, contacted: Number(top[0].n) } : null,
    flaggedSignIns: Number(flagged?.n ?? 0),
  };
}

export async function sendOwnerSummary(now: Date = new Date()): Promise<{ sent: number }> {
  const numbers = await gatherSummaryNumbers(now);
  const summary = buildOwnerSummary(numbers, yesterdayInDubai(now));

  const owners = await query<{ email: string; name: string }>(
    "SELECT email, name FROM users WHERE role IN ('owner','admin') AND is_active = 1",
  );

  if (owners.length === 0) {
    logger.info('no owners to send the morning summary to');
    return { sent: 0 };
  }

  const text = summaryText(summary, env().APP_URL);
  let sent = 0;
  for (const owner of owners) {
    /* One owner's mail failing must not stop the others. */
    const result = await sendInternalEmail({
      to: owner.email,
      subject: summary.subject,
      text: `Good morning ${owner.name.split(' ')[0] ?? ''},\n\n${text}\n`,
    }).catch((err: unknown) => {
      logger.warn('could not send a morning summary', errorContext(err));
      return { sent: false };
    });
    if (result.sent) sent += 1;
  }

  logger.info('sent the morning summary', { owners: owners.length, sent, quiet: summary.quiet });
  return { sent };
}
