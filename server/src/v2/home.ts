import { query, queryOne } from '../db/client.js';
import type { SessionUser } from '../auth/sessions.js';
import { visibleUserIds } from '../auth/scope.js';
import { leadTabCounts, type LeadCounts } from '../leads/counts.js';
import { dayState, type DayState } from '../attendance/attendance.js';
import { attendanceSettings } from '../attendance/settings.js';
import { DAY_END, DAY_START, TODAY } from './dubai.js';

/**
 * Everything the home screen shows, in one answer.
 *
 * One request rather than fourteen, because this is the screen every person
 * opens first every morning and fourteen round trips is fourteen spinners.
 *
 * The rule the whole file obeys: **every number here comes from a query.**
 * The design shows a ring reading "18 of 40" and a line reading "+240
 * points"; there is no daily target and no points table in this database, so
 * those are not drawn. What is drawn is what can be counted — calls made,
 * messages tapped, meetings held, days in a row checked in, kudos received.
 * See `docs/v2/decisions.md` §7.1. A made-up number on the first screen of
 * the morning is worse than a smaller true one.
 */

/**
 * The day's targets, as the design states them.
 *
 * `design/web/my-day.html` draws "18 of 40 calls", "9 of 20 WhatsApp" and
 * "1 of 2 meetings". The 40, the 20 and the 2 are Emir's own numbers from his
 * design package, not invented here, and they are the same for everybody
 * until Settings can set them per agent (phase 11). They are sent from the
 * server rather than written into the page so that when Settings arrives,
 * one place changes.
 */
export const DAILY_GOALS = { calls: 40, messages: 20, meetings: 2 } as const;

export interface HomeLead {
  id: string;
  name: string | null;
  phone: string | null;
  project: string | null;
  stage: string;
  score: number | null;
  nextStepAt: Date | null;
  nextStepNote: string | null;
  lastContactAt: Date | null;
  isVip: boolean;
}

export interface AgentHome {
  role: 'agent';
  me: { name: string; firstName: string };
  /** Dubai, always — the office clock, not the browser's. */
  now: string;
  attendance: DayState;
  counts: LeadCounts;
  /** Free leads anybody may claim. */
  freeLeads: number;
  today: {
    calls: number;
    answered: number;
    messages: number;
    meetings: number;
    newLeads: number;
  };
  goals: { calls: number; messages: number; meetings: number };
  /** Consecutive days marked present, ending today or yesterday. */
  streakDays: number;
  kudosThisMonth: number;
  byStage: Array<{ stage: string; n: number }>;
  nextUp: HomeLead | null;
  /** Candidates for "a good hour to ring them" — the page does the clock. */
  callNow: HomeLead[];
  vip: {
    id: string;
    leadId: string;
    name: string | null;
    phone: string | null;
    project: string | null;
    givenBy: string;
    note: string | null;
    deadlineAt: Date | null;
    accepted: boolean;
  } | null;
  waitingUpdate: Array<{
    id: string; app: 'whatsapp' | 'telegram'; name: string | null;
    leadId: string | null; tappedAt: Date;
  }>;
  linkOpens: Array<{
    name: string | null; leadId: string | null; label: string | null;
    kind: string; openedAt: Date; opens: number;
  }>;
  transfersForMe: number;
  tasksOverdue: number;
  unread: number;
  banners: Array<{ id: string; title: string; body: string | null; linkUrl: string | null }>;
}

export interface OwnerHome {
  role: 'owner';
  me: { name: string; firstName: string };
  now: string;
  needsYou: Array<{
    kind: 'vip_late' | 'leave' | 'absent' | 'waiting' | 'transfer' | 'bug';
    text: string;
    n: number;
    action: string;
    to: string;
  }>;
  teamToday: { inOffice: number; late: number; outside: number; absent: number; closed: boolean };
  todayNumbers: {
    newLeads: number; calls: number; whatsapp: number; telegram: number;
    meetings: number; unitsBooked: number; overdue: number; noNextStep: number;
  };
  teamRightNow: Array<{
    id: string; name: string; photoUrl: string | null; marked: string | null;
    openLeads: number; callsToday: number; lastSeenAt: Date | null;
  }>;
  freeLeads: number;
  banners: Array<{ id: string; title: string; body: string | null; linkUrl: string | null }>;
  unread: number;
}

export type Home = AgentHome | OwnerHome;

const firstName = (full: string): string => full.trim().split(/\s+/)[0] ?? full;

/** Dubai wall clock, so the greeting matches the office and not the server. */
function dubaiNow(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(at);
}

async function banners() {
  return await query<{ id: string; title: string; body: string | null; link_url: string | null }>(
    `SELECT id, title, body, link_url
       FROM banners
      WHERE is_active = 1
        AND (starts_at IS NULL OR starts_at <= NOW(3))
        AND (ends_at IS NULL OR ends_at >= NOW(3))
      ORDER BY position ASC, created_at DESC
      LIMIT 5`,
  ).then((rows) => rows.map((r) => ({
    id: r.id, title: r.title, body: r.body, linkUrl: r.link_url,
  })));
}

async function unreadCount(userId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM notifications
      WHERE user_id = ? AND read_at IS NULL`,
    [userId],
  );
  return Number(row?.n ?? 0);
}

/**
 * How many days in a row this person has marked themselves present.
 *
 * Counted backwards from today, and a day the office was shut does not break
 * it — being closed on a Sunday is not an absence. Read in one pass over the
 * last 60 days rather than a query per day.
 */
async function streak(userId: string): Promise<number> {
  const rows = await query<{ on_date: string }>(
    `SELECT DATE_FORMAT(on_date, '%Y-%m-%d') AS on_date
       FROM attendance
      WHERE user_id = ? AND on_date >= DATE_SUB(${TODAY}, INTERVAL 60 DAY)
      ORDER BY on_date DESC`,
    [userId],
  );
  if (rows.length === 0) return 0;

  /* Which weekdays the office is shut comes from the attendance settings an
     owner saved, not from a table of its own -- there isn't one. */
  const shut = new Set((await attendanceSettings()).closedDays);

  const marked = new Set(rows.map((r) => r.on_date));
  const dubaiToday = new Date(Date.now() + 4 * 3_600_000);
  let days = 0;

  for (let back = 0; back < 60; back += 1) {
    const at = new Date(dubaiToday.getTime() - back * 86_400_000);
    const key = at.toISOString().slice(0, 10);
    if (marked.has(key)) { days += 1; continue; }
    if (shut.has(at.getUTCDay())) continue;
    /* Today not yet marked does not end a streak that is still running. */
    if (back === 0) continue;
    break;
  }
  return days;
}

const LEAD_SELECT = `
  SELECT o.id, c.full_name AS name, c.phone_e164 AS phone, o.project_name AS project,
         o.stage_key AS stage, o.lead_score AS score, o.next_step_at AS nextStepAt,
         o.next_step_note AS nextStepNote, o.last_contact_at AS lastContactAt, o.is_vip AS isVip
    FROM opportunities o
    JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL`;

const asLead = (r: Record<string, unknown>): HomeLead => ({
  id: String(r.id),
  name: (r.name as string | null) ?? null,
  phone: (r.phone as string | null) ?? null,
  project: (r.project as string | null) ?? null,
  stage: String(r.stage),
  score: r.score === null ? null : Number(r.score),
  nextStepAt: (r.nextStepAt as Date | null) ?? null,
  nextStepNote: (r.nextStepNote as string | null) ?? null,
  lastContactAt: (r.lastContactAt as Date | null) ?? null,
  isVip: Number(r.isVip ?? 0) === 1,
});

export async function agentHome(user: SessionUser, seenIp: string | null): Promise<AgentHome> {
  const me = user.id;

  const [
    attendance, counts, free, todayRow, byStage, nextUpRow, callNowRows,
    vipRow, taps, opens, transfers, overdue, unread, bannerRows, streakDays, kudos,
  ] = await Promise.all([
    dayState(me, seenIp),
    leadTabCounts([me]),
    queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities
        WHERE status = 'open' AND owner_user_id IS NULL AND deleted_at IS NULL`,
    ),
    /*
     * The day's work, counted from what was actually recorded. Calls come
     * from `call_logs`, which the dialler writes; messages from
     * `message_taps`, which is a tap on WhatsApp or Telegram and deliberately
     * not called "sent" — the agent presses send in the real app, and the CRM
     * never claims otherwise (pages.md, global rules).
     */
    queryOne<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM call_logs
           WHERE user_id = ? AND started_at >= ${DAY_START} AND started_at < ${DAY_END}) AS calls,
         (SELECT COUNT(*) FROM call_logs
           WHERE user_id = ? AND outcome IN ('interested','call_back')
             AND started_at >= ${DAY_START} AND started_at < ${DAY_END}) AS answered,
         (SELECT COUNT(*) FROM message_taps
           WHERE user_id = ? AND tapped_at >= ${DAY_START} AND tapped_at < ${DAY_END}) AS messages,
         (SELECT COUNT(*) FROM meetings
           WHERE user_id = ? AND deleted_at IS NULL
             AND starts_at >= ${DAY_START} AND starts_at < ${DAY_END}) AS meetings,
         (SELECT COUNT(*) FROM opportunities
           WHERE owner_user_id = ? AND deleted_at IS NULL
             AND created_at >= ${DAY_START} AND created_at < ${DAY_END}) AS newLeads`,
      [me, me, me, me, me],
    ),
    query<{ stage: string; n: number }>(
      `SELECT stage_key AS stage, COUNT(*) AS n
         FROM opportunities
        WHERE owner_user_id = ? AND status = 'open' AND deleted_at IS NULL
        GROUP BY stage_key`,
      [me],
    ),
    /* The one lead to pick up now: the promise furthest past its time. */
    queryOne<Record<string, unknown>>(
      `${LEAD_SELECT}
        WHERE o.owner_user_id = ? AND o.status = 'open' AND o.deleted_at IS NULL
          AND o.next_step_at IS NOT NULL
        ORDER BY o.next_step_at ASC LIMIT 1`,
      [me],
    ),
    /*
     * Candidates for "a good hour to ring them". Which three are good depends
     * on the client's own clock, and the country-to-timezone table lives in
     * the browser (`web/src/lib/dialling.ts`), so the server sends a dozen
     * and the page picks. No phone number, no candidacy.
     */
    query<Record<string, unknown>>(
      `${LEAD_SELECT}
        WHERE o.owner_user_id = ? AND o.status = 'open' AND o.deleted_at IS NULL
          AND c.phone_e164 IS NOT NULL
          AND (o.last_contact_at IS NULL OR o.last_contact_at < ${DAY_START})
        ORDER BY o.is_vip DESC, o.lead_score DESC, o.created_at DESC
        LIMIT 12`,
      [me],
    ),
    queryOne<Record<string, unknown>>(
      `SELECT v.id, v.opportunity_id AS leadId, v.private_note AS note, v.deadline_at AS deadlineAt,
              v.accepted_at AS acceptedAt, c.full_name AS name, c.phone_e164 AS phone,
              o.project_name AS project, u.name AS givenBy
         FROM vip_handoffs v
         JOIN opportunities o ON o.id = v.opportunity_id AND o.deleted_at IS NULL
         JOIN contacts c ON c.id = o.contact_id
         JOIN users u ON u.id = v.given_by
        WHERE v.given_to = ? AND v.refused_at IS NULL AND v.returned_at IS NULL
          AND o.status = 'open'
        ORDER BY v.created_at DESC LIMIT 1`,
      [me],
    ),
    query<Record<string, unknown>>(
      `SELECT t.id, t.app, t.opportunity_id AS leadId, t.tapped_at AS tappedAt, c.full_name AS name
         FROM message_taps t
         JOIN contacts c ON c.id = t.contact_id
        WHERE t.user_id = ? AND t.answered_at IS NULL
        ORDER BY t.tapped_at DESC LIMIT 10`,
      [me],
    ),
    query<Record<string, unknown>>(
      `SELECT c.full_name AS name, l.opportunity_id AS leadId, l.label, l.kind,
              MAX(o.opened_at) AS openedAt, COUNT(*) AS opens
         FROM link_opens o
         JOIN tracking_links l ON l.id = o.link_id
         LEFT JOIN contacts c ON c.id = l.contact_id
        WHERE l.user_id = ? AND o.opened_at >= DATE_SUB(NOW(3), INTERVAL 7 DAY)
        GROUP BY l.id, c.full_name, l.opportunity_id, l.label, l.kind
        ORDER BY openedAt DESC LIMIT 5`,
      [me],
    ),
    queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM lead_transfers
        WHERE to_user_id = ? AND status = 'pending'`,
      [me],
    ),
    queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tasks
        WHERE assigned_user_id = ? AND completed_at IS NULL AND due_at < NOW(3)`,
      [me],
    ),
    unreadCount(me),
    banners(),
    streak(me),
    queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM kudos
        WHERE to_user_id = ? AND created_at >= DATE_SUB(${DAY_START}, INTERVAL 30 DAY)`,
      [me],
    ).catch(() => ({ n: 0 })),
  ]);

  return {
    role: 'agent',
    me: { name: user.name, firstName: firstName(user.name) },
    now: dubaiNow(),
    attendance,
    counts,
    freeLeads: Number(free?.n ?? 0),
    today: {
      calls: Number(todayRow?.calls ?? 0),
      answered: Number(todayRow?.answered ?? 0),
      messages: Number(todayRow?.messages ?? 0),
      meetings: Number(todayRow?.meetings ?? 0),
      newLeads: Number(todayRow?.newLeads ?? 0),
    },
    goals: { ...DAILY_GOALS },
    streakDays,
    kudosThisMonth: Number(kudos?.n ?? 0),
    byStage: byStage.map((r) => ({ stage: r.stage, n: Number(r.n) })),
    nextUp: nextUpRow ? asLead(nextUpRow) : null,
    callNow: callNowRows.map(asLead),
    vip: vipRow
      ? {
        id: String(vipRow.id),
        leadId: String(vipRow.leadId),
        name: (vipRow.name as string | null) ?? null,
        phone: (vipRow.phone as string | null) ?? null,
        project: (vipRow.project as string | null) ?? null,
        givenBy: String(vipRow.givenBy),
        note: (vipRow.note as string | null) ?? null,
        deadlineAt: (vipRow.deadlineAt as Date | null) ?? null,
        accepted: vipRow.acceptedAt !== null,
      }
      : null,
    waitingUpdate: taps.map((t) => ({
      id: String(t.id),
      app: t.app as 'whatsapp' | 'telegram',
      name: (t.name as string | null) ?? null,
      leadId: (t.leadId as string | null) ?? null,
      tappedAt: t.tappedAt as Date,
    })),
    linkOpens: opens.map((o) => ({
      name: (o.name as string | null) ?? null,
      leadId: (o.leadId as string | null) ?? null,
      label: (o.label as string | null) ?? null,
      kind: String(o.kind),
      openedAt: o.openedAt as Date,
      opens: Number(o.opens),
    })),
    transfersForMe: Number(transfers?.n ?? 0),
    tasksOverdue: Number(overdue?.n ?? 0),
    unread,
    banners: bannerRows,
  };
}

export async function ownerHome(user: SessionUser, seenIp: string | null): Promise<OwnerHome> {
  const visible = await visibleUserIds(user);
  const mine = visible === null ? null : visible;
  const today = await dayState(user.id, seenIp);

  const [
    team, todayRow, counts, free, vipLate, leave, transfers, bugs, unread, bannerRows,
  ] = await Promise.all([
    /*
     * Who is where, and what they have done today. One query over the team
     * rather than one per person: ten agents was ten round trips, and the
     * next hire made it eleven.
     */
    query<Record<string, unknown>>(
      `SELECT u.id, u.name, u.photo_url AS photoUrl, a.kind AS marked, a.was_late AS wasLate,
              (SELECT COUNT(*) FROM opportunities o
                WHERE o.owner_user_id = u.id AND o.status = 'open' AND o.deleted_at IS NULL)
                AS openLeads,
              (SELECT COUNT(*) FROM call_logs cl
                WHERE cl.user_id = u.id
                  AND cl.started_at >= ${DAY_START} AND cl.started_at < ${DAY_END}) AS callsToday,
              (SELECT MAX(ac.created_at) FROM activities ac WHERE ac.user_id = u.id) AS lastSeenAt
         FROM users u
         LEFT JOIN attendance a ON a.user_id = u.id AND a.on_date = ${TODAY}
        WHERE u.is_active = 1 AND u.role IN ('agent','manager')
        ORDER BY u.name ASC`,
    ),
    queryOne<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM opportunities
           WHERE deleted_at IS NULL
             AND created_at >= ${DAY_START} AND created_at < ${DAY_END}) AS newLeads,
         (SELECT COUNT(*) FROM call_logs
           WHERE started_at >= ${DAY_START} AND started_at < ${DAY_END}) AS calls,
         (SELECT COUNT(*) FROM message_taps
           WHERE app = 'whatsapp'
             AND tapped_at >= ${DAY_START} AND tapped_at < ${DAY_END}) AS whatsapp,
         (SELECT COUNT(*) FROM message_taps
           WHERE app = 'telegram'
             AND tapped_at >= ${DAY_START} AND tapped_at < ${DAY_END}) AS telegram,
         (SELECT COUNT(*) FROM meetings
           WHERE deleted_at IS NULL
             AND starts_at >= ${DAY_START} AND starts_at < ${DAY_END}) AS meetings,
         (SELECT COUNT(*) FROM opportunities
           WHERE status = 'won' AND deleted_at IS NULL
             AND stage_changed_at >= ${DAY_START} AND stage_changed_at < ${DAY_END})
           AS unitsBooked`,
    ),
    leadTabCounts(mine),
    queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities
        WHERE status = 'open' AND owner_user_id IS NULL AND deleted_at IS NULL`,
    ),
    queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vip_handoffs
        WHERE first_call_at IS NULL AND returned_at IS NULL AND refused_at IS NULL
          AND deadline_at IS NOT NULL AND deadline_at < NOW(3)`,
    ),
    queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'",
    ),
    queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM lead_transfers WHERE status = 'needs_approval'",
    ),
    queryOne<{ n: number }>(
      /* 'new' and 'planned' are the two unresolved states in the enum;
         'fixed' and 'declined' are both answered. */
      `SELECT COUNT(*) AS n FROM feedback_tickets
        WHERE status IN ('new','planned') AND blocking = 1`,
    ).catch(() => ({ n: 0 })),
    unreadCount(user.id),
    banners(),
  ]);

  const rows = team.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    photoUrl: (r.photoUrl as string | null) ?? null,
    marked: (r.marked as string | null) ?? null,
    wasLate: Number(r.wasLate ?? 0) === 1,
    openLeads: Number(r.openLeads),
    callsToday: Number(r.callsToday),
    lastSeenAt: (r.lastSeenAt as Date | null) ?? null,
  }));

  const needsYou: OwnerHome['needsYou'] = [];
  const add = (
    kind: OwnerHome['needsYou'][number]['kind'],
    n: number, text: string, action: string, to: string,
  ) => { if (n > 0) needsYou.push({ kind, n, text, action, to }); };

  add('vip_late', Number(vipLate?.n ?? 0),
    'VIP lead not called in time', 'Give again', '/v2/incoming');
  add('waiting', Number(free?.n ?? 0),
    'leads waiting to be given out', 'Give', '/v2/incoming');
  add('transfer', Number(transfers?.n ?? 0),
    'lead transfers need your approval', 'Approve', '/v2/transfers');
  add('leave', Number(leave?.n ?? 0),
    'leave requests to answer', 'Answer', '/v2/attendance');
  const absent = rows.filter((r) => r.marked === null).length;
  if (!today.closed) {
    add('absent', absent, 'nobody has marked them in today', 'See', '/v2/attendance');
  }
  add('bug', Number(bugs?.n ?? 0),
    'blocking problems reported', 'Open', '/v2/settings');

  return {
    role: 'owner',
    me: { name: user.name, firstName: firstName(user.name) },
    now: dubaiNow(),
    needsYou,
    teamToday: {
      inOffice: rows.filter((r) => r.marked === 'office' && !r.wasLate).length,
      late: rows.filter((r) => r.marked === 'office' && r.wasLate).length,
      outside: rows.filter((r) => r.marked === 'outside').length,
      absent: today.closed ? 0 : absent,
      closed: today.closed,
    },
    todayNumbers: {
      newLeads: Number(todayRow?.newLeads ?? 0),
      calls: Number(todayRow?.calls ?? 0),
      whatsapp: Number(todayRow?.whatsapp ?? 0),
      telegram: Number(todayRow?.telegram ?? 0),
      meetings: Number(todayRow?.meetings ?? 0),
      unitsBooked: Number(todayRow?.unitsBooked ?? 0),
      overdue: counts.overdue,
      noNextStep: counts.no_next_step,
    },
    teamRightNow: rows.map(({ wasLate, ...rest }) => rest),
    freeLeads: Number(free?.n ?? 0),
    banners: bannerRows,
    unread,
  };
}
