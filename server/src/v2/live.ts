import { query, queryOne } from '../db/client.js';
import { ownerPredicate, visibleUserIds } from '../auth/scope.js';
import type { SessionUser } from '../auth/sessions.js';
import { dubaiDay, dubaiMinutes } from '../attendance/attendance.js';
import { attendanceSettings } from '../attendance/settings.js';
import { DAY_END, DAY_START, DUBAI, TODAY } from './dubai.js';

/**
 * What the team is doing right now.
 *
 * `design/web/team-live.html`. The owner's screen for the middle of the day:
 * not a report to read afterwards, but the one question "is anybody actually
 * ringing these leads". So everything here is today only, counted in Dubai
 * hours, and nothing is averaged over a week.
 *
 * Three things are counted and they are deliberately the same three the
 * dialler and the messaging report count, from the same two tables, so the
 * figures can never disagree with each other:
 *
 *  - a **call** is a tap on Call (`call_logs`), not a connected phone call;
 *  - a **WhatsApp** or **Telegram** click is a tap that opened the app
 *    (`message_taps`), never "sent" — the agent presses send in the real app;
 *  - a click **not checked in** is a call started while attendance said the
 *    agent was not in yet, which `call_logs.not_checked_in` already records.
 *
 * What the design draws and this does not send: a sentence per agent saying
 * "On a call · Aisha Noor". Nothing records which lead an agent is looking at
 * — the heartbeat stores the path, and that is what the screen shows instead.
 */

/** One column of the clicks-by-hour chart. */
export interface LiveHour {
  /** The hour in Dubai, 0–23. */
  hour: number;
  calls: number;
  whatsapp: number;
  telegram: number;
  /** Later today: drawn as an empty slot rather than a zero. */
  future: boolean;
}

export interface LiveAgent {
  userId: string;
  name: string;
  photoUrl: string | null;
  calls: number;
  whatsapp: number;
  telegram: number;
  /** Clicks per hour, in the same buckets as `hours`. */
  spark: number[];
  /** The last click of any kind, or null when they have not clicked today. */
  lastClickAt: string | null;
}

/**
 * Somebody who rang a lead before marking themselves in.
 *
 * The times are kept because the whole value of the card is being able to say
 * "at 09:12 and 09:18, before the check-in at 09:24" — a bare count is a
 * number nobody can act on.
 */
export interface NotCheckedIn {
  userId: string;
  name: string;
  calls: number;
  /** Up to the first six, in Dubai time, "HH:MM". */
  times: string[];
  checkedInAt: string | null;
}

export interface TeamLive {
  /** Dubai, "HH:MM" — the stamp at the top of the screen. */
  now: string;
  /** The office is shut today, so the chart has no working hours to draw. */
  closed: boolean;
  hours: LiveHour[];
  /** Where "now" falls across the chart, 0–1, for the dashed marker. */
  nowAcross: number | null;
  totals: { calls: number; whatsapp: number; telegram: number };
  /**
   * Yesterday up to this same time of day. Comparing a morning against a
   * whole day would read as a collapse every morning.
   */
  yesterday: { calls: number; whatsapp: number; telegram: number };
  agents: LiveAgent[];
  notCheckedIn: NotCheckedIn[];
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The hours the chart draws.
 *
 * The office's own opening hours, from Settings → Attendance, so the chart is
 * the working day the team recognises rather than a fixed 09–17 that is right
 * in no country. An hour with clicks outside those hours is still drawn —
 * somebody working late is exactly what an owner wants to see — so the range
 * is widened to hold whatever was counted, and always to hold this hour.
 *
 * The totals are counted from the rows rather than from these columns, so a
 * chart that cannot draw every hour still shows the right number above it.
 */
function hourRange(
  open: number | null,
  close: number | null,
  counted: number[],
  nowHour: number,
): number[] {
  let first = open ?? 9;
  let last = close ?? 18;
  for (const hour of counted) {
    if (hour < first) first = hour;
    if (hour > last) last = hour;
  }
  if (nowHour > last) last = nowHour;
  if (nowHour < first) first = nowHour;
  /* A chart of 24 columns on a phone is 24 unreadable slivers. Trimmed from
     the front, because the end is where "now" is and now is the point. */
  if (last - first > 15) first = last - 15;
  const out: number[] = [];
  for (let hour = first; hour <= last; hour += 1) out.push(hour);
  return out;
}

export async function teamLive(user: SessionUser, at: Date = new Date()): Promise<TeamLive> {
  const visible = await visibleUserIds(user);
  const calls = ownerPredicate('cl.user_id', visible);
  const taps = ownerPredicate('t.user_id', visible);
  const people = ownerPredicate('u.id', visible);

  const settings = await attendanceSettings();
  const day = dubaiDay(at);
  const closed = settings.closedDays.includes(day);
  const nowMinutes = dubaiMinutes(at);

  const [callRows, tapRows, before, roster, flagged] = await Promise.all([
    /* Calls today, by person and by Dubai hour. One query, not one per
       agent: ten agents was ten round trips and the next hire made it
       eleven (the same reasoning as `ownerHome`). */
    query<{ userId: string; hour: number; n: number; last: Date }>(
      `SELECT cl.user_id AS userId,
              HOUR(CONVERT_TZ(cl.started_at, '+00:00', ${DUBAI})) AS hour,
              COUNT(*) AS n, MAX(cl.started_at) AS last
         FROM call_logs cl
        WHERE ${calls.sql} AND cl.started_at >= ${DAY_START} AND cl.started_at < ${DAY_END}
        GROUP BY cl.user_id, hour`,
      calls.params,
    ),
    query<{ userId: string; app: string; hour: number; n: number; last: Date }>(
      `SELECT t.user_id AS userId, t.app,
              HOUR(CONVERT_TZ(t.tapped_at, '+00:00', ${DUBAI})) AS hour,
              COUNT(*) AS n, MAX(t.tapped_at) AS last
         FROM message_taps t
        WHERE ${taps.sql} AND t.tapped_at >= ${DAY_START} AND t.tapped_at < ${DAY_END}
        GROUP BY t.user_id, t.app, hour`,
      taps.params,
    ),
    /*
     * Yesterday, up to this time of day.
     *
     * `NOW(3) - 1 day` rather than yesterday's midnight-to-midnight: at ten
     * in the morning the honest comparison is yesterday by ten, and the
     * whole-day figure would show every morning as a crash.
     */
    queryOne<{ calls: number; whatsapp: number; telegram: number }>(
      `SELECT
         (SELECT COUNT(*) FROM call_logs cl
           WHERE ${calls.sql}
             AND cl.started_at >= DATE_SUB(${DAY_START}, INTERVAL 1 DAY)
             AND cl.started_at < DATE_SUB(NOW(3), INTERVAL 1 DAY))  AS calls,
         (SELECT COUNT(*) FROM message_taps t
           WHERE ${taps.sql} AND t.app = 'whatsapp'
             AND t.tapped_at >= DATE_SUB(${DAY_START}, INTERVAL 1 DAY)
             AND t.tapped_at < DATE_SUB(NOW(3), INTERVAL 1 DAY))     AS whatsapp,
         (SELECT COUNT(*) FROM message_taps t
           WHERE ${taps.sql} AND t.app = 'telegram'
             AND t.tapped_at >= DATE_SUB(${DAY_START}, INTERVAL 1 DAY)
             AND t.tapped_at < DATE_SUB(NOW(3), INTERVAL 1 DAY))     AS telegram`,
      [...calls.params, ...taps.params, ...taps.params],
    ),
    /* Everybody who works leads. The owner is left out of the table for the
       same reason attendance leaves them out: nobody is measuring them. */
    query<{ id: string; name: string; photoUrl: string | null }>(
      `SELECT u.id, u.name, u.photo_url AS photoUrl
         FROM users u
        WHERE u.is_active = 1 AND u.role IN ('agent','manager') AND ${people.sql}
        ORDER BY u.name ASC`,
      people.params,
    ),
    query<{ userId: string; name: string; n: number; times: string; checkedInAt: Date | null }>(
      `SELECT cl.user_id AS userId, u.name, COUNT(*) AS n,
              GROUP_CONCAT(
                DATE_FORMAT(CONVERT_TZ(cl.started_at, '+00:00', ${DUBAI}), '%H:%i')
                ORDER BY cl.started_at SEPARATOR ','
              ) AS times,
              MAX(a.marked_at) AS checkedInAt
         FROM call_logs cl
         JOIN users u ON u.id = cl.user_id
         LEFT JOIN attendance a ON a.user_id = cl.user_id AND a.on_date = ${TODAY}
        WHERE ${calls.sql} AND cl.not_checked_in = 1
          AND cl.started_at >= ${DAY_START} AND cl.started_at < ${DAY_END}
        GROUP BY cl.user_id, u.name
        ORDER BY n DESC, u.name ASC`,
      calls.params,
    ),
  ]);

  const n = (value: unknown): number => Number(value ?? 0);
  const counted = new Set<number>();
  for (const row of callRows) counted.add(n(row.hour));
  for (const row of tapRows) counted.add(n(row.hour));

  const open = closed ? null : Number((day === 6 ? settings.satStart : settings.start).slice(0, 2));
  const close = closed ? null : Number((day === 6 ? settings.satEnd : settings.end).slice(0, 2));
  const nowHour = Math.floor(nowMinutes / 60);
  const hourList = hourRange(open, close, [...counted], nowHour);
  const slot = new Map(hourList.map((hour, i) => [hour, i]));

  const hours: LiveHour[] = hourList.map((hour) => ({
    hour,
    calls: 0,
    whatsapp: 0,
    telegram: 0,
    future: hour > nowHour,
  }));

  /** One row per person on the roster, so a quiet agent still has a row. */
  const agents = new Map<string, LiveAgent>(roster.map((person) => [person.id, {
    userId: person.id,
    name: person.name,
    photoUrl: person.photoUrl,
    calls: 0,
    whatsapp: 0,
    telegram: 0,
    spark: hourList.map(() => 0),
    lastClickAt: null,
  }]));

  const later = (row: LiveAgent, when: Date | null) => {
    if (!when) return;
    const iso = new Date(when).toISOString();
    if (!row.lastClickAt || iso > row.lastClickAt) row.lastClickAt = iso;
  };

  const totals = { calls: 0, whatsapp: 0, telegram: 0 };

  for (const row of callRows) {
    const count = n(row.n);
    totals.calls += count;
    const i = slot.get(n(row.hour));
    if (i !== undefined) {
      (hours[i] as LiveHour).calls += count;
    }
    const agent = agents.get(String(row.userId));
    if (!agent) continue;
    agent.calls += count;
    if (i !== undefined) agent.spark[i] = (agent.spark[i] ?? 0) + count;
    later(agent, row.last ?? null);
  }

  for (const row of tapRows) {
    const count = n(row.n);
    const app = String(row.app) === 'telegram' ? 'telegram' : 'whatsapp';
    totals[app] += count;
    const i = slot.get(n(row.hour));
    if (i !== undefined) {
      (hours[i] as LiveHour)[app] += count;
    }
    const agent = agents.get(String(row.userId));
    if (!agent) continue;
    agent[app] += count;
    if (i !== undefined) agent.spark[i] = (agent.spark[i] ?? 0) + count;
    later(agent, row.last ?? null);
  }

  const first = hourList[0];
  const last = hourList[hourList.length - 1];
  const across = first === undefined || last === undefined || last < first
    ? null
    : Math.min(1, Math.max(0, (nowMinutes - first * 60) / ((last - first + 1) * 60)));

  return {
    now: hhmm(nowMinutes),
    closed,
    hours,
    nowAcross: across,
    totals,
    yesterday: {
      calls: n(before?.calls),
      whatsapp: n(before?.whatsapp),
      telegram: n(before?.telegram),
    },
    /* Busiest first: the question this table answers is who is working, and
       the name at the bottom is the one worth asking about. */
    agents: [...agents.values()].sort((a, b) =>
      (b.calls + b.whatsapp + b.telegram) - (a.calls + a.whatsapp + a.telegram)
      || a.name.localeCompare(b.name)),
    notCheckedIn: flagged.map((row) => ({
      userId: String(row.userId),
      name: String(row.name),
      calls: n(row.n),
      times: String(row.times ?? '').split(',').filter(Boolean).slice(0, 6),
      checkedInAt: row.checkedInAt ? new Date(row.checkedInAt).toISOString() : null,
    })),
  };
}
