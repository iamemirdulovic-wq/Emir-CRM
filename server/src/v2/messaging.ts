import { query, queryOne } from '../db/client.js';
import { ownerPredicate, visibleUserIds } from '../auth/scope.js';
import type { SessionUser } from '../auth/sessions.js';
import { DAY_END, DAY_START } from './dubai.js';

/**
 * From tap to reply: what happened after an agent opened WhatsApp or Telegram.
 *
 * `design/web/messaging-report.html`. There is no WhatsApp API in v2 — each
 * agent messages from their own number — so the only honest things to count
 * are the tap, the agent's own answer to "What happened?", and a client
 * opening a tracked link. This report counts exactly those three and nothing
 * that would need us to have read a chat.
 *
 * Two of the design's figures are not here, and both for the same reason:
 * `message_taps.result` records `replied`, it does not record *what* they
 * replied, so "37 interested · 21 not now" cannot be split, and there is no
 * per-link-kind breakdown to say "brochure is opened most".
 */

/** The three windows the design's segmented control offers. */
export const PERIODS = ['today', 'week', 'month'] as const;
export type Period = (typeof PERIODS)[number];

/** How many Dubai days each window covers, today included. */
const DAYS: Record<Period, number> = { today: 1, week: 7, month: 30 };

export interface AgentRow {
  userId: string;
  name: string;
  taps: number;
  confirmed: number;
  replied: number;
  linksOpened: number;
  noUpdate: number;
}

export interface OpenedLink {
  linkId: string;
  leadId: string | null;
  client: string | null;
  label: string | null;
  kind: string;
  opens: number;
  lastOpenedAt: string | null;
  agentName: string | null;
}

export interface MessagingReport {
  period: Period;
  days: number;
  taps: { total: number; whatsapp: number; telegram: number; previous: number };
  confirmed: number;
  noUpdate: number;
  replied: number;
  /** One count per value `message_taps.result` can hold. */
  answers: Record<string, number>;
  links: { made: number; opened: number; opens: number };
  agents: AgentRow[];
  opened: OpenedLink[];
}

/**
 * The window, as SQL, and the one before it.
 *
 * Both are built from Dubai's midnight rather than from `NOW() - 7 days`: a
 * week that starts at 14:32 on the eighth day back counts part of that day
 * and makes "this week" disagree with every other screen. See `dubai.ts`.
 */
function window(period: Period): { from: string; to: string; prevFrom: string; prevTo: string } {
  const days = DAYS[period];
  return {
    from: `DATE_SUB(${DAY_START}, INTERVAL ${days - 1} DAY)`,
    to: DAY_END,
    prevFrom: `DATE_SUB(${DAY_START}, INTERVAL ${days * 2 - 1} DAY)`,
    prevTo: `DATE_SUB(${DAY_START}, INTERVAL ${days - 1} DAY)`,
  };
}

export async function messagingReport(user: SessionUser, period: Period): Promise<MessagingReport> {
  const visible = await visibleUserIds(user);
  const taps = ownerPredicate('t.user_id', visible);
  const links = ownerPredicate('l.user_id', visible);
  const { from, to, prevFrom, prevTo } = window(period);

  const [totals, before, byAgent, linkTotals, linksPerAgent, opened] = await Promise.all([
    queryOne<Record<string, unknown>>(
      `SELECT COUNT(*) AS total,
              SUM(t.app = 'whatsapp')              AS whatsapp,
              SUM(t.app = 'telegram')              AS telegram,
              SUM(t.answered_at IS NOT NULL)       AS confirmed,
              SUM(t.result = 'sent')               AS sent,
              SUM(t.result = 'replied')            AS replied,
              SUM(t.result = 'no_reply')           AS no_reply,
              SUM(t.result = 'wrong_number')       AS wrong_number,
              SUM(t.result = 'changed_mind')       AS changed_mind,
              SUM(t.result = 'not_sent')           AS not_sent
         FROM message_taps t
        WHERE ${taps.sql} AND t.tapped_at >= ${from} AND t.tapped_at < ${to}`,
      taps.params,
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM message_taps t
        WHERE ${taps.sql} AND t.tapped_at >= ${prevFrom} AND t.tapped_at < ${prevTo}`,
      taps.params,
    ),
    query<Record<string, unknown>>(
      `SELECT t.user_id AS userId, u.name,
              COUNT(*)                        AS taps,
              SUM(t.answered_at IS NOT NULL)  AS confirmed,
              SUM(t.result = 'replied')       AS replied
         FROM message_taps t
         JOIN users u ON u.id = t.user_id
        WHERE ${taps.sql} AND t.tapped_at >= ${from} AND t.tapped_at < ${to}
        GROUP BY t.user_id, u.name`,
      taps.params,
    ),
    queryOne<Record<string, unknown>>(
      `SELECT
         (SELECT COUNT(*) FROM tracking_links l
           WHERE ${links.sql} AND l.created_at >= ${from} AND l.created_at < ${to}) AS made,
         (SELECT COUNT(DISTINCT o.link_id) FROM link_opens o
            JOIN tracking_links l ON l.id = o.link_id
           WHERE ${links.sql} AND o.opened_at >= ${from} AND o.opened_at < ${to})   AS opened,
         (SELECT COUNT(*) FROM link_opens o
            JOIN tracking_links l ON l.id = o.link_id
           WHERE ${links.sql} AND o.opened_at >= ${from} AND o.opened_at < ${to})   AS opens`,
      [...links.params, ...links.params, ...links.params],
    ),
    query<{ userId: string; opened: number }>(
      `SELECT l.user_id AS userId, COUNT(DISTINCT o.link_id) AS opened
         FROM link_opens o
         JOIN tracking_links l ON l.id = o.link_id
        WHERE ${links.sql} AND o.opened_at >= ${from} AND o.opened_at < ${to}
        GROUP BY l.user_id`,
      links.params,
    ),
    query<Record<string, unknown>>(
      `SELECT l.id AS linkId, l.opportunity_id AS leadId, l.label, l.kind,
              c.full_name AS client, u.name AS agentName,
              COUNT(*) AS opens, MAX(o.opened_at) AS lastOpenedAt
         FROM link_opens o
         JOIN tracking_links l ON l.id = o.link_id
         LEFT JOIN contacts c ON c.id = l.contact_id
         LEFT JOIN users u ON u.id = l.user_id
        WHERE ${links.sql} AND o.opened_at >= ${from} AND o.opened_at < ${to}
        GROUP BY l.id, l.opportunity_id, l.label, l.kind, c.full_name, u.name
        ORDER BY MAX(o.opened_at) DESC
        LIMIT 8`,
      links.params,
    ),
  ]);

  const n = (value: unknown): number => Number(value ?? 0);
  const openedPerAgent = new Map(linksPerAgent.map((row) => [row.userId, n(row.opened)]));

  const agents: AgentRow[] = byAgent
    .map((row) => ({
      userId: String(row.userId),
      name: String(row.name),
      taps: n(row.taps),
      confirmed: n(row.confirmed),
      replied: n(row.replied),
      linksOpened: openedPerAgent.get(String(row.userId)) ?? 0,
      noUpdate: n(row.taps) - n(row.confirmed),
    }))
    /* Most unanswered questions first: this table exists to be acted on, and
       the person with eleven open questions is the reason to open it. */
    .sort((a, b) => b.noUpdate - a.noUpdate || b.taps - a.taps || a.name.localeCompare(b.name));

  return {
    period,
    days: DAYS[period],
    taps: {
      total: n(totals?.total),
      whatsapp: n(totals?.whatsapp),
      telegram: n(totals?.telegram),
      previous: n(before?.total),
    },
    confirmed: n(totals?.confirmed),
    noUpdate: n(totals?.total) - n(totals?.confirmed),
    replied: n(totals?.replied),
    answers: {
      sent: n(totals?.sent),
      replied: n(totals?.replied),
      no_reply: n(totals?.no_reply),
      wrong_number: n(totals?.wrong_number),
      changed_mind: n(totals?.changed_mind),
      not_sent: n(totals?.not_sent),
    },
    links: { made: n(linkTotals?.made), opened: n(linkTotals?.opened), opens: n(linkTotals?.opens) },
    agents,
    opened: opened.map((row) => ({
      linkId: String(row.linkId),
      leadId: (row.leadId as string | null) ?? null,
      client: (row.client as string | null) ?? null,
      label: (row.label as string | null) ?? null,
      kind: String(row.kind ?? 'other'),
      opens: n(row.opens),
      lastOpenedAt: row.lastOpenedAt ? new Date(row.lastOpenedAt as string).toISOString() : null,
      agentName: (row.agentName as string | null) ?? null,
    })),
  };
}

/**
 * How many "What happened?" questions one agent has left open.
 *
 * Counted rather than passed in from the screen: the number the owner saw may
 * be a minute old, and the reminder should say what is true when it is sent.
 */
export async function openQuestions(userId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM message_taps WHERE user_id = ? AND answered_at IS NULL',
    [userId],
  );
  return Number(row?.n ?? 0);
}
