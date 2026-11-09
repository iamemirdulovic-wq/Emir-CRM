/**
 * When the office is open, and which network counts as being in it.
 *
 * Stored in `app_settings` like the routing rules: one row of it, read on
 * every check-in, and `saveSetting` already caches, audits and invalidates.
 * Owner only.
 *
 * Emir, Nov 9 2026: Monday to Saturday, 10:00 to 19:00, Saturday 11:00 to
 * 15:00, Sunday closed. The office has two Wi-Fi networks on two lines —
 * hence a list rather than one address.
 *
 * The office's real addresses are never written here. They are saved from
 * Settings → Attendance, by an owner standing in the office, and live in
 * `app_settings`. Every address in this file and in its tests is from the
 * 203.0.113.0/24 documentation range, which belongs to nobody.
 */
import { saveSetting, setting } from '../config/secrets.js';
import type { AuditActor } from '../audit/audit.js';
import type { Executor } from '../db/client.js';
import { getPool } from '../db/client.js';

export interface AttendanceSettings {
  /** Off until an owner sets at least one address; nothing is asked of anyone. */
  enabled: boolean;
  /**
   * The public addresses the office is seen from. A list because two Wi-Fi
   * networks on two internet lines have two addresses, and because a line
   * that changes address wants the old one kept for a day while people
   * arrive.
   */
  officeIps: string[];
  /** Weekday start and end, "HH:MM" in Dubai time. */
  start: string;
  end: string;
  /** Saturday is a short day here, so it has its own pair. */
  satStart: string;
  satEnd: string;
  /**
   * Days nobody is expected in, as JS day numbers (0 = Sunday). A day in
   * this list is never counted against anyone.
   */
  closedDays: number[];
  /** Minutes after the start before a tap counts as late. */
  graceMinutes: number;
}

export const ATTENDANCE_DEFAULTS: AttendanceSettings = {
  enabled: false,
  officeIps: [],
  start: '10:00',
  end: '19:00',
  satStart: '11:00',
  satEnd: '15:00',
  closedDays: [0],
  graceMinutes: 10,
};

/** "HH:MM", or null when it is anything else. */
function clock(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * An IPv4 or IPv6 address, normalised.
 *
 * `::ffff:203.0.113.10` is how an IPv4 client often arrives at a Node server
 * listening on IPv6, and it is the same machine as `203.0.113.10`. Comparing
 * the two as strings is a check that silently never matches, which here means
 * an office where nobody can ever tap the button.
 */
export function normaliseIp(value: string | null | undefined): string | null {
  if (!value) return null;
  let ip = value.trim().toLowerCase();
  if (!ip) return null;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  // Strip a port if one came along, e.g. "203.0.113.10:51234".
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
  if (v4WithPort) ip = v4WithPort[1] as string;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.some((n) => n > 255)) return null;
    return parts.join('.');
  }
  // IPv6: accept the shape, keep it as written apart from case.
  if (/^[0-9a-f:]+$/.test(ip) && ip.includes(':')) return ip;
  return null;
}

/** Is this address one of the office's? */
export function isOfficeIp(ip: string | null | undefined, allowed: string[]): boolean {
  const seen = normaliseIp(ip);
  if (!seen) return false;
  return allowed.some((entry) => normaliseIp(entry) === seen);
}

function numbers(raw: string | null, fallback: number[]): number[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return fallback;
    const out = parsed.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    return [...new Set(out)];
  } catch {
    return fallback;
  }
}

function list(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const entry of parsed) {
      const ip = normaliseIp(String(entry));
      if (ip && !out.includes(ip)) out.push(ip);
    }
    return out.slice(0, 10);
  } catch {
    return [];
  }
}

export async function attendanceSettings(
  exec: Executor = getPool(),
): Promise<AttendanceSettings> {
  const [enabled, ips, start, end, satStart, satEnd, closed, grace] = await Promise.all([
    setting('ATT_ENABLED', exec),
    setting('ATT_OFFICE_IPS', exec),
    setting('ATT_START', exec),
    setting('ATT_END', exec),
    setting('ATT_SAT_START', exec),
    setting('ATT_SAT_END', exec),
    setting('ATT_CLOSED_DAYS', exec),
    setting('ATT_GRACE_MINUTES', exec),
  ]);

  const officeIps = list(ips);
  const graceMinutes = Number(grace);

  return {
    /* Never on without an address: a check-in gate with nothing to check
       against would refuse everybody, every day, with no way in. */
    enabled: enabled === '1' && officeIps.length > 0,
    officeIps,
    start: clock(start) ?? ATTENDANCE_DEFAULTS.start,
    end: clock(end) ?? ATTENDANCE_DEFAULTS.end,
    satStart: clock(satStart) ?? ATTENDANCE_DEFAULTS.satStart,
    satEnd: clock(satEnd) ?? ATTENDANCE_DEFAULTS.satEnd,
    closedDays: numbers(closed, ATTENDANCE_DEFAULTS.closedDays),
    graceMinutes: Number.isFinite(graceMinutes) && graceMinutes >= 0 && graceMinutes <= 120
      ? Math.round(graceMinutes)
      : ATTENDANCE_DEFAULTS.graceMinutes,
  };
}

export interface AttendanceInput {
  enabled?: boolean;
  officeIps?: string[];
  start?: string;
  end?: string;
  satStart?: string;
  satEnd?: string;
  closedDays?: number[];
  graceMinutes?: number;
}

export async function saveAttendanceSettings(
  actor: AuditActor,
  input: AttendanceInput,
  exec: Executor = getPool(),
): Promise<AttendanceSettings> {
  const writes: Array<Promise<unknown>> = [];
  const put = (name: Parameters<typeof saveSetting>[1], value: string) => {
    writes.push(saveSetting(actor, name, value, exec));
  };

  if (input.enabled !== undefined) put('ATT_ENABLED', input.enabled ? '1' : '0');
  if (input.officeIps !== undefined) {
    const clean: string[] = [];
    for (const entry of input.officeIps) {
      const ip = normaliseIp(entry);
      if (ip && !clean.includes(ip)) clean.push(ip);
    }
    put('ATT_OFFICE_IPS', JSON.stringify(clean.slice(0, 10)));
  }
  if (input.start !== undefined) put('ATT_START', clock(input.start) ?? ATTENDANCE_DEFAULTS.start);
  if (input.end !== undefined) put('ATT_END', clock(input.end) ?? ATTENDANCE_DEFAULTS.end);
  if (input.satStart !== undefined) {
    put('ATT_SAT_START', clock(input.satStart) ?? ATTENDANCE_DEFAULTS.satStart);
  }
  if (input.satEnd !== undefined) {
    put('ATT_SAT_END', clock(input.satEnd) ?? ATTENDANCE_DEFAULTS.satEnd);
  }
  if (input.closedDays !== undefined) {
    const days = [...new Set(input.closedDays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
    put('ATT_CLOSED_DAYS', JSON.stringify(days));
  }
  if (input.graceMinutes !== undefined) {
    const n = Math.round(Number(input.graceMinutes));
    put('ATT_GRACE_MINUTES', String(Number.isFinite(n) ? Math.min(120, Math.max(0, n)) : 10));
  }

  await Promise.all(writes);
  return attendanceSettings(exec);
}
