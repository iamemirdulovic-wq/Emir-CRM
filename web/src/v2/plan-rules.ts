/**
 * The rules the calendar and the tasks list both live by.
 *
 * Pure on purpose, and in their own file, because these are the parts that are
 * easy to get quietly wrong and impossible to see when they are:
 *
 *  - a plan saved in the past, with nothing to say which field was wrong;
 *  - a form that opens at 10:00 whatever is already at 10:00;
 *  - two plans at the same hour and nothing that notices.
 *
 * All three were found by hand by the owner. Everything here is tested in
 * `plan-rules.test.ts`.
 *
 * Times are 24-hour throughout, which is how the office reads them.
 */

/** Which field the person has to go back and change, and what to say. */
export interface FieldProblem {
  field: 'day' | 'time';
  message: string;
}

/** Enough of a plan to compare it with another one. */
export interface Occupied {
  id: string;
  title: string;
  at: Date;
  until: Date;
  allDay: boolean;
  /** A finished plan does not hold its hour against a new one. */
  done: boolean;
}

/** The hours the office works in, which is the calendar's own grid. */
export const DAY_FROM = 7;
export const DAY_TO = 22;

/** The design's time list: every quarter hour from 07:00 to 21:00. */
export const SLOT_FROM = 7;
export const SLOT_TO = 21;
export const SLOT_STEP = 15;

/** The last hour a plan is suggested for, so "next free" cannot run to midnight. */
const LATEST_SUGGESTION = 20 * 60;

/** How far the search for a free slot steps each time. */
const SUGGESTION_STEP = 30;

export function minutesOf(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m ?? 0);
}

export function hhmm(minutes: number): string {
  const whole = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

export function dayKey(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

export function clock(at: Date): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** "Thu 12 Nov", for a day key. */
export function nice(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * The slot list the design uses in place of the browser's time box.
 *
 * Its own box can show AM/PM, which this office does not use, and a quarter
 * hour is the smallest unit anybody here plans in.
 */
export function slots(from = SLOT_FROM, to = SLOT_TO, step = SLOT_STEP): string[] {
  const out: string[] = [];
  for (let m = from * 60; m <= to * 60; m += step) out.push(hhmm(m));
  return out;
}

/**
 * The list with one more time in it, in order.
 *
 * A plan already in the diary at 10:07 — one made before the slot list
 * existed, or by a workflow — must still be shown by a form that is editing
 * it, rather than silently snapped to 10:00.
 */
export function withSlot(list: string[], value: string | null | undefined): string[] {
  if (!value || list.includes(value)) return list;
  const out = [...list];
  const where = out.findIndex((one) => one > value);
  out.splice(where === -1 ? out.length : where, 0, value);
  return out;
}

/**
 * Is this day and time in the past, and if so which field says so?
 *
 * Two different mistakes and two different sentences, word for word as
 * `design/web/calendar.html` and `design/web/tasks.html` write them. The build
 * this replaces printed the day's sentence for both, under the title field.
 */
export function pastProblem(
  day: string,
  time: string | null,
  now: Date = new Date(),
): FieldProblem | null {
  if (!day || day.length !== 10) return { field: 'day', message: 'Choose a day.' };
  const today = dayKey(now);
  if (day < today) {
    return { field: 'day', message: 'This day is in the past. Pick today or later.' };
  }
  if (time && day === today && minutesOf(time) < now.getHours() * 60 + now.getMinutes()) {
    return { field: 'time', message: `This time has passed. It is ${clock(now)} now.` };
  }
  return null;
}

/**
 * What is already in that day at that hour, if anything.
 *
 * A warning, never a refusal: two plans at four o'clock is sometimes exactly
 * what an agent means — a call while waiting for a viewing — and a calendar
 * that argues is a calendar nobody uses.
 */
export function clashIn(
  plans: Occupied[],
  day: string,
  time: string | null,
  lengthMin: number,
  skipId: string | null = null,
): Occupied | null {
  if (!day || !time) return null;
  const start = minutesOf(time);
  const end = start + lengthMin;
  return plans.find((plan) => {
    if (plan.id === skipId || plan.allDay || plan.done) return false;
    if (dayKey(plan.at) !== day) return false;
    const theirs = plan.at.getHours() * 60 + plan.at.getMinutes();
    const theirEnd = theirs + Math.max(15, (plan.until.getTime() - plan.at.getTime()) / 60_000);
    return start < theirEnd && end > theirs;
  }) ?? null;
}

/**
 * The next free time on that day.
 *
 * `design/web/calendar.html` starts at the next hour on today and at 10:00 on
 * any other day, then steps on by half an hour for as long as something is in
 * the way. Both forms used to open at a hard-coded 10:00, so the commonest
 * single action in the CRM — plan the next thing — began by clashing with
 * whatever was already at ten.
 */
export function nextFreeSlot(
  day: string,
  plans: Occupied[],
  now: Date = new Date(),
  lengthMin = 60,
): string {
  const isToday = day === dayKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  /* The next half hour, never earlier than the day's first hour. */
  let minutes = isToday
    ? Math.max(SLOT_FROM * 60, Math.ceil((nowMin + 1) / SUGGESTION_STEP) * SUGGESTION_STEP)
    : 10 * 60;
  while (minutes < LATEST_SUGGESTION && clashIn(plans, day, hhmm(minutes), lengthMin)) {
    minutes += SUGGESTION_STEP;
  }
  return hhmm(Math.min(minutes, SLOT_TO * 60));
}

/**
 * "Free from 15:30 to 16:30." — the second half of the busy-day hint.
 *
 * The longest gap left in the day, measured from now when the day is today and
 * from the grid's first hour otherwise, and never past six in the evening.
 */
export function freeGap(plans: Occupied[], day: string, now: Date = new Date()): string {
  const from = day === dayKey(now)
    ? now.getHours() * 60 + now.getMinutes()
    : SLOT_FROM * 60;
  const timed = plans
    .filter((plan) => !plan.allDay && dayKey(plan.at) === day)
    .map((plan) => ({
      at: plan.at.getHours() * 60 + plan.at.getMinutes(),
      until: plan.at.getHours() * 60 + plan.at.getMinutes()
        + Math.max(15, (plan.until.getTime() - plan.at.getTime()) / 60_000),
    }))
    .sort((a, b) => a.at - b.at);

  let best: [number, number] = [0, 0];
  let last = from;
  for (const one of timed) {
    if (one.at > last && one.at - last > best[1] - best[0]) best = [last, one.at];
    last = Math.max(last, one.until);
  }
  const evening = 18 * 60;
  if (evening - last > best[1] - best[0]) best = [last, evening];
  return best[1] > best[0]
    ? `Free from ${hhmm(best[0])} to ${hhmm(best[1])}.`
    : 'No free time left.';
}

/** The five answers, in the design's own words and its own order. */
export const RESULTS = [
  { value: 'showed', label: 'Showed up', sub: 'The meeting took place', icon: 'check' },
  { value: 'no_show', label: 'No-show', sub: 'The client did not come', icon: 'x' },
  { value: 'rescheduled', label: 'Rescheduled', sub: 'Moved to a new time', icon: 'refresh-cw' },
  { value: 'cancelled', label: 'Cancelled', sub: 'Not a no-show', icon: 'circle-x' },
  { value: 'booked', label: 'Booked a unit', sub: 'The lead moves to Won · +300 points', icon: 'trophy' },
] as const;

export type ResultValue = (typeof RESULTS)[number]['value'];

/**
 * The chip a finished plan wears.
 *
 * Before this, `done` was a boolean: Cancelled, No-show and Showed up all drew
 * the same faded, struck-through row with no word on it, so a cancelled
 * meeting was indistinguishable from one that went well. The word is the fix,
 * and the tone is what makes it readable at a glance on a busy month.
 */
export function resultChip(result: string | null | undefined): { label: string; tone: string } | null {
  switch (result) {
    case 'showed': return { label: 'Showed up', tone: 'd-chip d-green' };
    case 'booked': return { label: 'Booked a unit', tone: 'd-chip d-green' };
    case 'no_show': return { label: 'No-show', tone: 'd-chip d-red' };
    case 'cancelled': return { label: 'Cancelled', tone: 'd-chip' };
    /* "Rescheduled" is not a finished plan: it moved, and it is still to be
       done. The server leaves `result` NULL for exactly that reason. */
    default: return null;
  }
}

/** Who asked, for "Moved it" and for "Cancelled". */
export const ASKED_BY = [
  { value: 'client', label: 'The client' },
  { value: 'me', label: 'Me' },
  { value: 'developer', label: 'Developer' },
] as const;

/** The four next steps after a meeting that happened, and what each plans. */
export const NEXT_STEPS = [
  { label: 'Send the offer', kind: 'follow_up', minutes: 15, place: null, verb: 'Send the offer to' },
  { label: 'Second meeting', kind: 'meeting', minutes: 60, place: 'Office', verb: 'Second meeting with' },
  { label: 'Site visit', kind: 'site_visit', minutes: 60, place: 'Sales centre', verb: 'Site visit with' },
  { label: 'Follow up in 2 days', kind: 'follow_up', minutes: 15, place: null, verb: 'Follow up' },
] as const;

export type NextStepLabel = (typeof NEXT_STEPS)[number]['label'];

/** "Tomorrow 12:00", "In 2 days", "Next week" — the no-show try-again chips. */
export const TRY_AGAIN = [
  { label: 'Tomorrow 12:00', days: 1, time: '12:00' },
  { label: 'In 2 days', days: 2, time: null },
  { label: 'Next week', days: 7, time: null },
  { label: 'Pick day and time', days: null, time: null },
  { label: 'Do not plan now', days: null, time: null },
] as const;

/** A day key N days after another one. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const at = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days);
  return dayKey(at);
}

/**
 * The instant a local day and time name.
 *
 * Built in the reader's own timezone on purpose: 16:30 is 16:30 where the
 * person setting it is standing, which is the only reading that is ever right
 * for a meeting somebody has to be at.
 */
export function instantOf(day: string, time: string): Date {
  return new Date(`${day}T${time.length === 5 ? time : '00:00'}:00`);
}
