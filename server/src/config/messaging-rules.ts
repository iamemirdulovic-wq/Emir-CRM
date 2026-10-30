import {
  BOT_PAUSE_AFTER_HUMAN_MS, MAX_AUTOMATED_MESSAGES_PER_24H, QUIET_HOURS,
} from './constants.js';
import { setting } from './secrets.js';

/**
 * The limits on automated messaging, as an owner may tighten them.
 *
 * The master prompt fixes the defaults — quiet hours 22:00–08:00 Asia/Dubai,
 * three automated messages per contact per day, a 24-hour pause after a human
 * replies — and those stay the defaults. What an owner gets is the ability to
 * be *stricter*, and a small amount of room to be looser, because a brokerage
 * running a Ramadan campaign has different evenings from one that is not.
 *
 * Clamped rather than validated-and-refused: a number typed into a box should
 * not be able to turn the guards off. Six messages a day is the ceiling
 * whatever is typed, and the quiet window cannot be made shorter than four
 * hours.
 */

export interface MessagingRules {
  /** Hour the quiet window starts, Dubai time. */
  quietStartHour: number;
  /** Hour it ends. The window wraps midnight. */
  quietEndHour: number;
  maxPer24h: number;
  botPauseMs: number;
}

export const MESSAGING_DEFAULTS: MessagingRules = {
  quietStartHour: QUIET_HOURS.startHour,
  quietEndHour: QUIET_HOURS.endHour,
  maxPer24h: MAX_AUTOMATED_MESSAGES_PER_24H,
  botPauseMs: BOT_PAUSE_AFTER_HUMAN_MS,
};

/** Nobody gets to send more than this, whatever is typed in the box. */
export const MAX_PER_24H_CEILING = 6;
/** Nor to make the night shorter than this. */
export const MIN_QUIET_HOURS = 4;
export const MAX_BOT_PAUSE_HOURS = 72;
export const MIN_BOT_PAUSE_HOURS = 1;

export function rulesFrom(stored: {
  quietStart?: string | null;
  quietEnd?: string | null;
  maxPer24h?: string | null;
  botPauseHours?: string | null;
}): MessagingRules {
  const quietStartHour = hour(stored.quietStart, MESSAGING_DEFAULTS.quietStartHour);
  let quietEndHour = hour(stored.quietEnd, MESSAGING_DEFAULTS.quietEndHour);

  /* The window wraps midnight, so its length is the distance going forwards. */
  const length = (quietEndHour - quietStartHour + 24) % 24;
  if (length < MIN_QUIET_HOURS) quietEndHour = (quietStartHour + MIN_QUIET_HOURS) % 24;

  return {
    quietStartHour,
    quietEndHour,
    maxPer24h: clampInt(stored.maxPer24h, MESSAGING_DEFAULTS.maxPer24h, 1, MAX_PER_24H_CEILING),
    botPauseMs:
      clampInt(stored.botPauseHours, MESSAGING_DEFAULTS.botPauseMs / 3_600_000, MIN_BOT_PAUSE_HOURS, MAX_BOT_PAUSE_HOURS)
      * 3_600_000,
  };
}

/** How the window reads on screen: "22:00 to 08:00 — 10 hours". */
export function describeQuiet(rules: MessagingRules): string {
  const length = (rules.quietEndHour - rules.quietStartHour + 24) % 24;
  return `${pad(rules.quietStartHour)}:00 to ${pad(rules.quietEndHour)}:00 — ${length} hours`;
}

/** Is this moment inside the window? It wraps midnight, which is where this goes wrong. */
export function inQuietWindow(hourOfDay: number, rules: MessagingRules): boolean {
  if (rules.quietStartHour === rules.quietEndHour) return false;
  if (rules.quietStartHour < rules.quietEndHour) {
    return hourOfDay >= rules.quietStartHour && hourOfDay < rules.quietEndHour;
  }
  return hourOfDay >= rules.quietStartHour || hourOfDay < rules.quietEndHour;
}

/** Hours from now until the window opens again. Zero when it is already open. */
export function hoursUntilOpen(hourOfDay: number, rules: MessagingRules): number {
  if (!inQuietWindow(hourOfDay, rules)) return 0;
  return (rules.quietEndHour - hourOfDay + 24) % 24 || 24;
}

/** True when the owner has moved anything off the master prompt's defaults. */
export function isCustomised(rules: MessagingRules): boolean {
  return (
    rules.quietStartHour !== MESSAGING_DEFAULTS.quietStartHour
    || rules.quietEndHour !== MESSAGING_DEFAULTS.quietEndHour
    || rules.maxPer24h !== MESSAGING_DEFAULTS.maxPer24h
    || rules.botPauseMs !== MESSAGING_DEFAULTS.botPauseMs
  );
}

function hour(value: string | null | undefined, fallback: number): number {
  const parsed = Number.parseInt((value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) return fallback;
  return parsed;
}

function clampInt(value: string | null | undefined, fallback: number, low: number, high: number): number {
  const parsed = Number.parseInt((value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(high, Math.max(low, parsed));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The rules as they stand, read from settings. */
export async function messagingRules(): Promise<MessagingRules> {
  const [quietStart, quietEnd, maxPer24h, botPauseHours] = await Promise.all([
    setting('MSG_QUIET_START'),
    setting('MSG_QUIET_END'),
    setting('MSG_MAX_PER_24H'),
    setting('MSG_BOT_PAUSE_HOURS'),
  ]);
  return rulesFrom({ quietStart, quietEnd, maxPer24h, botPauseHours });
}
