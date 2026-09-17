/**
 * Date arithmetic for the calendar grid.
 *
 * Pure and separate from the component because this is the part that is easy to
 * get quietly wrong — a month grid that starts on the wrong weekday, a range
 * that misses the last task of the month by one second, a task drawn on a
 * different day from the one its own label says.
 *
 * **Everything here is Asia/Dubai time**, not the browser's. The rest of the
 * CRM renders every timestamp in Dubai (see `format.ts`), because that is where
 * the business runs; a calendar bucketing by browser-local days would put a
 * task due 01:00 on the 18th into the cell for the 17th for anyone viewing from
 * Europe, while the row underneath it still read "18 Sept". One screen, two
 * answers. The grid follows the labels.
 *
 * The technique: a *civil* date is a `Date` whose **UTC** fields hold Dubai
 * wall-clock. All the grid arithmetic then runs on UTC getters and setters,
 * which have no daylight-saving discontinuities to fall into, and only the two
 * conversions at the edges know about the zone.
 */

export type CalendarView = 'month' | 'week' | 'day';

/** The business timezone. Matches `TIMEZONE` on the server and `TZ` in format.ts. */
const TZ = 'Asia/Dubai';

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * An instant's Dubai wall-clock, as a Date carrying it in its UTC fields.
 *
 * The UAE has never observed daylight saving, so in practice this is always
 * +04:00 — but reading the offset out of `Intl` rather than hard-coding four
 * hours costs nothing and means the app does not quietly break on the day that
 * stops being true.
 */
export function civil(instant: Date): Date {
  const parts = Object.fromEntries(PARTS.formatToParts(instant).map((p) => [p.type, p.value]));
  return new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      // Intl renders midnight as "24" in some ICU builds.
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    ),
  );
}

/** How far Dubai is ahead of UTC at that moment, in milliseconds. */
function offsetAt(instant: Date): number {
  return civil(instant).getTime() - instant.getTime();
}

/**
 * A civil Dubai date back to the instant it names.
 *
 * Applied twice: the offset depends on the instant, and the instant is what we
 * are solving for. The first pass gets within an hour, the second lands exactly
 * — the standard fixed point, and in a zone without DST the second pass is a
 * no-op anyway.
 */
export function instantOf(civilDate: Date): Date {
  const guess = new Date(civilDate.getTime() - offsetAt(civilDate));
  return new Date(civilDate.getTime() - offsetAt(guess));
}

/** Midnight in Dubai at the start of the day that instant falls in. */
export function startOfDay(instant: Date): Date {
  const out = civil(instant);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

/**
 * Midnight on the Monday of that week.
 *
 * Monday, because the UAE working week has run Monday to Friday since 2022 and
 * a calendar that starts on Sunday puts the weekend in the middle.
 */
export function startOfWeek(instant: Date): Date {
  const out = startOfDay(instant);
  // getUTCDay(): 0 is Sunday, so Sunday is six days after its own Monday.
  out.setUTCDate(out.getUTCDate() - ((out.getUTCDay() + 6) % 7));
  return out;
}

export function startOfMonth(instant: Date): Date {
  const out = startOfDay(instant);
  out.setUTCDate(1);
  return out;
}

/** Add days to a civil date. Safe: UTC fields have no DST to trip over. */
export function addDays(civilDate: Date, count: number): Date {
  const out = new Date(civilDate);
  out.setUTCDate(out.getUTCDate() + count);
  return out;
}

export function addMonths(civilDate: Date, count: number): Date {
  const out = startOfMonth(civilDate);
  out.setUTCMonth(out.getUTCMonth() + count);
  return out;
}

/** Same Dubai day? Both arguments are civil dates. */
export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/**
 * The six weeks a month grid shows: always 42 cells, so the grid does not
 * change height as you page through the year and make the whole screen jump.
 */
export function monthGrid(anchor: Date): Date[] {
  const first = startOfWeek(startOfMonth(anchor));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function weekDays(anchor: Date): Date[] {
  const first = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/**
 * The window to ask the server for, as real instants.
 *
 * `to` is exclusive and sits at Dubai midnight the day after the last one
 * shown, so a task due at 23:59 on the final day is inside it. An inclusive end
 * at midnight would drop every task on that last day, which is the classic
 * version of this bug and only ever noticed by the person whose meeting
 * vanished.
 */
export function rangeFor(view: CalendarView, anchor: Date): { from: string; to: string } {
  const first = view === 'day' ? startOfDay(anchor) : view === 'week' ? startOfWeek(anchor) : monthGrid(anchor)[0] as Date;
  const span = view === 'day' ? 1 : view === 'week' ? 7 : 42;
  return {
    from: instantOf(first).toISOString(),
    to: instantOf(addDays(first, span)).toISOString(),
  };
}

/** How to move when someone presses the arrows. */
export function step(view: CalendarView, anchor: Date, direction: -1 | 1): Date {
  if (view === 'month') return addMonths(anchor, direction);
  return addDays(anchor, direction * (view === 'week' ? 7 : 1));
}

/**
 * The heading over the grid: "September 2026", "14 – 20 Sept 2026",
 * "Thu, 17 Sept 2026".
 *
 * Formatted in UTC, because a civil date already *is* Dubai wall-clock held in
 * UTC fields — asking Intl to apply the zone again would shift it twice.
 */
export function periodLabel(view: CalendarView, anchor: Date, locale = 'en-GB'): string {
  const show = (date: Date, options: Intl.DateTimeFormatOptions) =>
    date.toLocaleDateString(locale, { timeZone: 'UTC', ...options });

  if (view === 'day') {
    return show(anchor, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  if (view === 'week') {
    const days = weekDays(anchor);
    const first = days[0] as Date;
    const last = days[6] as Date;
    // The month is named once when the week sits inside one, twice when it
    // straddles two: "29 Sept – 5 Oct 2026".
    const sameMonth = first.getUTCMonth() === last.getUTCMonth();
    const head = show(first, { day: 'numeric', ...(sameMonth ? {} : { month: 'short' }) });
    return `${head} – ${show(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return show(anchor, { month: 'long', year: 'numeric' });
}

/** The day number in its own cell. */
export function dayNumber(civilDate: Date): number {
  return civilDate.getUTCDate();
}

/** The weekday headings, Monday first, in the viewer's language. */
export function weekdayNames(locale = 'en-GB'): string[] {
  // Any Monday will do; 2024-01-01 was one.
  const monday = new Date(Date.UTC(2024, 0, 1));
  return Array.from({ length: 7 }, (_, i) =>
    addDays(monday, i).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }),
  );
}

/** Key a civil date as `YYYY-MM-DD`, which is how the grid and the tasks meet. */
export function dayKey(civilDate: Date): string {
  const month = String(civilDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(civilDate.getUTCDate()).padStart(2, '0');
  return `${civilDate.getUTCFullYear()}-${month}-${day}`;
}

/** Key an instant by the Dubai day it falls in. */
export function dayKeyOfInstant(value: string | Date): string {
  return dayKey(civil(typeof value === 'string' ? new Date(value) : value));
}

/** Group items into the Dubai day each one falls on. */
export function groupByDay<T>(items: T[], when: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = dayKeyOfInstant(when(item));
    const bucket = out.get(key);
    if (bucket) bucket.push(item);
    else out.set(key, [item]);
  }
  return out;
}

/** Is this civil date today in Dubai? */
export function isToday(civilDate: Date): boolean {
  return dayKey(civilDate) === dayKey(civil(new Date()));
}

/**
 * A civil date and a time-of-day, as the value an `<input type="datetime-local">`
 * wants: Dubai wall-clock, which is exactly what the agent means when they pick
 * "tomorrow at 10:00".
 */
export function toLocalInput(instant: Date): string {
  const c = civil(instant);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dayKey(c)}T${pad(c.getUTCHours())}:${pad(c.getUTCMinutes())}`;
}

/** The inverse: what the agent typed, back to the instant it names. */
export function fromLocalInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match as unknown as string[];
  const asCivil = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)));
  if (Number.isNaN(asCivil.getTime())) return null;
  return instantOf(asCivil);
}
