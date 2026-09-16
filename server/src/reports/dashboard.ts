/**
 * The dashboard's numbers.
 *
 * One endpoint feeds the whole screen, because eight separate requests on a
 * phone over a UAE mobile network is the difference between a dashboard that
 * appears and one that assembles itself in front of the user.
 *
 * Everything here is scoped to what the viewer may see: an agent's dashboard is
 * their own leads, a manager's is their team's, an owner's is all of them. The
 * scoping is applied in SQL, not filtered afterwards.
 *
 * The shaping functions are pure and tested; only `loadDashboard` touches the
 * database.
 */
import { query, queryOne, type Executor, getPool } from '../db/client.js';
import { ownerPredicate, visibleUserIds } from '../auth/scope.js';
import type { Role } from '../auth/rbac.js';
import { SPEED_TO_LEAD_TARGET_SECONDS, TIMEZONE_UTC_OFFSET_HOURS } from '../config/constants.js';

/** Ranges the dashboard offers, matching the 7D / 30D / 90D segmented control. */
export const DASHBOARD_RANGES = [7, 30, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

/** Rows down the arrivals heatmap, starting Monday as the design does. */
export const ARRIVAL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Twelve two-hour columns starting at 08:00 Dubai, as in the design. */
export const ARRIVAL_HOURS = ['8a', '10a', '12p', '2p', '4p', '6p', '8p', '10p', '12a', '2a', '4a', '6a'] as const;

const ARRIVAL_FIRST_HOUR = 8;
const ARRIVAL_BUCKET_HOURS = 2;

/** How the sources read in the UI. The keys are the LEAD_SOURCES values. */
const SOURCE_LABELS: Record<string, string> = {
  meta_lead_ads: 'Meta forms',
  meta_ctwa: 'Click-to-WhatsApp',
  google_ads: 'Google Ads',
  website: 'Website',
  whatsapp_direct: 'WhatsApp direct',
  csv_import: 'Imported',
  manual: 'Added by hand',
};

/**
 * Donut colours, in the order the design uses them: the brand teal first, then
 * progressively cooler and greyer, so the chart stays calm however many
 * sources appear.
 */
const SOURCE_COLOURS = ['#0AA3BA', '#5CC4C9', '#9FB6C8', '#C9D6E0', '#8FB3A8', '#B9C4D6', '#D6DDE4'];

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, ' ');
}

/** The middle value. Returns null for an empty set rather than 0, which would read as "instant". */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}

/** A whole-number percentage, guarding the empty denominator. */
export function percentage(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

export interface DayCount {
  date: string;
  value: number;
}

/**
 * Fills the gaps. SQL only returns days that had leads, but a chart with
 * missing days silently redraws a quiet week as a busy one.
 */
export function alignDays(rows: DayCount[], endDate: string, days: number): DayCount[] {
  const counts = new Map(rows.map((row) => [row.date, Number(row.value)]));
  const end = new Date(`${endDate}T00:00:00Z`);
  const out: DayCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(end.getTime() - i * 24 * 60 * 60 * 1000);
    const key = day.toISOString().slice(0, 10);
    out.push({ date: key, value: counts.get(key) ?? 0 });
  }
  return out;
}

export interface ArrivalRow {
  /** MySQL DAYOFWEEK: 1 = Sunday … 7 = Saturday. */
  dow: number;
  /** Hour of the day in Dubai, 0–23. */
  hour: number;
  n: number;
}

export interface ArrivalGrid {
  hours: string[];
  rows: { label: string; values: number[] }[];
  /** Plain-language summary, e.g. "Busiest: Sun–Tue, 8–11 PM". Null when empty. */
  busiest: string | null;
}

/** Which two-hour column an hour falls in, counting from 08:00. */
function arrivalBucket(hour: number): number {
  return Math.floor(((hour - ARRIVAL_FIRST_HOUR + 24) % 24) / ARRIVAL_BUCKET_HOURS);
}

/** MySQL's Sunday-first DAYOFWEEK into our Monday-first row index. */
function arrivalRowIndex(dow: number): number {
  return (dow + 5) % 7;
}

export function buildArrivalGrid(rows: ArrivalRow[]): ArrivalGrid {
  const values = ARRIVAL_DAYS.map(() => ARRIVAL_HOURS.map(() => 0));
  let total = 0;

  for (const row of rows) {
    const r = arrivalRowIndex(Number(row.dow));
    const c = arrivalBucket(Number(row.hour));
    const day = values[r];
    if (!day || c < 0 || c >= ARRIVAL_HOURS.length) continue;
    day[c] = (day[c] as number) + Number(row.n);
    total += Number(row.n);
  }

  return {
    hours: [...ARRIVAL_HOURS],
    rows: ARRIVAL_DAYS.map((label, i) => ({ label, values: values[i] as number[] })),
    busiest: total === 0 ? null : describeBusiest(values),
  };
}

/** Turns the grid's hot corner into a sentence an agent can act on. */
export function describeBusiest(values: number[][]): string | null {
  let best = { row: 0, column: 0, n: -1 };
  values.forEach((row, r) =>
    row.forEach((n, c) => {
      if (n > best.n) best = { row: r, column: c, n };
    }),
  );
  if (best.n <= 0) return null;

  const startHour = (ARRIVAL_FIRST_HOUR + best.column * ARRIVAL_BUCKET_HOURS) % 24;
  const endHour = (startHour + ARRIVAL_BUCKET_HOURS) % 24;
  const clock = (hour: number) => {
    const suffix = hour < 12 ? 'AM' : 'PM';
    const display = hour % 12 === 0 ? 12 : hour % 12;
    return `${display} ${suffix}`;
  };
  // Both ends of the window share a suffix more often than not, so say it once.
  const window =
    (startHour < 12) === (endHour < 12)
      ? `${startHour % 12 === 0 ? 12 : startHour % 12}–${clock(endHour)}`
      : `${clock(startHour)}–${clock(endHour)}`;

  return `Busiest: ${ARRIVAL_DAYS[best.row]}, ${window}`;
}

/** Two initials for an avatar, from however many words the name has. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  const last = words[words.length - 1] as string;
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first[0]}${last[0]}`.toUpperCase();
}

export interface Kpi {
  value: number;
  previous: number;
  /** Eight daily points for the sparkline, oldest first. */
  spark: number[];
}

export interface Dashboard {
  range: { days: number; from: string; to: string };
  kpis: {
    newLeads: Kpi;
    whatsappRepliedPct: Kpi;
    appointments: Kpi;
    reservations: Kpi & { pipelineValueAed: number };
  };
  series: { label: string; value: number; previous: number }[];
  sources: { label: string; value: number; colour: string }[];
  totalLeads: number;
  funnel: { label: string; value: number }[];
  speedToLead: {
    medianSeconds: number | null;
    targetSeconds: number;
    maxSeconds: number;
    slaBreaches: number;
  };
  arrivals: ArrivalGrid;
  /** Manager and above see the whole team; an agent sees only their own row. */
  leaderboard: {
    userId: string;
    name: string;
    initials: string;
    medianFirstReplySeconds: number | null;
    qualified: number;
    deals: number;
  }[];
}

/** `created_at` shifted into Dubai wall-clock, for day and hour grouping. */
const LOCAL = `DATE_ADD(o.created_at, INTERVAL ${TIMEZONE_UTC_OFFSET_HOURS} HOUR)`;

const SPARK_DAYS = 8;

export async function loadDashboard(
  viewer: { id: string; role: Role },
  days: DashboardRange,
  now: Date = new Date(),
  exec: Executor = getPool(),
): Promise<Dashboard> {
  const visible = await visibleUserIds(viewer, exec);
  const scope = ownerPredicate('o.owner_user_id', visible);

  const to = now;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  // The previous window of the same length, so the comparison is like for like.
  const previousFrom = new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
  const sparkFrom = new Date(to.getTime() - SPARK_DAYS * 24 * 60 * 60 * 1000);

  const dayKey = (date: Date) =>
    new Date(date.getTime() + TIMEZONE_UTC_OFFSET_HOURS * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [daily, previousDaily, sparkRows, sources, funnelRow, speedRows, arrivals, agents] =
    await Promise.all([
      query<DayCount>(
        `SELECT DATE(${LOCAL}) AS date, COUNT(*) AS value
           FROM opportunities o
          WHERE o.created_at >= ? AND o.created_at <= ? AND ${scope.sql}
          GROUP BY DATE(${LOCAL})`,
        [from, to, ...scope.params],
        exec,
      ),
      query<DayCount>(
        `SELECT DATE(${LOCAL}) AS date, COUNT(*) AS value
           FROM opportunities o
          WHERE o.created_at >= ? AND o.created_at < ? AND ${scope.sql}
          GROUP BY DATE(${LOCAL})`,
        [previousFrom, from, ...scope.params],
        exec,
      ),
      query<{ date: string; leads: number; replied: number; appointments: number; reservations: number }>(
        `SELECT DATE(${LOCAL}) AS date,
                COUNT(*) AS leads,
                SUM(CASE WHEN c.last_inbound_at IS NOT NULL THEN 1 ELSE 0 END) AS replied,
                SUM(CASE WHEN o.stage_key IN ('appointment_scheduled','deal_sent','won') THEN 1 ELSE 0 END) AS appointments,
                SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) AS reservations
           FROM opportunities o JOIN contacts c ON c.id = o.contact_id
          WHERE o.created_at >= ? AND o.created_at <= ? AND ${scope.sql}
          GROUP BY DATE(${LOCAL})`,
        [sparkFrom, to, ...scope.params],
        exec,
      ),
      query<{ source: string; n: number }>(
        `SELECT o.source, COUNT(*) AS n
           FROM opportunities o
          WHERE o.created_at >= ? AND o.created_at <= ? AND ${scope.sql}
          GROUP BY o.source ORDER BY n DESC`,
        [from, to, ...scope.params],
        exec,
      ),
      queryOne<{
        leads: number;
        valid: number;
        contacted: number;
        qualified: number;
        appointments: number;
        reservations: number;
        pipeline_value: number;
        sla_breaches: number;
      }>(
        `SELECT COUNT(*) AS leads,
                SUM(CASE WHEN o.sub_status <> 'invalid' OR o.sub_status IS NULL THEN 1 ELSE 0 END) AS valid,
                SUM(CASE WHEN o.first_touch_at IS NOT NULL THEN 1 ELSE 0 END) AS contacted,
                SUM(CASE WHEN o.stage_key IN ('engaged_qualified','appointment_scheduled','deal_sent','won') THEN 1 ELSE 0 END) AS qualified,
                SUM(CASE WHEN o.stage_key IN ('appointment_scheduled','deal_sent','won') THEN 1 ELSE 0 END) AS appointments,
                SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) AS reservations,
                SUM(CASE WHEN o.status = 'open' THEN COALESCE(o.deal_value_aed, 0) ELSE 0 END) AS pipeline_value,
                SUM(o.sla_breached) AS sla_breaches
           FROM opportunities o
          WHERE o.created_at >= ? AND o.created_at <= ? AND ${scope.sql}`,
        [from, to, ...scope.params],
        exec,
      ),
      query<{ seconds: number }>(
        `SELECT TIMESTAMPDIFF(SECOND, o.assigned_at, o.first_touch_at) AS seconds
           FROM opportunities o
          WHERE o.created_at >= ? AND o.created_at <= ? AND ${scope.sql}
            AND o.assigned_at IS NOT NULL AND o.first_touch_at IS NOT NULL
            AND o.first_touch_at >= o.assigned_at`,
        [from, to, ...scope.params],
        exec,
      ),
      query<ArrivalRow>(
        `SELECT DAYOFWEEK(${LOCAL}) AS dow, HOUR(${LOCAL}) AS hour, COUNT(*) AS n
           FROM opportunities o
          WHERE o.created_at >= ? AND o.created_at <= ? AND ${scope.sql}
          GROUP BY dow, hour`,
        [from, to, ...scope.params],
        exec,
      ),
      query<{ user_id: string; name: string; qualified: number; deals: number }>(
        `SELECT o.owner_user_id AS user_id, u.name,
                SUM(CASE WHEN o.stage_key IN ('engaged_qualified','appointment_scheduled','deal_sent','won') THEN 1 ELSE 0 END) AS qualified,
                SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) AS deals
           FROM opportunities o JOIN users u ON u.id = o.owner_user_id
          WHERE o.created_at >= ? AND o.created_at <= ? AND ${scope.sql}
          GROUP BY o.owner_user_id, u.name`,
        [from, to, ...scope.params],
        exec,
      ),
    ]);

  const replyTimes = await query<{ user_id: string; seconds: number }>(
    `SELECT o.owner_user_id AS user_id, TIMESTAMPDIFF(SECOND, o.assigned_at, o.first_touch_at) AS seconds
       FROM opportunities o
      WHERE o.created_at >= ? AND o.created_at <= ? AND ${scope.sql}
        AND o.assigned_at IS NOT NULL AND o.first_touch_at IS NOT NULL
        AND o.first_touch_at >= o.assigned_at`,
    [from, to, ...scope.params],
    exec,
  );

  const perAgentTimes = new Map<string, number[]>();
  for (const row of replyTimes) {
    const list = perAgentTimes.get(row.user_id) ?? [];
    list.push(Number(row.seconds));
    perAgentTimes.set(row.user_id, list);
  }

  const toDate = (value: unknown) => String(value).slice(0, 10);
  const current = alignDays(daily.map((r) => ({ date: toDate(r.date), value: Number(r.value) })), dayKey(to), days);
  const previous = alignDays(
    previousDaily.map((r) => ({ date: toDate(r.date), value: Number(r.value) })),
    dayKey(from),
    days,
  );

  const sparks = alignDays(
    sparkRows.map((r) => ({ date: toDate(r.date), value: 0 })),
    dayKey(to),
    SPARK_DAYS,
  ).map(({ date }) => {
    const row = sparkRows.find((r) => toDate(r.date) === date);
    return {
      date,
      leads: Number(row?.leads ?? 0),
      replied: Number(row?.replied ?? 0),
      appointments: Number(row?.appointments ?? 0),
      reservations: Number(row?.reservations ?? 0),
    };
  });

  const today = sparks[sparks.length - 1];
  const yesterday = sparks[sparks.length - 2];
  const totals = funnelRow ?? {
    leads: 0, valid: 0, contacted: 0, qualified: 0,
    appointments: 0, reservations: 0, pipeline_value: 0, sla_breaches: 0,
  };
  const leads = Number(totals.leads ?? 0);

  const previousTotal = previous.reduce((sum, day) => sum + day.value, 0);
  const currentTotal = current.reduce((sum, day) => sum + day.value, 0);
  const repliedThisPeriod = sparks.reduce((sum, day) => sum + day.replied, 0);
  const leadsThisPeriod = sparks.reduce((sum, day) => sum + day.leads, 0);

  const dayLabel = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const visibleAgents = agents.filter((row) => row.user_id);

  return {
    range: { days, from: from.toISOString(), to: to.toISOString() },
    kpis: {
      newLeads: {
        value: Number(today?.leads ?? 0),
        previous: Number(yesterday?.leads ?? 0),
        spark: sparks.map((d) => d.leads),
      },
      whatsappRepliedPct: {
        value: percentage(repliedThisPeriod, leadsThisPeriod),
        previous: percentage(
          sparks.slice(0, -1).reduce((s, d) => s + d.replied, 0),
          sparks.slice(0, -1).reduce((s, d) => s + d.leads, 0),
        ),
        spark: sparks.map((d) => percentage(d.replied, d.leads)),
      },
      appointments: {
        value: Number(totals.appointments ?? 0),
        previous: 0,
        spark: sparks.map((d) => d.appointments),
      },
      reservations: {
        value: Number(totals.reservations ?? 0),
        previous: 0,
        spark: sparks.map((d) => d.reservations),
        pipelineValueAed: Number(totals.pipeline_value ?? 0),
      },
    },
    series: current.map((day, i) => ({
      label: dayLabel(day.date),
      value: day.value,
      previous: previous[i]?.value ?? 0,
    })),
    sources: sources.map((row, i) => ({
      label: sourceLabel(row.source),
      value: Number(row.n),
      colour: SOURCE_COLOURS[i % SOURCE_COLOURS.length] as string,
    })),
    totalLeads: currentTotal,
    funnel: [
      { label: 'Leads', value: leads },
      { label: 'Valid number', value: Number(totals.valid ?? 0) },
      { label: 'Contacted', value: Number(totals.contacted ?? 0) },
      { label: 'Qualified', value: Number(totals.qualified ?? 0) },
      { label: 'Appointments', value: Number(totals.appointments ?? 0) },
      { label: 'Reservations', value: Number(totals.reservations ?? 0) },
    ],
    speedToLead: {
      medianSeconds: median(speedRows.map((r) => Number(r.seconds)).filter(Number.isFinite)),
      targetSeconds: SPEED_TO_LEAD_TARGET_SECONDS,
      maxSeconds: SPEED_TO_LEAD_TARGET_SECONDS * 2,
      slaBreaches: Number(totals.sla_breaches ?? 0),
    },
    arrivals: buildArrivalGrid(arrivals),
    leaderboard: visibleAgents
      .map((row) => ({
        userId: row.user_id,
        name: row.name,
        initials: initials(row.name),
        medianFirstReplySeconds: median(perAgentTimes.get(row.user_id) ?? []),
        qualified: Number(row.qualified ?? 0),
        deals: Number(row.deals ?? 0),
      }))
      // Outcomes first, speed second — the same order the weekly award uses.
      .sort(
        (a, b) =>
          b.deals - a.deals ||
          b.qualified - a.qualified ||
          (a.medianFirstReplySeconds ?? Number.MAX_SAFE_INTEGER) -
            (b.medianFirstReplySeconds ?? Number.MAX_SAFE_INTEGER),
      )
      .slice(0, 8),
  };
}
