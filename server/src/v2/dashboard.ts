/**
 * The owner's full dashboard — `design/web/dashboard.html`, page 32.
 *
 * The owner's home (`/v2`) answers "what needs me now". This answers "how are
 * we doing", which is a different question and a different screen: totals, the
 * stage strip, fourteen days of new leads, the projects and sources behind
 * them, every agent in one table, and the leads going cold.
 *
 * Two rules the design is explicit about, and both are easy to get wrong:
 *
 *  - **The period switch changes calls, meetings and units only.** How many
 *    leads exist, what stage they are in and which are untouched are facts
 *    about now, not about a window. An owner who picks "Year" and watches the
 *    lead total change has been told something untrue.
 *  - **Lost is kept apart.** It is drawn outside the stage strip's proportions
 *    because a pipeline that counts its dead is not a pipeline.
 *
 * This is an owner-and-admin screen (`docs/v2/pages.md` §32 marks it O/Ad), so
 * nothing below is scoped to one person's leads. The route is what enforces
 * that; `requireRole` in `v2.ts` is the only door in.
 *
 * Every number here is a real query. Where the design draws a figure we do not
 * record, the field is null and the screen leaves that block out — see
 * CLAUDE.md: never invent a figure.
 */
import { query, queryOne } from '../db/client.js';
import type { SessionUser } from '../auth/sessions.js';
import { DAY_END, DAY_START, TODAY } from './dubai.js';
import { dayState } from '../attendance/attendance.js';
import { assign } from '../assignment/apply.js';
import { badRequest } from '../lib/errors.js';
import type { AuditActor } from '../audit/audit.js';
import { countedAgentSql } from '../users/counting.js';

export const PERIODS = ['today', 'week', 'month', 'year'] as const;
export type Period = (typeof PERIODS)[number];

/** How many days each period covers, counting today as one of them. */
const DAYS: Record<Period, number> = { today: 1, week: 7, month: 30, year: 365 };

/** How many days of history the "new leads per day" chart draws. */
const CHART_DAYS = 14;

/** No contact for this many days is "going cold". The design says 7. */
const COLD_DAYS = 7;

/**
 * The six stages a live lead can be in, in the order the design draws them,
 * with the class the design's own stylesheet keys its colour off.
 */
export const STAGE_STRIP = [
  { key: 'new_lead', label: 'New', tone: 'new' },
  { key: 'attempted_contact', label: 'Called', tone: 'called' },
  { key: 'engaged_qualified', label: 'Interested', tone: 'interested' },
  { key: 'appointment_scheduled', label: 'Meeting', tone: 'meeting' },
  { key: 'deal_sent', label: 'Offer', tone: 'offer' },
  { key: 'won', label: 'Won', tone: 'won' },
] as const;

export interface AgentRow {
  userId: string;
  name: string;
  photoUrl: string | null;
  /** 'office' | 'outside' | null, plus whether they were late. */
  marked: string | null;
  wasLate: boolean;
  onLeave: boolean;
  /** Calls, meetings and units follow the period switch. */
  calls: number;
  meetings: number;
  units: number;
  /** A week of calls, oldest first, for the sparkline. */
  callsPerDay: number[];
  /** Open leads and overdue follow-ups are facts about now. */
  open: number;
  overdue: number;
  /** The desk's agreed maximum open leads, when they are on one. */
  deskMax: number | null;
  deskName: string | null;
}

/**
 * One row of the morning brief.
 *
 * `design/web/dashboard.html` draws three: an agent on leave whose leads have
 * nobody, an agent over their desk maximum, and the leads nobody has touched.
 * Each carries its own reason on the line underneath — not the button's word,
 * which is what made the card read "Move 31 / Move 31".
 */
export interface BriefRow {
  kind: 'leave' | 'overload' | 'untouched';
  text: string;
  sub: string;
  action: string;
  to: string;
  /** Set when the row's button opens the Move dialog. */
  move: { userId: string; name: string; leads: number } | null;
}

/** Somebody who could be given leads, for the Move dialog's picker. */
export interface Assignable {
  userId: string;
  name: string;
  openLeads: number;
  /** 'office' | 'outside' | 'leave' | 'absent'. */
  where: string;
  /** People on leave or absent cannot be chosen — the design says so. */
  canTake: boolean;
}

export interface ColdAgent {
  userId: string;
  name: string;
  marked: string | null;
  onLeave: boolean;
  leads: number;
  cold: number;
}

export interface FullDashboard {
  period: Period;
  days: number;
  /** Dubai wall clock, so the stamp matches the office. */
  now: string;
  totals: {
    all: number;
    open: number;
    lost: number;
    untouched: number;
    newToday: number;
    /** New today against the same hour yesterday, so it is a fair read. */
    newTodayDelta: number;
  };
  work: {
    calls: number;
    callsPrevious: number;
    meetings: number;
    meetingsPrevious: number;
    units: number;
    unitsValueAed: number | null;
    /** Share of the period's new leads first answered inside two hours. */
    touchedIn2hPct: number | null;
    touchedIn2hOf: number;
    /** Median minutes to the first answer, over the period's new leads. */
    firstAnswerMinutes: number | null;
  };
  stages: Array<{ key: string; label: string; tone: string; n: number; pct: number }>;
  lost: { n: number; pct: number };
  perDay: {
    total: number;
    previous: number;
    days: Array<{ date: string; label: string; n: number; weekend: boolean }>;
  };
  projects: Array<{ name: string; n: number; won: number }>;
  sources: Array<{ key: string; n: number }>;
  teamToday: {
    inOffice: number; late: number; outside: number; leave: number; absent: number;
    closed: boolean;
  };
  agents: AgentRow[];
  cold: { total: number; agents: ColdAgent[] };
  /** The morning brief's three rows, each with its own reason. */
  brief: BriefRow[];
  /** The desks and their agreed maximums, for the Open column's foot. */
  desks: Array<{ name: string; maxOpenLeads: number | null }>;
  /** Who the Move dialog may offer. */
  assignable: Assignable[];
}

/**
 * The window, and the one before it, as SQL.
 *
 * Both start at a Dubai midnight rather than at `NOW() - 7 days`: a week that
 * begins at 14:32 on the eighth day back counts half of that day and makes
 * this screen disagree with every other one. See `dubai.ts`.
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

function dubaiNow(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(at);
}

/** The median of a sorted-or-not list, or null when there is nothing to take it of. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export async function fullDashboard(user: SessionUser, period: Period): Promise<FullDashboard> {
  const w = window(period);
  const today = await dayState(user.id, null);

  const [
    totalsRow, workRow, stageRows, dayRows, projectRows, sourceRows,
    team, leaveRows, coldRow, answerRows, deskRows, deskMaxRows,
  ] = await Promise.all([
    /*
     * The totals, in one pass. `open` and `untouched` are counted here rather
     * than taken from the lead tabs because neither is a tab: untouched means
     * nobody has ever reached this person, which is not the same as overdue.
     */
    queryOne<Record<string, number>>(
      `SELECT
         SUM(o.deleted_at IS NULL) AS all_,
         SUM(o.deleted_at IS NULL AND o.status = 'open') AS open_,
         SUM(o.deleted_at IS NULL AND o.status = 'lost') AS lost_,
         SUM(o.deleted_at IS NULL AND o.status = 'open' AND o.last_contact_at IS NULL)
           AS untouched,
         SUM(o.deleted_at IS NULL
             AND o.created_at >= ${DAY_START} AND o.created_at < ${DAY_END}) AS new_today,
         SUM(o.deleted_at IS NULL
             AND o.created_at >= DATE_SUB(${DAY_START}, INTERVAL 1 DAY)
             AND o.created_at < DATE_SUB(NOW(3), INTERVAL 1 DAY)) AS new_yesterday
         FROM opportunities o`,
    ),
    /* Calls, meetings and units — the three the period switch moves. */
    queryOne<Record<string, number | null>>(
      `SELECT
         (SELECT COUNT(*) FROM call_logs
           WHERE started_at >= ${w.from} AND started_at < ${w.to}) AS calls,
         (SELECT COUNT(*) FROM call_logs
           WHERE started_at >= ${w.prevFrom} AND started_at < ${w.prevTo}) AS calls_prev,
         (SELECT COUNT(*) FROM meetings
           WHERE deleted_at IS NULL
             AND starts_at >= ${w.from} AND starts_at < ${w.to}) AS meetings,
         (SELECT COUNT(*) FROM meetings
           WHERE deleted_at IS NULL
             AND starts_at >= ${w.prevFrom} AND starts_at < ${w.prevTo}) AS meetings_prev,
         (SELECT COUNT(*) FROM opportunities
           WHERE status = 'won' AND deleted_at IS NULL
             AND stage_changed_at >= ${w.from} AND stage_changed_at < ${w.to}) AS units,
         (SELECT SUM(deal_value_aed) FROM opportunities
           WHERE status = 'won' AND deleted_at IS NULL
             AND stage_changed_at >= ${w.from} AND stage_changed_at < ${w.to}) AS units_value`,
    ),
    /* One row per stage. Lost comes back with the rest and is split off below. */
    query<{ stage_key: string; n: number }>(
      `SELECT stage_key, COUNT(*) AS n
         FROM opportunities
        WHERE deleted_at IS NULL
        GROUP BY stage_key`,
    ),
    /*
     * Fourteen days of new leads, imports not counted — the design says so,
     * and it is right: two hundred rows pasted in from a spreadsheet is not a
     * day's work and would flatten every real day on the chart.
     */
    query<{ on_date: string; n: number }>(
      `SELECT DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+04:00'), '%Y-%m-%d') AS on_date,
              COUNT(*) AS n
         FROM opportunities
        WHERE deleted_at IS NULL AND import_id IS NULL
          AND created_at >= DATE_SUB(${DAY_START}, INTERVAL ${CHART_DAYS * 2 - 1} DAY)
        GROUP BY on_date`,
    ),
    /* The projects agents are working now. A lead with no project is not one. */
    query<{ name: string; n: number; won: number }>(
      `SELECT project_name AS name, COUNT(*) AS n,
              SUM(status = 'won') AS won
         FROM opportunities
        WHERE deleted_at IS NULL AND project_name IS NOT NULL AND project_name <> ''
        GROUP BY project_name
        ORDER BY n DESC
        LIMIT 6`,
    ),
    query<{ source: string | null; n: number }>(
      `SELECT source, COUNT(*) AS n
         FROM opportunities
        WHERE deleted_at IS NULL
        GROUP BY source
        ORDER BY n DESC`,
    ),
    /*
     * Every agent, with the period's work and a week of calls, in one query.
     * Ten agents was ten round trips before, and the next hire made it eleven.
     */
    query<Record<string, unknown>>(
      `SELECT u.id, u.name, u.photo_url AS photoUrl, a.kind AS marked, a.was_late AS wasLate,
              (SELECT COUNT(*) FROM call_logs cl
                WHERE cl.user_id = u.id
                  AND cl.started_at >= ${w.from} AND cl.started_at < ${w.to}) AS calls,
              (SELECT COUNT(*) FROM meetings m
                WHERE m.user_id = u.id AND m.deleted_at IS NULL
                  AND m.starts_at >= ${w.from} AND m.starts_at < ${w.to}) AS meetings,
              (SELECT COUNT(*) FROM opportunities o
                WHERE o.owner_user_id = u.id AND o.status = 'won' AND o.deleted_at IS NULL
                  AND o.stage_changed_at >= ${w.from} AND o.stage_changed_at < ${w.to})
                AS units,
              (SELECT COUNT(*) FROM opportunities o
                WHERE o.owner_user_id = u.id AND o.status = 'open' AND o.deleted_at IS NULL)
                AS open_,
              (SELECT COUNT(*) FROM opportunities o
                WHERE o.owner_user_id = u.id AND o.status = 'open' AND o.deleted_at IS NULL
                  AND o.next_step_at IS NOT NULL AND o.next_step_at < NOW(3)) AS overdue
         FROM users u
         LEFT JOIN attendance a ON a.user_id = u.id AND a.on_date = ${TODAY}
        WHERE u.is_active = 1 AND ${countedAgentSql()}
        ORDER BY calls DESC, u.name ASC`,
    ),
    /* Who is on approved leave today, and the day they are back. */
    query<{ user_id: string; to_date: string }>(
      `SELECT user_id, DATE_FORMAT(to_date, '%Y-%m-%d') AS to_date
         FROM leave_requests
        WHERE status = 'approved' AND from_date <= ${TODAY} AND to_date >= ${TODAY}`,
    ),
    queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities
        WHERE status = 'open' AND deleted_at IS NULL
          AND (last_contact_at IS NULL OR last_contact_at < DATE_SUB(NOW(3), INTERVAL ${COLD_DAYS} DAY))`,
    ),
    /*
     * How long the first answer took, for every lead that arrived in the
     * period. Read as rows rather than as a MEDIAN() the database does not
     * have; the period caps how many come back.
     */
    query<{ seconds: number }>(
      `SELECT TIMESTAMPDIFF(SECOND, created_at, first_response_at) AS seconds
         FROM opportunities
        WHERE deleted_at IS NULL AND first_response_at IS NOT NULL
          AND created_at >= ${w.from} AND created_at < ${w.to}`,
    ),
    /* The desks the Open column measures against, named in its foot. */
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
  ]);

  const onLeave = new Set(leaveRows.map((r) => String(r.user_id)));
  /* "Back Thursday" — the day after the last day of leave, named. */
  const leaveBack = new Map(leaveRows.map((r) => {
    const last = new Date(`${String(r.to_date).slice(0, 10)}T00:00:00Z`);
    const back = new Date(last.getTime() + 86_400_000);
    return [String(r.user_id), back.toLocaleDateString('en-GB', {
      weekday: 'long', timeZone: 'UTC',
    })] as const;
  }));

  const deskOf = new Map<string, { name: string; max: number }>();
  for (const row of deskMaxRows) {
    const key = String(row.user_id);
    if (deskOf.has(key) || row.max_open_leads === null) continue;
    deskOf.set(key, { name: String(row.name), max: Number(row.max_open_leads) });
  }

  const rows: AgentRow[] = team.map((r) => ({
    userId: String(r.id),
    name: String(r.name),
    photoUrl: (r.photoUrl as string | null) ?? null,
    marked: (r.marked as string | null) ?? null,
    wasLate: Number(r.wasLate ?? 0) === 1,
    onLeave: onLeave.has(String(r.id)),
    calls: Number(r.calls ?? 0),
    meetings: Number(r.meetings ?? 0),
    units: Number(r.units ?? 0),
    callsPerDay: [],
    open: Number(r.open_ ?? 0),
    overdue: Number(r.overdue ?? 0),
    deskMax: deskOf.get(String(r.id))?.max ?? null,
    deskName: deskOf.get(String(r.id))?.name ?? null,
  }));

  /* A week of calls per agent, one query for the whole team. */
  if (rows.length > 0) {
    const spark = await query<{ user_id: string; on_date: string; n: number }>(
      `SELECT user_id,
              DATE_FORMAT(CONVERT_TZ(started_at, '+00:00', '+04:00'), '%Y-%m-%d') AS on_date,
              COUNT(*) AS n
         FROM call_logs
        WHERE started_at >= DATE_SUB(${DAY_START}, INTERVAL 6 DAY)
        GROUP BY user_id, on_date`,
    );
    const byUser = new Map<string, Map<string, number>>();
    for (const r of spark) {
      const key = String(r.user_id);
      if (!byUser.has(key)) byUser.set(key, new Map());
      byUser.get(key)?.set(String(r.on_date), Number(r.n));
    }
    const dubaiToday = new Date(Date.now() + 4 * 3_600_000);
    const week = Array.from({ length: 7 }, (_, i) => new Date(
      dubaiToday.getTime() - (6 - i) * 86_400_000,
    ).toISOString().slice(0, 10));
    for (const row of rows) {
      const theirs = byUser.get(row.userId);
      row.callsPerDay = week.map((d) => theirs?.get(d) ?? 0);
    }
  }

  /* Leads going cold, per agent, over the same agents the table shows. */
  const coldByAgent = await query<{ user_id: string; leads: number; cold: number }>(
    `SELECT owner_user_id AS user_id, COUNT(*) AS leads,
            SUM(last_contact_at IS NULL
                OR last_contact_at < DATE_SUB(NOW(3), INTERVAL ${COLD_DAYS} DAY)) AS cold
       FROM opportunities
      WHERE status = 'open' AND deleted_at IS NULL AND owner_user_id IS NOT NULL
      GROUP BY owner_user_id
      HAVING cold > 0
      ORDER BY cold DESC
      LIMIT 5`,
  );
  const named = new Map(rows.map((r) => [r.userId, r]));

  const byStage = new Map(stageRows.map((r) => [String(r.stage_key), Number(r.n)]));
  const live = STAGE_STRIP.reduce((sum, s) => sum + (byStage.get(s.key) ?? 0), 0);
  const lostN = Number(totalsRow?.lost_ ?? 0);
  const everything = Number(totalsRow?.all_ ?? 0);

  /* Fourteen days out of twenty-eight read: the chart, and the fortnight
     before it to say whether the chart is up or down. */
  const perDayMap = new Map(dayRows.map((r) => [String(r.on_date), Number(r.n)]));
  const dubaiToday = new Date(Date.now() + 4 * 3_600_000);
  const days = Array.from({ length: CHART_DAYS }, (_, i) => {
    const at = new Date(dubaiToday.getTime() - (CHART_DAYS - 1 - i) * 86_400_000);
    const date = at.toISOString().slice(0, 10);
    return {
      date,
      label: String(at.getUTCDate()),
      n: perDayMap.get(date) ?? 0,
      /* Friday and Saturday are the UAE weekend. */
      weekend: at.getUTCDay() === 5 || at.getUTCDay() === 6,
    };
  });
  const before = Array.from({ length: CHART_DAYS }, (_, i) => {
    const at = new Date(dubaiToday.getTime() - (CHART_DAYS * 2 - 1 - i) * 86_400_000);
    return perDayMap.get(at.toISOString().slice(0, 10)) ?? 0;
  }).reduce((a, b) => a + b, 0);

  const answered = answerRows.map((r) => Number(r.seconds)).filter((n) => n >= 0);
  const newInPeriod = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM opportunities
      WHERE deleted_at IS NULL AND created_at >= ${w.from} AND created_at < ${w.to}`,
  );
  const arrived = Number(newInPeriod?.n ?? 0);
  const inTwoHours = answered.filter((s) => s <= 2 * 3600).length;

  const absent = rows.filter((r) => r.marked === null && !r.onLeave).length;

  /*
   * The morning brief — the design's own three rows.
   *
   * Each one is a problem somebody has to decide about, and each carries its
   * reason on the line underneath. Rows that are not true today are simply
   * absent: an empty brief says nothing needs a decision, which is a thing
   * worth saying.
   */
  const brief: BriefRow[] = [];
  const away = rows
    .filter((r) => r.onLeave && r.open > 0)
    .sort((a, b) => b.open - a.open)[0];
  if (away) {
    const back = leaveBack.get(away.userId) ?? null;
    brief.push({
      kind: 'leave',
      text: `${away.name} is on leave · ${away.open} ${away.open === 1 ? 'lead has' : 'leads have'} nobody`,
      sub: `${back ? `Back ${back}` : 'On leave'}`
        + (away.overdue > 0
          ? ` · ${away.overdue} follow-${away.overdue === 1 ? 'up is' : 'ups are'} already overdue`
          : ' · no follow-up is overdue yet'),
      action: `Move ${away.open}`,
      to: `/v2/team/${away.userId}`,
      move: { userId: away.userId, name: away.name, leads: away.open },
    });
  }
  const over = rows
    .filter((r) => r.deskMax !== null && r.open > (r.deskMax ?? 0))
    .sort((a, b) => (b.open - (b.deskMax ?? 0)) - (a.open - (a.deskMax ?? 0)))[0];
  if (over) {
    brief.push({
      kind: 'overload',
      text: `${over.name} has ${over.open} leads · maximum is ${over.deskMax}`,
      sub: `${over.deskName ?? 'Their desk'}`
        + (over.overdue > 0 ? ` · ${over.overdue} follow-ups overdue` : ' · nothing overdue'),
      action: 'View',
      to: `/v2/team/${over.userId}`,
      move: null,
    });
  }
  const untouched = Number(totalsRow?.untouched ?? 0);
  if (untouched > 0) {
    brief.push({
      kind: 'untouched',
      text: `${untouched} ${untouched === 1 ? 'lead is' : 'leads are'} not touched yet`,
      sub: 'Nobody has called or messaged them since they arrived',
      action: 'View',
      to: '/v2/leads?tab=new',
      move: null,
    });
  }

  /* Who the Move dialog may offer, fewest open leads first. */
  const assignable: Assignable[] = [...rows]
    .sort((a, b) => a.open - b.open || a.name.localeCompare(b.name))
    .map((r) => {
      const where = r.onLeave ? 'leave'
        : r.marked === 'outside' ? 'outside'
          : r.marked === 'office' ? 'office' : 'absent';
      return {
        userId: r.userId,
        name: r.name,
        openLeads: r.open,
        where,
        canTake: where !== 'leave' && where !== 'absent',
      };
    });

  return {
    period,
    days: DAYS[period],
    now: dubaiNow(),
    brief,
    desks: deskRows.map((r) => ({
      name: String(r.name),
      maxOpenLeads: r.max_open_leads === null ? null : Number(r.max_open_leads),
    })),
    assignable,
    totals: {
      all: everything,
      open: Number(totalsRow?.open_ ?? 0),
      lost: lostN,
      untouched: Number(totalsRow?.untouched ?? 0),
      newToday: Number(totalsRow?.new_today ?? 0),
      newTodayDelta: Number(totalsRow?.new_today ?? 0) - Number(totalsRow?.new_yesterday ?? 0),
    },
    work: {
      calls: Number(workRow?.calls ?? 0),
      callsPrevious: Number(workRow?.calls_prev ?? 0),
      meetings: Number(workRow?.meetings ?? 0),
      meetingsPrevious: Number(workRow?.meetings_prev ?? 0),
      units: Number(workRow?.units ?? 0),
      unitsValueAed: workRow?.units_value === null || workRow?.units_value === undefined
        ? null : Number(workRow.units_value),
      touchedIn2hPct: arrived === 0 ? null : Math.round((inTwoHours / arrived) * 100),
      touchedIn2hOf: arrived,
      firstAnswerMinutes: (() => {
        const m = median(answered);
        return m === null ? null : Math.round(m / 60);
      })(),
    },
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
    perDay: {
      total: days.reduce((a, b) => a + b.n, 0),
      previous: before,
      days,
    },
    projects: projectRows.map((r) => ({
      name: String(r.name), n: Number(r.n), won: Number(r.won ?? 0),
    })),
    sources: sourceRows.map((r) => ({ key: r.source ?? 'unknown', n: Number(r.n) })),
    teamToday: {
      inOffice: rows.filter((r) => r.marked === 'office' && !r.wasLate).length,
      late: rows.filter((r) => r.marked === 'office' && r.wasLate).length,
      outside: rows.filter((r) => r.marked === 'outside').length,
      leave: rows.filter((r) => r.onLeave).length,
      absent: today.closed ? 0 : absent,
      closed: today.closed,
    },
    agents: rows,
    cold: {
      total: Number(coldRow?.n ?? 0),
      agents: coldByAgent.map((r) => {
        const who = named.get(String(r.user_id));
        return {
          userId: String(r.user_id),
          name: who?.name ?? 'Someone who has left',
          marked: who?.marked ?? null,
          onLeave: who?.onLeave ?? false,
          leads: Number(r.leads),
          cold: Number(r.cold ?? 0),
        };
      }),
    },
  };
}

/**
 * Where the leads go when an owner presses "Move".
 *
 * `design/web/dashboard.html` offers three and no more: share them equally
 * between the agents in the office, give them all to one person, or put them
 * back in Incoming where anybody may take one. "People on leave or absent
 * cannot be chosen" is the dialog's own hint and is enforced here as well,
 * because a hint in a dialog is not a rule.
 */
export type MoveTo =
  | { kind: 'pool' }
  | { kind: 'agent'; userId: string }
  | { kind: 'share'; userIds: string[] };

/**
 * Take every open lead off one agent and give them somewhere else.
 *
 * This is the design's "Move 31" button, on the Going cold card and on the
 * morning brief. Emir's case for it, 10 Nov: an agent goes on leave with
 * thirty-one leads and nobody can reach any of them until he notices. The
 * button is on the card that notices.
 *
 * Reuses the bulk machinery rather than writing its own UPDATE, so one audit
 * row, one set of rules, and the lead assignment history stays straight.
 * Incoming stays the default, because the owner chose that agent once and the
 * CRM should not choose the next one for him unless he says so.
 */
export async function movePool(
  actor: AuditActor,
  userId: string,
  to: MoveTo = { kind: 'pool' },
): Promise<{ moved: number; name: string | null; to: string }> {
  const who = await queryOne<{ name: string }>(
    'SELECT name FROM users WHERE id = ?', [userId],
  );
  const leads = await query<{ id: string }>(
    `SELECT id FROM opportunities
      WHERE owner_user_id = ? AND status = 'open' AND deleted_at IS NULL`,
    [userId],
  );

  /* Nobody on leave or absent, and never back to the person it came from. */
  let taking: Array<{ id: string; name: string }> = [];
  if (to.kind !== 'pool') {
    const asked = new Set(to.kind === 'agent' ? [to.userId] : to.userIds);
    const ok = await query<{ id: string; name: string }>(
      `SELECT u.id, u.name
         FROM users u
         JOIN attendance a ON a.user_id = u.id AND a.on_date = ${TODAY}
        WHERE u.is_active = 1 AND ${countedAgentSql()}
          AND u.id <> ?
          AND u.id NOT IN (
            SELECT user_id FROM leave_requests
             WHERE status = 'approved' AND from_date <= ${TODAY} AND to_date >= ${TODAY})`,
      [userId],
    );
    taking = ok
      .filter((r) => asked.has(String(r.id)))
      .map((r) => ({ id: String(r.id), name: String(r.name) }));
    if (taking.length === 0) {
      throw badRequest(
        'Nobody you chose can take leads today. People on leave or absent cannot be chosen.',
      );
    }
  }

  const where = to.kind === 'pool' ? 'Incoming'
    : taking.length === 1 ? (taking[0] as { name: string }).name
      : `${taking.length} agents`;

  if (leads.length === 0) return { moved: 0, name: who?.name ?? null, to: where };

  /*
   * `assign` rather than `runBulkAction`: the share needs `userIds`, which the
   * bulk action's shape cannot carry, and without it `split_even` quietly
   * means the whole floor rather than the people who were ticked.
   */
  const result = await assign(actor, {
    method: to.kind === 'pool' ? 'pool' : taking.length === 1 ? 'agent' : 'split_even',
    userId: taking.length === 1 ? (taking[0] as { id: string }).id : null,
    teamId: null,
    userIds: taking.length > 0 ? taking.map((one) => one.id) : null,
    opportunityIds: leads.map((r) => String(r.id)),
    reason: `moved off ${who?.name ?? 'an agent'} from the dashboard`,
  });
  return { moved: result.assigned + result.pooled, name: who?.name ?? null, to: where };
}
