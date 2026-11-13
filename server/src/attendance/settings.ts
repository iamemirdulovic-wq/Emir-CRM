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
  /**
   * What each office network is called, keyed by its address.
   *
   * `design/web/settings-attendance.html` lists **network names** —
   * "homes.me-Office", "homes.me-Office-5G" — with the hint "Network name,
   * exactly as on the phone". No browser on any platform will tell a web page
   * the Wi-Fi name, so the thing check-in can actually match on is the address
   * the office's line is seen from, which is what it has always matched on.
   *
   * Both, then: the name is what the owner reads and types, the address is
   * what the gate compares. A name with no address behind it would be a gate
   * that lets everybody in, which is why the name is a label on an address
   * rather than a replacement for one. `docs/decisions-to-confirm.md`.
   */
  officeNames: Record<string, string>;
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
  /**
   * Working outside, and what is asked when somebody does.
   *
   * A viewing, a site visit and a developer event are work, so the design
   * treats "outside" as a state rather than an absence. These four decide
   * how much is asked of the agent for it: the location once at the start,
   * one "are you back?" at the time they said, and whether owners hear.
   * Following anybody through the day was never on the table.
   */
  outsideAllowed: boolean;
  outsideLocationOnce: boolean;
  outsideAskBack: boolean;
  outsideTellOwners: boolean;
  /**
   * Whether an agent is asked to check in before a call, and whether they
   * may call anyway.
   *
   * "Call anyway" stays available by default on purpose: a gate with no way
   * past it turns a broken office router into an office that cannot phone
   * its clients. The call is recorded as not-checked-in instead.
   */
  callNeedsCheckIn: boolean;
  callAnyway: boolean;
}

export const ATTENDANCE_DEFAULTS: AttendanceSettings = {
  enabled: false,
  officeIps: [],
  officeNames: {},
  start: '10:00',
  end: '19:00',
  satStart: '11:00',
  satEnd: '15:00',
  closedDays: [0],
  graceMinutes: 10,
  outsideAllowed: true,
  outsideLocationOnce: true,
  outsideAskBack: true,
  outsideTellOwners: false,
  callNeedsCheckIn: true,
  callAnyway: true,
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

/**
 * A stored switch.
 *
 * Unset means "never chosen", which is the default and not `false` — the
 * difference matters for `callAnyway`, where reading an unset value as off
 * would silently gate every call in an office that had never opened this
 * screen.
 */
function flag(raw: string | null, fallback: boolean): boolean {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return fallback;
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

/**
 * The stored names, trimmed to the addresses that still exist.
 *
 * A name left behind by a removed address is read as nothing rather than
 * carried forward: the list on screen is built from the addresses, and a name
 * with no address is a label on a network nobody can check in from.
 */
function nameMap(raw: string | null, ips: string[]): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const ip = normaliseIp(key);
      if (ip && ips.includes(ip) && typeof value === 'string' && value.trim()) {
        out[ip] = value.trim().slice(0, 60);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function attendanceSettings(
  exec: Executor = getPool(),
): Promise<AttendanceSettings> {
  const [
    enabled, ips, names, start, end, satStart, satEnd, closed, grace,
    outsideAllowed, outsideLocationOnce, outsideAskBack, outsideTellOwners,
    callNeedsCheckIn, callAnyway,
  ] = await Promise.all([
    setting('ATT_ENABLED', exec),
    setting('ATT_OFFICE_IPS', exec),
    setting('ATT_OFFICE_NAMES', exec),
    setting('ATT_START', exec),
    setting('ATT_END', exec),
    setting('ATT_SAT_START', exec),
    setting('ATT_SAT_END', exec),
    setting('ATT_CLOSED_DAYS', exec),
    setting('ATT_GRACE_MINUTES', exec),
    setting('ATT_OUTSIDE_ALLOWED', exec),
    setting('ATT_OUTSIDE_LOCATION_ONCE', exec),
    setting('ATT_OUTSIDE_ASK_BACK', exec),
    setting('ATT_OUTSIDE_TELL_OWNERS', exec),
    setting('ATT_CALL_NEEDS_CHECKIN', exec),
    setting('ATT_CALL_ANYWAY', exec),
  ]);

  const officeIps = list(ips);
  const officeNames = nameMap(names, officeIps);
  const graceMinutes = Number(grace);

  return {
    /* Never on without an address: a check-in gate with nothing to check
       against would refuse everybody, every day, with no way in. */
    enabled: enabled === '1' && officeIps.length > 0,
    officeIps,
    officeNames,
    start: clock(start) ?? ATTENDANCE_DEFAULTS.start,
    end: clock(end) ?? ATTENDANCE_DEFAULTS.end,
    satStart: clock(satStart) ?? ATTENDANCE_DEFAULTS.satStart,
    satEnd: clock(satEnd) ?? ATTENDANCE_DEFAULTS.satEnd,
    closedDays: numbers(closed, ATTENDANCE_DEFAULTS.closedDays),
    graceMinutes: Number.isFinite(graceMinutes) && graceMinutes >= 0 && graceMinutes <= 120
      ? Math.round(graceMinutes)
      : ATTENDANCE_DEFAULTS.graceMinutes,
    outsideAllowed: flag(outsideAllowed, ATTENDANCE_DEFAULTS.outsideAllowed),
    outsideLocationOnce: flag(outsideLocationOnce, ATTENDANCE_DEFAULTS.outsideLocationOnce),
    outsideAskBack: flag(outsideAskBack, ATTENDANCE_DEFAULTS.outsideAskBack),
    outsideTellOwners: flag(outsideTellOwners, ATTENDANCE_DEFAULTS.outsideTellOwners),
    callNeedsCheckIn: flag(callNeedsCheckIn, ATTENDANCE_DEFAULTS.callNeedsCheckIn),
    callAnyway: flag(callAnyway, ATTENDANCE_DEFAULTS.callAnyway),
  };
}

export interface AttendanceInput {
  enabled?: boolean;
  officeIps?: string[];
  officeNames?: Record<string, string>;
  start?: string;
  end?: string;
  satStart?: string;
  satEnd?: string;
  closedDays?: number[];
  graceMinutes?: number;
  outsideAllowed?: boolean;
  outsideLocationOnce?: boolean;
  outsideAskBack?: boolean;
  outsideTellOwners?: boolean;
  callNeedsCheckIn?: boolean;
  callAnyway?: boolean;
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
  if (input.officeNames !== undefined) {
    /* Only names for addresses that are actually saved, so removing a network
       takes its name with it rather than leaving an orphan behind. */
    const keep = input.officeIps
      ? input.officeIps.map((one) => normaliseIp(one)).filter((one): one is string => Boolean(one))
      : (await attendanceSettings(exec)).officeIps;
    const clean: Record<string, string> = {};
    for (const [rawIp, rawName] of Object.entries(input.officeNames)) {
      const ip = normaliseIp(rawIp);
      const name = String(rawName ?? '').trim().slice(0, 60);
      if (ip && name && keep.includes(ip)) clean[ip] = name;
    }
    put('ATT_OFFICE_NAMES', JSON.stringify(clean));
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

  if (input.outsideAllowed !== undefined) put('ATT_OUTSIDE_ALLOWED', input.outsideAllowed ? '1' : '0');
  if (input.outsideLocationOnce !== undefined) {
    put('ATT_OUTSIDE_LOCATION_ONCE', input.outsideLocationOnce ? '1' : '0');
  }
  if (input.outsideAskBack !== undefined) put('ATT_OUTSIDE_ASK_BACK', input.outsideAskBack ? '1' : '0');
  if (input.outsideTellOwners !== undefined) {
    put('ATT_OUTSIDE_TELL_OWNERS', input.outsideTellOwners ? '1' : '0');
  }
  if (input.callNeedsCheckIn !== undefined) put('ATT_CALL_NEEDS_CHECKIN', input.callNeedsCheckIn ? '1' : '0');
  if (input.callAnyway !== undefined) put('ATT_CALL_ANYWAY', input.callAnyway ? '1' : '0');

  await Promise.all(writes);
  return attendanceSettings(exec);
}
