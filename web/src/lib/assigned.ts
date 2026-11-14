/**
 * When a lead was given to an agent, said in a way an agent can read at a
 * glance.
 *
 * Talha, 14 Nov 2026, with a screenshot of 105 new leads in which every card
 * was identical: *"you need to put dates on the leads once they assign, so we
 * know which one is today leads, which one is yesterday, and which one is day
 * before yesterday."*
 *
 * The date is `opportunities.assigned_at` and nothing else. It has existed
 * since the first migration and was simply never sent to the screen. It is
 * **when the lead was given to this agent**, not when the lead arrived — the
 * owner chose that deliberately on 14 Nov, because the two differ exactly
 * where it matters: a lead moved from one agent to another, and an old list
 * imported months after the people in it enquired.
 *
 * Two rules this file exists to hold in one place:
 *
 *   - **Dubai, at a fixed +04:00.** `civil()` in `calendar.ts` is the helper;
 *     "today" means today in Dubai and not on the reader's laptop. A lead
 *     given at 00:30 Dubai is today's lead to everyone, including whoever is
 *     looking at it from Europe at 20:30 their own yesterday.
 *   - **A missing date is said, never substituted.** A lead that has never
 *     been given out reads "Not given out yet". It does not quietly borrow
 *     `created_at` or `last_contact_at` and present that as the day it was
 *     handed over — a blank beats a confident wrong answer, and an agent
 *     deciding which lead is stale off a borrowed date is worse than one who
 *     can see there is no date.
 */

import { civil, dayKey, instantOf } from './calendar.js';
import { formatTime, plural } from './format.js';

/** What a card or a row says about when this lead was handed over. */
export interface Given {
  /** No `assigned_at` at all: never given out, or sitting in the pool. */
  missing: boolean;
  /** Given before today in Dubai — the ones that should read warm. */
  stale: boolean;
  /** `11:42` today, `Yesterday 16:30`, `12 Nov 10:05`. */
  when: string;
  /** `21 h ago`, `2 days ago`. Null on today's, where the time is enough. */
  ago: string | null;
  /** The whole line: `Yesterday 16:30 · 21 h ago`, or the missing sentence. */
  text: string;
  /** Full date and time, for the `title` tooltip. */
  exact: string | null;
}

/** Said once, so the three screens cannot word it three ways. */
export const NOT_GIVEN = 'Not given out yet';

/** The Dubai day an instant falls in, or null when there is no instant. */
export function givenDayKey(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const at = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(at.getTime())) return null;
  return dayKey(civil(at));
}

/** How many whole Dubai days back that day is. 0 is today, 1 yesterday. */
function daysBack(key: string, now: Date): number {
  const today = instantOf(midnightOf(dayKey(civil(now))));
  const then = instantOf(midnightOf(key));
  return Math.round((today.getTime() - then.getTime()) / 86_400_000);
}

/** `YYYY-MM-DD` back to the civil date at midnight on it. */
function midnightOf(key: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * How long it has been sitting.
 *
 * Minutes under the hour, hours up to two days, then whole Dubai days — so
 * the number beside "12 Nov" counts the same days the heading over it does.
 * A lead given yesterday at 23:50 and read at 00:10 says "20 min ago" rather
 * than "1 day ago", which is true of the clock and of the work.
 */
function sittingFor(at: Date, now: Date, back: number): string {
  if (back >= 2) return `${back} days ago`;
  const ms = Math.max(0, now.getTime() - at.getTime());
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  return `${Math.floor(ms / 3_600_000)} h ago`;
}

/**
 * The line to print for one lead's `assigned_at`.
 *
 * `now` is injectable only so the tests can stand at a chosen minute; every
 * caller leaves it out.
 */
export function given(value: string | Date | null | undefined, now = new Date()): Given {
  const key = givenDayKey(value);
  if (!key || !value) {
    return { missing: true, stale: false, when: NOT_GIVEN, ago: null, text: NOT_GIVEN, exact: null };
  }

  const at = typeof value === 'string' ? new Date(value) : value;
  const back = daysBack(key, now);
  /* 24-hour, from the one formatter that promises it. Emir asked for a
     24-hour clock by name on 13 Nov and `format.ts` carries the flag. */
  const clock = formatTime(at);

  if (back <= 0) {
    /* Today — and anything dated ahead of now, which a clock skew between the
       database and the browser can produce. Both read as today's. */
    return {
      missing: false,
      stale: false,
      when: clock,
      ago: null,
      text: clock,
      exact: exactly(at),
    };
  }

  const when = back === 1
    ? `Yesterday ${clock}`
    : `${civil(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${clock}`;
  const ago = sittingFor(at, now, back);
  return { missing: false, stale: true, when, ago, text: `${when} · ${ago}`, exact: exactly(at) };
}

/** The whole thing, for a tooltip: `Thursday 12 Nov 2026, 10:05`. */
function exactly(at: Date): string {
  const c = civil(at);
  const date = c.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  return `${date}, ${formatTime(at)}`;
}

/** `Today`, `Yesterday`, `Wednesday 12 Nov`, or the missing group's name. */
export function givenDayHeading(key: string | null, now = new Date()): string {
  if (!key) return NOT_GIVEN;
  const back = daysBack(key, now);
  if (back <= 0) return 'Today';
  if (back === 1) return 'Yesterday';
  const civilDay = midnightOf(key);
  const sameYear = civilDay.getUTCFullYear() === civil(now).getUTCFullYear();
  return civilDay.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export interface GivenDay<T> {
  /** `YYYY-MM-DD` in Dubai, or null for the leads with no date at all. */
  key: string | null;
  heading: string;
  /** `12 leads`, `1 lead` — what the agent asked to see beside each heading. */
  count: string;
  rows: T[];
}

/**
 * The list, cut into the days it was handed out on.
 *
 * Newest day first, the leads with no date last in a group that says so, and
 * the order inside each day left exactly as the server sent it — the tabs sort
 * by what is owed next, and that order is the one an agent works down.
 */
export function groupByGivenDay<T>(
  rows: T[],
  pick: (row: T) => string | Date | null | undefined,
  now = new Date(),
): Array<GivenDay<T>> {
  const buckets = new Map<string, T[]>();
  const none: T[] = [];

  for (const row of rows) {
    const key = givenDayKey(pick(row));
    if (!key) {
      none.push(row);
      continue;
    }
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const out: Array<GivenDay<T>> = [...buckets.keys()]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((key) => ({
      key,
      heading: givenDayHeading(key, now),
      count: plural((buckets.get(key) as T[]).length, 'lead'),
      rows: buckets.get(key) as T[],
    }));

  if (none.length > 0) {
    out.push({ key: null, heading: NOT_GIVEN, count: plural(none.length, 'lead'), rows: none });
  }
  return out;
}
