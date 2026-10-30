/**
 * When the five minutes actually start.
 *
 * A lead arriving at 03:10 is still answered inside thirty seconds — the
 * WhatsApp welcome does not sleep. What cannot happen at 03:10 is holding an
 * agent to a five-minute call-back and taking the lead off them at 03:15 for
 * failing. By morning the lead has been bounced, the agent has a breach
 * against their name, and nobody has spoken to the client.
 *
 * So the deadline moves to the morning. The lead stays theirs overnight, the
 * clock starts when the office opens, and the agent sees the real time they
 * have in the card on their screen.
 *
 * Dubai is UTC+4 all year with no daylight saving, which is the one mercy
 * here: the arithmetic below is a fixed offset and nothing else.
 */

export const DUBAI_OFFSET_MINUTES = 4 * 60;

export interface Hours {
  /** Minutes past midnight, Dubai time, when the night starts. */
  startMinute: number;
  /** Minutes past midnight, Dubai time, when the office opens. */
  endMinute: number;
}

/** "22:00" → 1320. Anything unparseable falls back, rather than throwing on a lead. */
export function parseClock(value: string | null | undefined, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}

export function dubaiMinuteOfDay(at: Date): number {
  const shifted = new Date(at.getTime() + DUBAI_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/**
 * Is this moment inside the quiet window?
 *
 * The window wraps midnight — 22:00 to 08:00 is two pieces of the clock, not
 * one — which is where this kind of check usually goes wrong.
 */
export function isOutOfHours(at: Date, hours: Hours): boolean {
  const minute = dubaiMinuteOfDay(at);
  if (hours.startMinute === hours.endMinute) return false;
  if (hours.startMinute < hours.endMinute) {
    /* A daytime window, e.g. 01:00–06:00. */
    return minute >= hours.startMinute && minute < hours.endMinute;
  }
  return minute >= hours.startMinute || minute < hours.endMinute;
}

/**
 * The moment an agent's time runs out.
 *
 * In hours, that is simply now plus the SLA. Out of hours, the clock starts
 * when the office opens and runs the full SLA from there — so the agent has
 * their whole window awake, not whatever is left of it.
 */
export function slaDeadline(
  assignedAt: Date,
  slaMinutes: number,
  hours: Hours | null,
): { deadline: Date; deferred: boolean } {
  const normal = new Date(assignedAt.getTime() + slaMinutes * 60_000);
  if (!hours || !isOutOfHours(assignedAt, hours)) return { deadline: normal, deferred: false };

  const minute = dubaiMinuteOfDay(assignedAt);
  /*
   * Minutes until the office opens. After the start of the quiet window the
   * opening is tomorrow; before it — the small hours — it is later today.
   */
  const untilOpen = minute >= hours.startMinute
    ? 24 * 60 - minute + hours.endMinute
    : hours.endMinute - minute;

  return {
    deadline: new Date(assignedAt.getTime() + (untilOpen + slaMinutes) * 60_000),
    deferred: true,
  };
}

/** For the card and the email: "by 08:05 tomorrow" rather than a timestamp. */
export function describeDeadline(deadline: Date, now: Date): string {
  const minute = dubaiMinuteOfDay(deadline);
  const clock = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

  const dayOf = (at: Date) => Math.floor((at.getTime() + DUBAI_OFFSET_MINUTES * 60_000) / 86_400_000);
  const days = dayOf(deadline) - dayOf(now);
  if (days <= 0) return `by ${clock}`;
  if (days === 1) return `by ${clock} tomorrow`;
  return `by ${clock} in ${days} days`;
}
