import { query, queryOne } from '../db/client.js';
import type { SessionUser } from '../auth/sessions.js';
import { visibleUserIds } from '../auth/scope.js';
import { leadTabCounts, type LeadCounts } from '../leads/counts.js';
import { dayState, type DayState } from '../attendance/attendance.js';
import { attendanceSettings } from '../attendance/settings.js';
import { DAY_END, DAY_START, DUBAI, TODAY } from './dubai.js';
import { STAGE_STRIP } from './dashboard.js';
import { countedAgentSql } from '../users/counting.js';
import { recordBannerViews } from './banners.js';

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

/**
 * The four windows the owner's home switches between.
 *
 * It moves the calls card and the meetings-and-units card and nothing else,
 * exactly as `owner-home.html` does. How many leads exist, what stage they
 * are in and who is in the office are facts about now; an owner who picks
 * "Year" and watches the pipeline change has been told something untrue.
 */
export const HOME_PERIODS = ['today', 'week', 'month', 'year'] as const;
export type HomePeriod = (typeof HOME_PERIODS)[number];

const PERIOD_DAYS: Record<HomePeriod, number> = { today: 1, week: 7, month: 30, year: 365 };

/** One column of the "Calls today" chart: a Dubai hour. */
export interface HomeHour {
  hour: number;
  calls: number;
  /** Later today, drawn as an empty slot rather than a zero. */
  future: boolean;
}

export interface OwnerTeamRow {
  id: string;
  name: string;
  photoUrl: string | null;
  marked: string | null;
  wasLate: boolean;
  onLeave: boolean;
  /** When they marked themselves in, Dubai "HH:MM", or null. */
  checkedInAt: string | null;
  openLeads: number;
  callsToday: number;
  /** Seven days of calls, oldest first, for the trend line. */
  callsPerDay: number[];
  /** The desk's agreed maximum open leads, when they are on one. */
  deskMax: number | null;
  deskName: string | null;
  overdue: number;
  lastSeenAt: Date | null;
}

export interface OwnerHome {
  role: 'owner';
  me: { name: string; firstName: string };
  now: string;
  /** Dubai "HH:MM", for the "Live ·" stamp beside the period switch. */
  clock: string;
  period: HomePeriod;
  needsYou: Array<{
    kind: 'vip_late' | 'leave' | 'absent' | 'waiting' | 'transfer' | 'bug';
    /** The whole headline, counts and names already in it. */
    text: string;
    /** The line under it, which says who and since when. */
    sub: string | null;
    n: number;
    action: string;
    to: string;
    /** How long this has been waiting, for the hero's "Oldest waits" chip. */
    waitMinutes: number | null;
  }>;
  teamToday: {
    inOffice: number; late: number; outside: number; leave: number;
    absent: number; closed: boolean;
  };
  todayNumbers: {
    newLeads: number; calls: number; whatsapp: number; telegram: number;
    meetings: number; unitsBooked: number; overdue: number; noNextStep: number;
  };
  /** Calls, meetings and units — the three the period switch moves. */
  work: {
    calls: number;
    callsPrevious: number;
    meetings: number;
    units: number;
    /** The newest deal in the window, for the line under the two numbers. */
    lastUnit: { agent: string | null; project: string | null; valueAed: number | null } | null;
    /** New leads is "today" on every period, as the design has it. */
    newLeadsToday: number;
    newLeadsYesterday: number;
    /** Median minutes from a lead arriving to its first answer, over the window. */
    firstContactMinutes: number | null;
  };
  /** Today by Dubai hour, whatever the period — the design says so in its foot. */
  hours: HomeHour[];
  /** Where "now" falls across the chart, 0–1, for the dashed marker. */
  nowAcross: number | null;
  bestHour: number | null;
  pipeline: {
    total: number;
    open: number;
    stages: Array<{ key: string; label: string; tone: string; n: number; pct: number }>;
    lost: { n: number; pct: number };
  };
  teamRightNow: OwnerTeamRow[];
  /** The desks and their agreed maximums, named in the table's foot. */
  desks: Array<{ name: string; maxOpenLeads: number | null }>;
  watch: {
    overdue: { n: number; who: Array<{ name: string; n: number }> };
    noNextStep: number;
    transfers: { n: number; needApproval: number };
    taps: { n: number; unanswered: number };
    cold: number;
  };
  latestLeads: Array<{
    id: string; name: string | null; phone: string | null; project: string | null;
    stage: string; agent: string | null; isVip: boolean;
    createdAt: Date;
  }>;
  vipGiven: {
    total: number;
    rows: Array<{
      id: string; leadId: string; name: string | null; agent: string;
      project: string | null; givenAt: Date; deadlineAt: Date | null;
      acceptedAt: Date | null; firstCallAt: Date | null; returnedAt: Date | null;
      stage: string;
    }>;
  };
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

/**
 * The banners at the top of My Day.
 *
 * Who sees one is now the owner's choice — everyone, agents only, or one desk
 * (`design/web/home-banners.html`, "Who sees it"). The filter is applied here
 * rather than only offered on the form, because a banner that is meant for the
 * Arabic desk and shows to the whole office is not a setting, it is a lie.
 *
 * Being shown one is recorded once per person, which is what "seen by 9 of 10"
 * on the banners screen counts.
 */
async function banners(userId: string, role: string) {
  const rows = await query<{ id: string; title: string; body: string | null; link_url: string | null }>(
    `SELECT b.id, b.title, b.body, b.link_url
       FROM banners b
      WHERE b.is_active = 1
        AND (b.starts_at IS NULL OR b.starts_at <= NOW(3))
        AND (b.ends_at IS NULL OR DATE(b.ends_at) >= DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00')))
        AND (
          b.audience = 'everyone'
          OR (b.audience = 'agents' AND ? = 'agent')
          OR (b.audience = 'desk' AND EXISTS (
                SELECT 1 FROM desk_members dm
                 WHERE dm.desk_id = b.desk_id AND dm.user_id = ?))
        )
      ORDER BY b.position ASC, b.created_at DESC
      LIMIT 5`,
    [role, userId],
  );
  /* Never allowed to break My Day: a view that cannot be written is a lost
     statistic, not a reason for the morning screen to fail. */
  await recordBannerViews(userId, rows.map((row) => row.id)).catch(() => {});
  return rows.map((r) => ({
    id: r.id, title: r.title, body: r.body, linkUrl: r.link_url,
  }));
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
    banners(me, user.role),
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


/* ── the owner's home ──────────────────────────────────────────────────── */

/** The window, and the one before it, as SQL. Dubai midnights, never NOW(). */
function homeWindow(period: HomePeriod): { from: string; to: string; prevFrom: string; prevTo: string } {
  const days = PERIOD_DAYS[period];
  return {
    from: `DATE_SUB(${DAY_START}, INTERVAL ${days - 1} DAY)`,
    to: DAY_END,
    prevFrom: `DATE_SUB(${DAY_START}, INTERVAL ${days * 2 - 1} DAY)`,
    prevTo: `DATE_SUB(${DAY_START}, INTERVAL ${days - 1} DAY)`,
  };
}

/** Dubai's wall clock as minutes past its midnight. */
function dubaiMinutesNow(at: Date = new Date()): number {
  const dubai = new Date(at.getTime() + 4 * 3_600_000);
  return dubai.getUTCHours() * 60 + dubai.getUTCMinutes();
}

/**
 * The hours the "Calls today" chart draws.
 *
 * The office's own opening hours, so the chart is the working day the team
 * recognises rather than a fixed 09–17 that is right in no country. An hour
 * with calls outside those hours is still drawn — somebody working late is
 * exactly what an owner wants to see — and this hour is always in range.
 *
 * The same shape as the one Team live uses, deliberately: the two screens
 * draw the same day and must not disagree about which hours it has.
 */
function homeHourRange(
  open: number | null, close: number | null, counted: number[], nowHour: number,
): number[] {
  let first = open ?? 9;
  let last = close ?? 18;
  for (const hour of counted) {
    if (hour < first) first = hour;
    if (hour > last) last = hour;
  }
  if (nowHour > last) last = nowHour;
  if (nowHour < first) first = nowHour;
  if (last - first > 15) first = last - 15;
  const out: number[] = [];
  for (let hour = first; hour <= last; hour += 1) out.push(hour);
  return out;
}

/** The median of a list of numbers, or null when there is nothing to take it of. */
function middle(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** "14:55", from minutes past a Dubai midnight. */
function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** A date as Dubai's clock reads it, or null. */
function clockOf(at: Date | null): string | null {
  if (!at) return null;
  const dubai = new Date(new Date(at).getTime() + 4 * 3_600_000);
  return `${String(dubai.getUTCHours()).padStart(2, '0')}:${String(dubai.getUTCMinutes()).padStart(2, '0')}`;
}

/** How many whole minutes ago, never negative. */
function minutesSince(at: Date | null | undefined): number | null {
  if (!at) return null;
  const mins = Math.floor((Date.now() - new Date(at).getTime()) / 60_000);
  return mins < 0 ? 0 : mins;
}

/** "3 days", "42 min" — a length of time somebody would say out loud. */
function spoken(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) {
    const hours = Math.round(minutes / 60);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(minutes / (60 * 24));
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** "18–20 Nov", the way the leave rows read. */
function dayRange(from: string, to: string): string {
  const short = (value: string): string => {
    const at = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    return `${at.getUTCDate()} ${at.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
  };
  const a = short(from);
  const b = short(to);
  if (a === b) return a;
  /* "18–20 Nov" when both are in the same month, "30 Nov – 2 Dec" otherwise. */
  const monthA = a.slice(a.indexOf(' ') + 1);
  const monthB = b.slice(b.indexOf(' ') + 1);
  return monthA === monthB ? `${a.slice(0, a.indexOf(' '))}–${b}` : `${a} – ${b}`;
}

const STAGE_WORD: Record<string, string> = {
  new_lead: 'New',
  attempted_contact: 'Called',
  engaged_qualified: 'Interested',
  appointment_scheduled: 'Meeting',
  deal_sent: 'Offer',
  won: 'Won',
  lost: 'Lost',
};

/**
 * The owner's home — `design/web/owner-home.html`.
 *
 * One request for the whole screen, and every figure on it is a query. Where
 * the design draws something this database does not record, the block is left
 * out rather than filled with a plausible number: see `docs/v2/questions-
 * owner.md` for the list and what each one is waiting for.
 */
export async function ownerHome(
  user: SessionUser,
  seenIp: string | null,
  period: HomePeriod = 'today',
): Promise<OwnerHome> {
  const visible = await visibleUserIds(user);
  const mine = visible === null ? null : visible;
  const today = await dayState(user.id, seenIp);
  const w = homeWindow(period);
  const settings = await attendanceSettings();

  const [
    team, todayRow, workRow, counts, free, vipLateRows, leaveRows, transferRows, bugRow,
    unread, bannerRows, stageRows, totalsRow, callHours, leaveToday, deskRows, deskMaxRows,
    sparkRows, answerRows, waitingRows, overdueBy, tapRow, coldRow, latestRows,
    vipGivenRows, vipGivenTotal, lastUnitRow,
  ] = await Promise.all([
    /*
     * Who is where, and what they have done today. One query over the team
     * rather than one per person: ten agents was ten round trips, and the
     * next hire made it eleven.
     */
    query<Record<string, unknown>>(
      `SELECT u.id, u.name, u.photo_url AS photoUrl, a.kind AS marked, a.was_late AS wasLate,
              a.marked_at AS markedAt,
              (SELECT COUNT(*) FROM opportunities o
                WHERE o.owner_user_id = u.id AND o.status = 'open' AND o.deleted_at IS NULL)
                AS openLeads,
              (SELECT COUNT(*) FROM opportunities o
                WHERE o.owner_user_id = u.id AND o.status = 'open' AND o.deleted_at IS NULL
                  AND o.next_step_at IS NOT NULL AND o.next_step_at < NOW(3)) AS overdue,
              (SELECT COUNT(*) FROM call_logs cl
                WHERE cl.user_id = u.id
                  AND cl.started_at >= ${DAY_START} AND cl.started_at < ${DAY_END}) AS callsToday,
              (SELECT MAX(ac.created_at) FROM activities ac WHERE ac.user_id = u.id) AS lastSeenAt
         FROM users u
         LEFT JOIN attendance a ON a.user_id = u.id AND a.on_date = ${TODAY}
        WHERE u.is_active = 1 AND ${countedAgentSql()}
        ORDER BY u.name ASC`,
    ),
    queryOne<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM opportunities
           WHERE deleted_at IS NULL
             AND created_at >= ${DAY_START} AND created_at < ${DAY_END}) AS newLeads,
         (SELECT COUNT(*) FROM opportunities
           WHERE deleted_at IS NULL
             AND created_at >= DATE_SUB(${DAY_START}, INTERVAL 1 DAY)
             AND created_at < DATE_SUB(NOW(3), INTERVAL 1 DAY)) AS newLeadsYesterday,
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
    /* The three the period switch moves, and the window before for the delta. */
    queryOne<Record<string, number | null>>(
      `SELECT
         (SELECT COUNT(*) FROM call_logs
           WHERE started_at >= ${w.from} AND started_at < ${w.to}) AS calls,
         (SELECT COUNT(*) FROM call_logs
           WHERE started_at >= ${w.prevFrom} AND started_at < ${w.prevTo}) AS callsPrevious,
         (SELECT COUNT(*) FROM meetings
           WHERE deleted_at IS NULL
             AND starts_at >= ${w.from} AND starts_at < ${w.to}) AS meetings,
         (SELECT COUNT(*) FROM opportunities
           WHERE status = 'won' AND deleted_at IS NULL
             AND stage_changed_at >= ${w.from} AND stage_changed_at < ${w.to}) AS units`,
    ),
    leadTabCounts(mine),
    queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities
        WHERE status = 'open' AND owner_user_id IS NULL AND deleted_at IS NULL`,
    ),
    /*
     * VIP leads past their deadline, named. The design's row reads "VIP Omar
     * Khan is not called · Bassam had 30 min · now back in Incoming", and a
     * row that says "1 VIP lead not called in time" is a row nobody can act
     * on without opening another screen first.
     */
    query<Record<string, unknown>>(
      `SELECT v.id, v.opportunity_id AS leadId, v.deadline_at AS deadlineAt,
              v.call_within_minutes AS within, c.full_name AS name,
              o.project_name AS project, o.owner_user_id AS ownerUserId,
              u.name AS agent
         FROM vip_handoffs v
         JOIN opportunities o ON o.id = v.opportunity_id AND o.deleted_at IS NULL
         JOIN contacts c ON c.id = o.contact_id
         JOIN users u ON u.id = v.given_to
        WHERE v.first_call_at IS NULL AND v.returned_at IS NULL AND v.refused_at IS NULL
          AND v.deadline_at IS NOT NULL AND v.deadline_at < NOW(3)
          AND o.status = 'open'
        ORDER BY v.deadline_at ASC
        LIMIT 20`,
    ),
    query<Record<string, unknown>>(
      `SELECT l.id, l.from_date AS fromDate, l.to_date AS toDate, l.kind,
              l.created_at AS createdAt, u.name
         FROM leave_requests l
         JOIN users u ON u.id = l.user_id
        WHERE l.status = 'pending'
        ORDER BY l.created_at ASC
        LIMIT 20`,
    ),
    /*
     * Transfers in the air. Two days rather than one, because an approval
     * asked for yesterday evening still needs the owner this morning — the
     * watch list's "today" is counted off `requestedAt` below.
     */
    query<Record<string, unknown>>(
      `SELECT t.id, t.requested_at AS requestedAt, t.status, o.stage_key AS stage,
              c.full_name AS leadName, f.name AS fromName, g.name AS toName
         FROM lead_transfers t
         JOIN opportunities o ON o.id = t.opportunity_id AND o.deleted_at IS NULL
         JOIN contacts c ON c.id = o.contact_id
         JOIN users f ON f.id = t.from_user_id
         JOIN users g ON g.id = t.to_user_id
        WHERE t.status IN ('pending','needs_approval')
          AND t.requested_at >= DATE_SUB(${DAY_START}, INTERVAL 1 DAY)
        ORDER BY t.requested_at ASC
        LIMIT 50`,
    ),
    queryOne<Record<string, unknown>>(
      /* 'new' and 'planned' are the two unresolved states in the enum;
         'fixed' and 'declined' are both answered. */
      `SELECT f.id, f.body, f.created_at AS createdAt, u.name,
              (SELECT COUNT(*) FROM feedback_tickets x
                WHERE x.status IN ('new','planned') AND x.blocking = 1) AS n
         FROM feedback_tickets f
         JOIN users u ON u.id = f.user_id
        WHERE f.status IN ('new','planned') AND f.blocking = 1
        ORDER BY f.created_at ASC
        LIMIT 1`,
    ).catch(() => null),
    unreadCount(user.id),
    banners(user.id, user.role),
    query<{ stage_key: string; n: number }>(
      `SELECT stage_key, COUNT(*) AS n
         FROM opportunities
        WHERE deleted_at IS NULL
        GROUP BY stage_key`,
    ),
    queryOne<Record<string, number>>(
      `SELECT
         SUM(deleted_at IS NULL) AS all_,
         SUM(deleted_at IS NULL AND status = 'open') AS open_,
         SUM(deleted_at IS NULL AND status = 'lost') AS lost_
         FROM opportunities`,
    ),
    /* Today's calls by Dubai hour, for the bars and the "now" marker. */
    query<{ hour: number; n: number }>(
      `SELECT HOUR(CONVERT_TZ(started_at, '+00:00', ${DUBAI})) AS hour, COUNT(*) AS n
         FROM call_logs
        WHERE started_at >= ${DAY_START} AND started_at < ${DAY_END}
        GROUP BY hour`,
    ),
    query<{ user_id: string; to_date: string }>(
      `SELECT user_id, DATE_FORMAT(to_date, '%Y-%m-%d') AS to_date
         FROM leave_requests
        WHERE status = 'approved' AND from_date <= ${TODAY} AND to_date >= ${TODAY}`,
    ),
    query<{ name: string; max_open_leads: number | null }>(
      `SELECT name, max_open_leads FROM desks
        WHERE is_active = 1 AND max_open_leads IS NOT NULL
        ORDER BY max_open_leads DESC, name ASC`,
    ),
    /* Each agent's desk maximum. Somebody on two desks is held to the lower
       of the two, which is the only reading that cannot promise too much. */
    query<{ user_id: string; name: string; max_open_leads: number | null }>(
      `SELECT dm.user_id, d.name, d.max_open_leads
         FROM desk_members dm
         JOIN desks d ON d.id = dm.desk_id AND d.is_active = 1
        WHERE d.max_open_leads IS NOT NULL
        ORDER BY d.max_open_leads ASC`,
    ),
    query<{ user_id: string; on_date: string; n: number }>(
      `SELECT user_id,
              DATE_FORMAT(CONVERT_TZ(started_at, '+00:00', ${DUBAI}), '%Y-%m-%d') AS on_date,
              COUNT(*) AS n
         FROM call_logs
        WHERE started_at >= DATE_SUB(${DAY_START}, INTERVAL 6 DAY)
        GROUP BY user_id, on_date`,
    ),
    /* How long the first answer took, over the window's new leads. */
    query<{ seconds: number }>(
      `SELECT TIMESTAMPDIFF(SECOND, created_at, first_response_at) AS seconds
         FROM opportunities
        WHERE deleted_at IS NULL AND first_response_at IS NOT NULL
          AND created_at >= ${w.from} AND created_at < ${w.to}`,
    ),
    /* The free leads, oldest first: the Incoming row names the first three. */
    query<Record<string, unknown>>(
      `SELECT o.id, o.created_at AS createdAt, o.is_vip AS isVip, c.full_name AS name
         FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
        WHERE o.status = 'open' AND o.owner_user_id IS NULL AND o.deleted_at IS NULL
        ORDER BY o.created_at ASC
        LIMIT 5`,
    ),
    /* Who the overdue follow-ups sit with — "3 with Bassam · 3 with Shan". */
    query<{ name: string; n: number }>(
      `SELECT u.name, COUNT(*) AS n
         FROM opportunities o
         JOIN users u ON u.id = o.owner_user_id
        WHERE o.status = 'open' AND o.deleted_at IS NULL
          AND o.next_step_at IS NOT NULL AND o.next_step_at < NOW(3)
        GROUP BY u.id, u.name
        ORDER BY n DESC, u.name ASC
        LIMIT 3`,
    ),
    queryOne<{ n: number; open_: number }>(
      `SELECT COUNT(*) AS n, SUM(answered_at IS NULL) AS open_
         FROM message_taps
        WHERE app = 'whatsapp'
          AND tapped_at >= ${DAY_START} AND tapped_at < ${DAY_END}`,
    ),
    queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities
        WHERE status = 'open' AND deleted_at IS NULL
          AND (last_contact_at IS NULL
               OR last_contact_at < DATE_SUB(NOW(3), INTERVAL 7 DAY))`,
    ),
    /* The newest leads, for the table below the fold. */
    query<Record<string, unknown>>(
      `SELECT o.id, c.full_name AS name, c.phone_e164 AS phone, o.project_name AS project,
              o.stage_key AS stage, o.is_vip AS isVip, o.created_at AS createdAt,
              u.name AS agent
         FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
         LEFT JOIN users u ON u.id = o.owner_user_id
        WHERE o.deleted_at IS NULL
        ORDER BY o.created_at DESC
        LIMIT 6`,
    ),
    /* The VIP leads this owner gave out, newest first. */
    query<Record<string, unknown>>(
      `SELECT v.id, v.opportunity_id AS leadId, v.created_at AS givenAt,
              v.deadline_at AS deadlineAt, v.accepted_at AS acceptedAt,
              v.first_call_at AS firstCallAt, v.returned_at AS returnedAt,
              c.full_name AS name, o.project_name AS project, o.stage_key AS stage,
              u.name AS agent
         FROM vip_handoffs v
         JOIN opportunities o ON o.id = v.opportunity_id AND o.deleted_at IS NULL
         JOIN contacts c ON c.id = o.contact_id
         JOIN users u ON u.id = v.given_to
        WHERE v.given_by = ?
        ORDER BY v.created_at DESC
        LIMIT 5`,
      [user.id],
    ),
    queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM vip_handoffs WHERE given_by = ?', [user.id],
    ),
    queryOne<Record<string, unknown>>(
      `SELECT u.name AS agent, o.project_name AS project, o.deal_value_aed AS valueAed
         FROM opportunities o
         LEFT JOIN users u ON u.id = o.owner_user_id
        WHERE o.status = 'won' AND o.deleted_at IS NULL
          AND o.stage_changed_at >= ${w.from} AND o.stage_changed_at < ${w.to}
        ORDER BY o.stage_changed_at DESC
        LIMIT 1`,
    ),
  ]);

  const onLeave = new Map(leaveToday.map((r) => [String(r.user_id), String(r.to_date)]));

  /* The lowest maximum of the desks somebody sits on. */
  const deskOf = new Map<string, { name: string; max: number }>();
  for (const row of deskMaxRows) {
    const key = String(row.user_id);
    if (deskOf.has(key)) continue;
    if (row.max_open_leads === null) continue;
    deskOf.set(key, { name: String(row.name), max: Number(row.max_open_leads) });
  }

  /* A week of calls per agent, from the one query above. */
  const byUser = new Map<string, Map<string, number>>();
  for (const r of sparkRows) {
    const key = String(r.user_id);
    if (!byUser.has(key)) byUser.set(key, new Map());
    byUser.get(key)?.set(String(r.on_date), Number(r.n));
  }
  const dubaiToday = new Date(Date.now() + 4 * 3_600_000);
  const week = Array.from({ length: 7 }, (_, i) => new Date(
    dubaiToday.getTime() - (6 - i) * 86_400_000,
  ).toISOString().slice(0, 10));

  const rows: OwnerTeamRow[] = team.map((r) => {
    const id = String(r.id);
    const desk = deskOf.get(id) ?? null;
    const theirs = byUser.get(id);
    return {
      id,
      name: String(r.name),
      photoUrl: (r.photoUrl as string | null) ?? null,
      marked: (r.marked as string | null) ?? null,
      wasLate: Number(r.wasLate ?? 0) === 1,
      onLeave: onLeave.has(id),
      checkedInAt: clockOf((r.markedAt as Date | null) ?? null),
      openLeads: Number(r.openLeads),
      callsToday: Number(r.callsToday),
      callsPerDay: week.map((d) => theirs?.get(d) ?? 0),
      deskMax: desk?.max ?? null,
      deskName: desk?.name ?? null,
      overdue: Number(r.overdue ?? 0),
      lastSeenAt: (r.lastSeenAt as Date | null) ?? null,
    };
  });

  /*
   * Problems first, which is the order the design's own table is built in:
   * absent, late, on leave, outside, then everybody in the office with the
   * busiest at the top. An owner reads down until the rows stop being
   * interesting, so the rows that need them must be at the top.
   */
  const trouble = (row: OwnerTeamRow): number => {
    if (!today.closed && row.marked === null && !row.onLeave) return 0;
    if (row.marked === 'office' && row.wasLate) return 1;
    if (row.onLeave) return 2;
    if (row.marked === 'outside') return 3;
    return 4;
  };
  rows.sort((a, b) => trouble(a) - trouble(b)
    || b.callsToday - a.callsToday
    || a.name.localeCompare(b.name));

  /* ── the hour chart ─────────────────────────────────────────────────── */

  const minutesNow = dubaiMinutesNow();
  const nowHour = Math.floor(minutesNow / 60);
  const day = dubaiToday.getUTCDay();
  const closedToday = settings.closedDays.includes(day);
  const open = closedToday ? null : Number((day === 6 ? settings.satStart : settings.start).slice(0, 2));
  const close = closedToday ? null : Number((day === 6 ? settings.satEnd : settings.end).slice(0, 2));
  const counted = new Map(callHours.map((r) => [Number(r.hour), Number(r.n)]));
  const hourList = homeHourRange(open, close, [...counted.keys()], nowHour);
  const hours: HomeHour[] = hourList.map((hour) => ({
    hour,
    calls: counted.get(hour) ?? 0,
    future: hour > nowHour,
  }));
  const firstHour = hourList[0];
  const lastHour = hourList[hourList.length - 1];
  const nowAcross = firstHour === undefined || lastHour === undefined || lastHour < firstHour
    ? null
    : Math.min(1, Math.max(0, (minutesNow - firstHour * 60) / ((lastHour - firstHour + 1) * 60)));
  const done = hours.filter((one) => !one.future && one.calls > 0);
  const bestHour = done.length === 0
    ? null
    : done.reduce((top, one) => (one.calls > top.calls ? one : top), done[0] as HomeHour).hour;

  /* ── the pipeline strip ─────────────────────────────────────────────── */

  const byStage = new Map(stageRows.map((r) => [String(r.stage_key), Number(r.n)]));
  const live = STAGE_STRIP.reduce((sum, s) => sum + (byStage.get(s.key) ?? 0), 0);
  const lostN = Number(totalsRow?.lost_ ?? 0);
  const everything = Number(totalsRow?.all_ ?? 0);

  /* ── what needs the owner, named ────────────────────────────────────── */

  const needsYou: OwnerHome['needsYou'] = [];
  const add = (
    kind: OwnerHome['needsYou'][number]['kind'],
    n: number, text: string, sub: string | null, action: string, to: string,
    waitMinutes: number | null,
  ) => { if (n > 0) needsYou.push({ kind, n, text, sub, action, to, waitMinutes }); };

  const vipLate = vipLateRows[0];
  if (vipLate) {
    const others = vipLateRows.length - 1;
    const had = vipLate.within === null || vipLate.within === undefined
      ? null : Number(vipLate.within);
    add(
      'vip_late', vipLateRows.length,
      `VIP ${String(vipLate.name ?? 'lead')} is not called`
        + (others > 0 ? ` · and ${others} more` : ''),
      `${String(vipLate.agent)} had ${had === null ? 'no time limit' : `${had} min`}`
        + (vipLate.ownerUserId === null ? ' · now back in Incoming' : ' · still with them'),
      'Give again', '/v2/incoming',
      minutesSince(vipLate.deadlineAt as Date | null),
    );
  }

  const approval = transferRows.filter((r) => String(r.status) === 'needs_approval');
  const firstTransfer = approval[0];
  if (firstTransfer) {
    add(
      'transfer', approval.length,
      approval.length === 1
        ? 'Transfer needs your approval'
        : `${approval.length} transfers need your approval`,
      `${String(firstTransfer.leadName ?? 'A lead')} · ${String(firstTransfer.fromName)} → `
        + `${String(firstTransfer.toName)} · stage `
        + `${STAGE_WORD[String(firstTransfer.stage)] ?? String(firstTransfer.stage)}`,
      'Approve', '/v2/transfers',
      minutesSince(firstTransfer.requestedAt as Date | null),
    );
  }

  const freeN = Number(free?.n ?? 0);
  if (freeN > 0) {
    const oldest = minutesSince(waitingRows[0]?.createdAt as Date | null);
    const named = waitingRows.slice(0, 3).map((r, i) => {
      const name = String(r.name ?? 'Unnamed lead');
      return i === 0 && oldest !== null ? `${name} waits ${spoken(oldest)}` : name;
    });
    add(
      'waiting', freeN,
      freeN === 1 ? '1 lead waits in Incoming' : `${freeN} leads wait in Incoming`,
      named.join(' · ') || null,
      'Give', '/v2/incoming',
      oldest,
    );
  }

  if (leaveRows.length > 0) {
    add(
      'leave', leaveRows.length,
      leaveRows.length === 1 ? '1 leave request' : `${leaveRows.length} leave requests`,
      leaveRows.slice(0, 3).map((r) => `${String(r.name)} `
        + dayRange(String(r.fromDate), String(r.toDate))).join(' · '),
      'Answer', '/v2/attendance',
      minutesSince(leaveRows[0]?.createdAt as Date | null),
    );
  }

  const missing = rows.filter((r) => r.marked === null && !r.onLeave);
  if (!today.closed && missing.length > 0) {
    const one = missing[0] as OwnerTeamRow;
    add(
      'absent', missing.length,
      missing.length === 1
        ? `${one.name} is absent`
        : `${missing.length} agents have not marked themselves in`,
      missing.length === 1
        ? `No check-in, no leave · ${one.openLeads} open ${one.openLeads === 1 ? 'lead' : 'leads'}`
        : missing.map((r) => r.name).slice(0, 4).join(' · '),
      'See', '/v2/attendance',
      null,
    );
  }

  const bugs = Number(bugRow?.n ?? 0);
  if (bugs > 0) {
    const said = String(bugRow?.body ?? '').replace(/\s+/g, ' ').trim();
    add(
      'bug', bugs,
      bugs === 1
        ? `Bug blocks ${String(bugRow?.name ?? 'an agent')}'s work`
        : `${bugs} bugs block the team's work`,
      said ? `${said.slice(0, 70)}${said.length > 70 ? '…' : ''}` : null,
      'Open', '/v2/settings/feedback',
      minutesSince(bugRow?.createdAt as Date | null),
    );
  }

  const answered = answerRows.map((r) => Number(r.seconds)).filter((n) => n >= 0);
  const firstContact = middle(answered);

  /* "Transfers today" means today, whatever the hero is still showing. */
  const startOfDay = new Date(dubaiToday.toISOString().slice(0, 10) + 'T00:00:00Z').getTime()
    - 4 * 3_600_000;
  const transfersToday = transferRows
    .filter((r) => new Date(r.requestedAt as Date).getTime() >= startOfDay).length;

  const absent = rows.filter((r) => r.marked === null && !r.onLeave).length;

  return {
    role: 'owner',
    me: { name: user.name, firstName: firstName(user.name) },
    now: dubaiNow(),
    clock: hhmm(minutesNow),
    period,
    needsYou,
    teamToday: {
      inOffice: rows.filter((r) => r.marked === 'office' && !r.wasLate).length,
      late: rows.filter((r) => r.marked === 'office' && r.wasLate).length,
      outside: rows.filter((r) => r.marked === 'outside').length,
      leave: rows.filter((r) => r.onLeave).length,
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
    work: {
      calls: Number(workRow?.calls ?? 0),
      callsPrevious: Number(workRow?.callsPrevious ?? 0),
      meetings: Number(workRow?.meetings ?? 0),
      units: Number(workRow?.units ?? 0),
      lastUnit: lastUnitRow
        ? {
          agent: (lastUnitRow.agent as string | null) ?? null,
          project: (lastUnitRow.project as string | null) ?? null,
          valueAed: lastUnitRow.valueAed === null || lastUnitRow.valueAed === undefined
            ? null : Number(lastUnitRow.valueAed),
        }
        : null,
      newLeadsToday: Number(todayRow?.newLeads ?? 0),
      newLeadsYesterday: Number(todayRow?.newLeadsYesterday ?? 0),
      firstContactMinutes: firstContact === null ? null : Math.round(firstContact / 60),
    },
    hours,
    nowAcross,
    bestHour,
    pipeline: {
      total: everything,
      open: Number(totalsRow?.open_ ?? 0),
      stages: STAGE_STRIP.map((s) => {
        const n = byStage.get(s.key) ?? 0;
        return {
          key: s.key,
          label: s.label,
          tone: s.tone,
          n,
          pct: live === 0 ? 0 : Math.round((n / live) * 1000) / 10,
        };
      }),
      lost: {
        n: lostN,
        pct: everything === 0 ? 0 : Math.round((lostN / everything) * 1000) / 10,
      },
    },
    teamRightNow: rows,
    desks: deskRows.map((r) => ({
      name: String(r.name),
      maxOpenLeads: r.max_open_leads === null ? null : Number(r.max_open_leads),
    })),
    watch: {
      overdue: {
        n: counts.overdue,
        who: overdueBy.map((r) => ({ name: String(r.name), n: Number(r.n) })),
      },
      noNextStep: counts.no_next_step,
      transfers: { n: transfersToday, needApproval: approval.length },
      taps: { n: Number(tapRow?.n ?? 0), unanswered: Number(tapRow?.open_ ?? 0) },
      cold: Number(coldRow?.n ?? 0),
    },
    latestLeads: latestRows.map((r) => ({
      id: String(r.id),
      name: (r.name as string | null) ?? null,
      phone: (r.phone as string | null) ?? null,
      project: (r.project as string | null) ?? null,
      stage: String(r.stage),
      agent: (r.agent as string | null) ?? null,
      isVip: Number(r.isVip ?? 0) === 1,
      createdAt: r.createdAt as Date,
    })),
    vipGiven: {
      total: Number(vipGivenTotal?.n ?? 0),
      rows: vipGivenRows.map((r) => ({
        id: String(r.id),
        leadId: String(r.leadId),
        name: (r.name as string | null) ?? null,
        agent: String(r.agent),
        project: (r.project as string | null) ?? null,
        givenAt: r.givenAt as Date,
        deadlineAt: (r.deadlineAt as Date | null) ?? null,
        acceptedAt: (r.acceptedAt as Date | null) ?? null,
        firstCallAt: (r.firstCallAt as Date | null) ?? null,
        returnedAt: (r.returnedAt as Date | null) ?? null,
        stage: String(r.stage),
      })),
    },
    freeLeads: freeN,
    banners: bannerRows,
    unread,
  };
}
