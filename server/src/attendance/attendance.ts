/**
 * Marking a day, and reading a month of them back.
 *
 * Two ways in. `markOffice` is the one the Wi-Fi gates: it is refused unless
 * the address the server saw is one of the office's. `markOutside` is allowed
 * from anywhere, because an agent at a developer's sales centre at ten in the
 * morning is doing the job, and a system that calls that absent is one the
 * best people learn to ignore.
 *
 * Everything here works in Dubai time. The server runs on UTC, so a tap at
 * 00:30 Dubai is still the previous UTC day, and filing it under the UTC date
 * would put somebody's Tuesday morning on Monday's row.
 */
import { execute, query, queryOne, type Executor, getPool } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { DUBAI_OFFSET_MINUTES } from '../routing/hours.js';
import {
  attendanceSettings, isOfficeIp, normaliseIp, type AttendanceSettings,
} from './settings.js';
import { countedAgentSql } from '../users/counting.js';

export type AttendanceKind = 'office' | 'outside';

/** Today's date in Dubai, as YYYY-MM-DD. */
export function dubaiDate(at: Date = new Date()): string {
  return new Date(at.getTime() + DUBAI_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(0, 10);
}

/** Minutes past midnight, in Dubai. */
export function dubaiMinutes(at: Date = new Date()): number {
  const shifted = new Date(at.getTime() + DUBAI_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** Day of the week in Dubai, 0 = Sunday. */
export function dubaiDay(at: Date = new Date()): number {
  return new Date(at.getTime() + DUBAI_OFFSET_MINUTES * 60_000).getUTCDay();
}

function toMinutes(clock: string): number {
  const [h, m] = clock.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** When the office opens on a given weekday, or null when it is closed. */
export function startFor(day: number, s: AttendanceSettings): number | null {
  if (s.closedDays.includes(day)) return null;
  return toMinutes(day === 6 ? s.satStart : s.start);
}

/**
 * The shift, as an agent's own screen needs to say it.
 *
 * `design/web/attendance.html` writes three facts the agent screen could not
 * reach: "Shift 09:00 – 18:00, Monday to Friday", "Late · check-in after
 * 09:10", and the warning in the hero that a check-in at this hour counts as
 * late. All three are in `attendanceSettings`, and that endpoint is owner and
 * admin only — rightly, because it also carries the office's addresses. What
 * is here is when the office is open and when a tap counts as late, and
 * nothing else. Nothing in it says where the office is.
 */
export interface ShiftFacts {
  start: string;
  end: string;
  satStart: string;
  satEnd: string;
  /** JS day numbers, 0 = Sunday. */
  closedDays: number[];
  graceMinutes: number;
}

export interface DayState {
  /** The office is shut today, so nothing is expected of anyone. */
  closed: boolean;
  /** Already marked, and how. */
  marked: AttendanceKind | null;
  markedAt: Date | null;
  wasLate: boolean;
  note: string | null;
  /** Is the caller on the office network right now? */
  onOfficeNetwork: boolean;
  /** The address the server sees, so Settings can offer it and a person can check it. */
  seenIp: string | null;
  /** Attendance is off until an owner has set an address. */
  enabled: boolean;
  /**
   * What the office network this caller is on is called — the design's
   * "OFFICE WI-FI FOUND · homes.me-Office". Null when they are not on one,
   * or when the owner has saved an address without naming it.
   *
   * The name only. The addresses stay on the owner's settings endpoint: an
   * agent's screen has no business carrying the office's IP around.
   */
  officeName: string | null;
  /** Every office network's name, for "Only on the office Wi-Fi “X”". */
  officeNames: string[];
  /** "10:00" today, so the screen can say what on-time means. */
  startsAt: string | null;
  /** "19:00" today, or null when the office is shut. */
  endsAt: string | null;
  /** "10:10" today: a tap after this is late. Null when the office is shut. */
  lateAfter: string | null;
  /** The whole week's shift, for the "How check-in works" panel. */
  shift: ShiftFacts;
}

/** "10:00" plus 10 minutes is "10:10". Past midnight it stops at 23:59. */
function plusMinutes(clock: string, minutes: number): string {
  const total = Math.min(toMinutes(clock) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export async function dayState(
  userId: string,
  seenIp: string | null,
  at: Date = new Date(),
  exec: Executor = getPool(),
): Promise<DayState> {
  const settings = await attendanceSettings(exec);
  const day = dubaiDay(at);
  const on = dubaiDate(at);

  const row = await queryOne<{
    kind: AttendanceKind; marked_at: Date; was_late: number; note: string | null;
  }>(
    'SELECT kind, marked_at, was_late, note FROM attendance WHERE user_id = ? AND on_date = ?',
    [userId, on],
    exec,
  );

  const closed = settings.closedDays.includes(day);
  const startsAt = closed ? null : (day === 6 ? settings.satStart : settings.start);
  const names = settings.officeNames ?? {};
  const here = normaliseIp(seenIp);

  return {
    closed,
    marked: row?.kind ?? null,
    markedAt: row?.marked_at ?? null,
    wasLate: row?.was_late === 1,
    note: row?.note ?? null,
    onOfficeNetwork: isOfficeIp(seenIp, settings.officeIps),
    seenIp,
    enabled: settings.enabled,
    officeName: here ? names[here] ?? null : null,
    officeNames: [...new Set(Object.values(names))],
    startsAt,
    endsAt: closed ? null : (day === 6 ? settings.satEnd : settings.end),
    lateAfter: startsAt ? plusMinutes(startsAt, settings.graceMinutes) : null,
    shift: {
      start: settings.start,
      end: settings.end,
      satStart: settings.satStart,
      satEnd: settings.satEnd,
      closedDays: settings.closedDays,
      graceMinutes: settings.graceMinutes,
    },
  };
}

async function insert(
  userId: string,
  kind: AttendanceKind,
  wasLate: boolean,
  note: string | null,
  seenIp: string | null,
  at: Date,
  exec: Executor,
): Promise<void> {
  /*
   * First tap of the day wins. A second one — a double press, or somebody
   * who checked in and later taps "working outside" — is ignored rather than
   * allowed to rewrite the morning. The unique key does the work; this just
   * means the second tap is not an error on screen.
   */
  await execute(
    `INSERT INTO attendance (id, user_id, on_date, kind, marked_at, was_late, note, seen_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [newId(), userId, dubaiDate(at), kind, at, wasLate ? 1 : 0, note, seenIp],
    exec,
  );
}

export async function markOffice(
  userId: string,
  seenIp: string | null,
  at: Date = new Date(),
  exec: Executor = getPool(),
): Promise<DayState> {
  const settings = await attendanceSettings(exec);
  if (!settings.enabled) throw badRequest('Attendance is not switched on yet.');
  if (!isOfficeIp(seenIp, settings.officeIps)) {
    /* 403 rather than 400: it is not that the request was malformed, it is
       that this network is not allowed to make it. */
    throw forbidden('You can only check in on the office Wi-Fi.');
  }

  const day = dubaiDay(at);
  const start = startFor(day, settings);
  const late = start !== null && dubaiMinutes(at) > start + settings.graceMinutes;

  await insert(userId, 'office', late, null, seenIp, at, exec);
  return dayState(userId, seenIp, at, exec);
}

export async function markOutside(
  userId: string,
  note: string,
  seenIp: string | null,
  at: Date = new Date(),
  exec: Executor = getPool(),
): Promise<DayState> {
  const settings = await attendanceSettings(exec);
  if (!settings.enabled) throw badRequest('Attendance is not switched on yet.');
  const where = note.trim().slice(0, 160);
  if (!where) throw badRequest('Say where you are working from today.');

  /* Never late: the point of this one is that being elsewhere is legitimate,
     and a "late" mark on it would quietly make it a lesser kind of present. */
  await insert(userId, 'outside', false, where, seenIp, at, exec);
  return dayState(userId, seenIp, at, exec);
}

/* ── The owner's month ──────────────────────────────────────────────────── */

export interface AttendanceDay {
  date: string;
  kind: AttendanceKind | null;
  at: Date | null;
  late: boolean;
  note: string | null;
}

export interface AttendancePerson {
  userId: string;
  name: string;
  role: string;
  photoUrl: string | null;
  days: AttendanceDay[];
  /** Counted over the open days in the range only. */
  inOffice: number;
  outside: number;
  late: number;
  absent: number;
}

export interface AttendanceMonth {
  from: string;
  to: string;
  /** Every date in the range, with the closed ones flagged. */
  dates: Array<{ date: string; closed: boolean }>;
  people: AttendancePerson[];
}

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  let cursor = Date.parse(`${from}T00:00:00Z`);
  /* 400 days is a year and a bit: enough for any range a person asks for,
     and a hard stop so a mistyped year cannot walk forever. */
  for (let guard = 0; cursor <= end && guard < 400; guard += 1) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return out;
}

export async function attendanceMonth(
  from: string,
  to: string,
  exec: Executor = getPool(),
): Promise<AttendanceMonth> {
  const settings = await attendanceSettings(exec);
  const dates = eachDate(from, to).map((date) => ({
    date,
    closed: settings.closedDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()),
  }));

  /*
   * Everybody who is asked to check in.
   *
   * Emir's first answer was "everybody except me", and that is what this read
   * — which quietly put the **admin** in the register as somebody being
   * measured on turning up, and made this screen's headcount disagree with
   * the dashboard's. Settled on 13 Nov: the register is the agents and their
   * managers, one rule for the whole CRM (`users/counting.ts`). A deactivated
   * person stays out too — their past days are history, not a row of absences
   * growing every morning.
   */
  const people = await query<{
    id: string; name: string; role: string; photo_url: string | null;
  }>(
    `SELECT id, name, role, photo_url FROM users
      WHERE is_active = 1 AND ${countedAgentSql('role')}
      ORDER BY name`,
    [],
    exec,
  );
  if (people.length === 0) return { from, to, dates, people: [] };

  const marks = await query<{
    user_id: string; on_date: Date | string; kind: AttendanceKind;
    marked_at: Date; was_late: number; note: string | null;
  }>(
    `SELECT user_id, on_date, kind, marked_at, was_late, note
       FROM attendance
      WHERE on_date BETWEEN ? AND ?`,
    [from, to],
    exec,
  );

  const byPerson = new Map<string, Map<string, typeof marks[number]>>();
  for (const mark of marks) {
    const key = typeof mark.on_date === 'string'
      ? mark.on_date.slice(0, 10)
      : mark.on_date.toISOString().slice(0, 10);
    const forUser = byPerson.get(mark.user_id) ?? new Map();
    forUser.set(key, mark);
    byPerson.set(mark.user_id, forUser);
  }

  const today = dubaiDate();

  return {
    from,
    to,
    dates,
    people: people.map((person) => {
      const found = byPerson.get(person.id);
      let inOffice = 0;
      let outside = 0;
      let late = 0;
      let absent = 0;

      const days = dates.map(({ date, closed }) => {
        const mark = found?.get(date);
        if (mark) {
          if (mark.kind === 'office') {
            inOffice += 1;
            if (mark.was_late === 1) late += 1;
          } else outside += 1;
        } else if (!closed && date <= today) {
          /* A day still to come is not an absence, and neither is a day the
             office was shut. Counting either turns the number into noise. */
          absent += 1;
        }
        return {
          date,
          kind: mark?.kind ?? null,
          at: mark?.marked_at ?? null,
          late: mark?.was_late === 1,
          note: mark?.note ?? null,
        };
      });

      return {
        userId: person.id,
        name: person.name,
        role: person.role,
        photoUrl: person.photo_url,
        days,
        inOffice,
        outside,
        late,
        absent,
      };
    }),
  };
}
