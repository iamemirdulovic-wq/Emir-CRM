import { TIMEZONE } from '../config/constants.js';
import { hoursUntilOpen, inQuietWindow, MESSAGING_DEFAULTS, type MessagingRules } from '../config/messaging-rules.js';

/** Wall-clock parts of `date` as seen in Asia/Dubai. */
export function dubaiParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl renders midnight as "24" in some ICU builds.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/**
 * True inside the quiet window — 22:00 to 08:00 Asia/Dubai unless the owner
 * has set it otherwise in Settings.
 */
export function isQuietHours(date: Date = new Date(), rules: MessagingRules = MESSAGING_DEFAULTS): boolean {
  const { hour } = dubaiParts(date);
  return inQuietWindow(hour, rules);
}

/**
 * The next moment automated messaging is allowed. When we are already outside
 * quiet hours this returns `date` unchanged.
 */
export function nextAllowedSendTime(
  date: Date = new Date(),
  rules: MessagingRules = MESSAGING_DEFAULTS,
): Date {
  if (!isQuietHours(date, rules)) return date;
  const { hour } = dubaiParts(date);
  const result = new Date(date.getTime());
  // Advance in whole minutes until the Dubai clock reads the opening hour.
  result.setTime(result.getTime() + hoursUntilOpen(hour, rules) * 60 * 60 * 1000);
  const { minute } = dubaiParts(result);
  result.setTime(result.getTime() - minute * 60 * 1000);
  return isQuietHours(result, rules) ? new Date(result.getTime() + 60 * 60 * 1000) : result;
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function minutes(n: number): number {
  return n * 60 * 1000;
}

export function hours(n: number): number {
  return n * 60 * 60 * 1000;
}

export function days(n: number): number {
  return n * 24 * 60 * 60 * 1000;
}

/** MySQL DATETIME(3) literal in UTC. */
export function toMysqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * A date and time as a person in Dubai would read it: "Thu 18 Sep, 15:30".
 *
 * Every user of this CRM works in one timezone, so a reminder that said "13:30"
 * because the server runs in UTC would be a reminder about the wrong time.
 */
export function formatInDubai(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
