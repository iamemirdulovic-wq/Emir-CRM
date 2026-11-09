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
  attendanceSettings, isOfficeIp, type AttendanceSettings,
} from './settings.js';

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
  /** "10:00" today, so the screen can say what on-time means. */
  startsAt: string | null;
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

  return {
    closed: settings.closedDays.includes(day),
    marked: row?.kind ?? null,
    markedAt: row?.marked_at ?? null,
    wasLate: row?.was_late === 1,
    note: row?.note ?? null,
    onOfficeNetwork: isOfficeIp(seenIp, settings.officeIps),
    seenIp,
    enabled: settings.enabled,
    startsAt: settings.closedDays.includes(day)
      ? null
      : (day === 6 ? settings.satStart : settings.start),
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
   * Everybody who is asked to check in: Emir's answer was "everybody except
   * me", so the owner is left out along with the service account. A
   * deactivated person stays out too — their past days are history, not a
   * row of absences growing every morning.
   */
  const people = await query<{
    id: string; name: string; role: string; photo_url: string | null;
  }>(
    `SELECT id, name, role, photo_url FROM users
      WHERE is_active = 1 AND role NOT IN ('automation', 'owner')
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
