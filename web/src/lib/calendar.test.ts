import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, civil, dayKey, dayKeyOfInstant, fromLocalInput, groupByDay, instantOf,
  isSameDay, monthGrid, periodLabel, rangeFor, startOfDay, startOfMonth, startOfWeek, step,
  toLocalInput, weekDays, weekdayNames,
} from './calendar.js';

/** A civil Dubai date, written the way the tests read best. */
const at = (y: number, m: number, d: number, hh = 0, mm = 0) =>
  new Date(Date.UTC(y, m - 1, d, hh, mm));

describe('the Dubai/UTC boundary', () => {
  it('reads an instant as Dubai wall-clock', () => {
    // 21:00 UTC is 01:00 the next morning in Dubai.
    expect(dayKey(civil(new Date('2026-09-17T21:00:00Z')))).toBe('2026-09-18');
    expect(civil(new Date('2026-09-17T21:00:00Z')).getUTCHours()).toBe(1);
  });

  it('turns a civil date back into the instant it names', () => {
    expect(instantOf(at(2026, 9, 18, 1, 0)).toISOString()).toBe('2026-09-17T21:00:00.000Z');
  });

  it('round-trips', () => {
    const instant = new Date('2026-03-08T19:34:00Z');
    expect(instantOf(civil(instant)).getTime()).toBe(instant.getTime());
  });

  /*
   * The bug this whole module exists to prevent: a task due at 01:00 Dubai on
   * the 18th belongs in the cell for the 18th, whatever the viewer's own clock
   * says. Node runs these tests in UTC, where the same instant is the 17th.
   */
  it('buckets a task by its Dubai day, not the browser', () => {
    expect(dayKeyOfInstant('2026-09-17T21:00:00Z')).toBe('2026-09-18');
    expect(new Date('2026-09-17T21:00:00Z').getUTCDate()).toBe(17);
  });
});

describe('the edges of a day, week and month', () => {
  it('starts a day at Dubai midnight', () => {
    const start = startOfDay(new Date('2026-09-17T19:45:00Z'));
    expect(dayKey(start)).toBe('2026-09-17');
    expect(start.getUTCHours()).toBe(0);
    // Which is 20:00 the previous evening in UTC.
    expect(instantOf(start).toISOString()).toBe('2026-09-16T20:00:00.000Z');
  });

  it('starts the week on Monday', () => {
    // 17 September 2026 is a Thursday.
    expect(dayKey(startOfWeek(at(2026, 9, 17)))).toBe('2026-09-14');
  });

  it('treats Sunday as the end of its week, not the start', () => {
    // 20 September 2026 is a Sunday; its Monday is the 14th.
    expect(dayKey(startOfWeek(at(2026, 9, 20)))).toBe('2026-09-14');
  });

  it('starts the month on the first', () => {
    expect(dayKey(startOfMonth(at(2026, 9, 17)))).toBe('2026-09-01');
  });
});

describe('moving around', () => {
  it('adds days across a month end', () => {
    expect(dayKey(addDays(at(2026, 1, 31), 1))).toBe('2026-02-01');
  });

  it('adds days across a year end', () => {
    expect(dayKey(addDays(at(2026, 12, 31), 1))).toBe('2027-01-01');
  });

  it('adds months without landing on the 31st of a short month', () => {
    // addMonths normalises to the 1st first, so January + 1 is February, not
    // the 3rd of March.
    expect(dayKey(addMonths(at(2026, 1, 31), 1))).toBe('2026-02-01');
  });

  it('steps by the size of the view', () => {
    expect(dayKey(step('day', at(2026, 9, 17), 1))).toBe('2026-09-18');
    expect(dayKey(step('week', at(2026, 9, 17), 1))).toBe('2026-09-24');
    expect(dayKey(step('month', at(2026, 9, 17), 1))).toBe('2026-10-01');
    expect(dayKey(step('week', at(2026, 9, 17), -1))).toBe('2026-09-10');
  });

  it('knows two instants in the same Dubai day are the same day', () => {
    expect(isSameDay(at(2026, 9, 17, 1), at(2026, 9, 17, 23))).toBe(true);
    expect(isSameDay(at(2026, 9, 17), at(2026, 9, 18))).toBe(false);
  });
});

describe('the month grid', () => {
  it('is always six weeks, so the page does not change height', () => {
    for (const month of [1, 2, 5, 8, 12]) {
      expect(monthGrid(at(2026, month, 15))).toHaveLength(42);
    }
    // February 2027 starts on a Monday and has 28 days — the one case that
    // fits in exactly four weeks, and would still be padded to six.
    expect(monthGrid(at(2027, 2, 15))).toHaveLength(42);
  });

  it('starts on the Monday on or before the first of the month', () => {
    // 1 September 2026 is a Tuesday, so the grid opens on Monday the 31st.
    expect(dayKey(monthGrid(at(2026, 9, 17))[0] as Date)).toBe('2026-08-31');
  });

  it('runs without a gap', () => {
    const grid = monthGrid(at(2026, 9, 17));
    for (let i = 1; i < grid.length; i += 1) {
      const gap = (grid[i] as Date).getTime() - (grid[i - 1] as Date).getTime();
      expect(gap).toBe(86_400_000);
    }
  });

  it('gives a week of seven days', () => {
    const days = weekDays(at(2026, 9, 17));
    expect(days).toHaveLength(7);
    expect(dayKey(days[0] as Date)).toBe('2026-09-14');
    expect(dayKey(days[6] as Date)).toBe('2026-09-20');
  });

  it('names the weekdays Monday first', () => {
    expect(weekdayNames('en-GB')[0]).toBe('Mon');
    expect(weekdayNames('en-GB')[6]).toBe('Sun');
  });
});

describe('the range sent to the server', () => {
  it('ends the day after the last one shown, so 23:59 is included', () => {
    const { from, to } = rangeFor('day', at(2026, 9, 17));
    // Dubai midnight on the 17th and 18th, which is 20:00 the evenings before.
    expect(from).toBe('2026-09-16T20:00:00.000Z');
    expect(to).toBe('2026-09-17T20:00:00.000Z');

    // A task at 23:30 Dubai on the 17th is 19:30 UTC — inside the window.
    const late = new Date('2026-09-17T19:30:00Z');
    expect(late.getTime()).toBeGreaterThanOrEqual(new Date(from).getTime());
    expect(late.getTime()).toBeLessThan(new Date(to).getTime());
  });

  it('covers exactly the week shown', () => {
    const { from, to } = rangeFor('week', at(2026, 9, 17));
    expect((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000).toBe(7);
    expect(dayKeyOfInstant(from)).toBe('2026-09-14');
  });

  it('covers all six weeks of the month grid, not just the month', () => {
    const { from, to } = rangeFor('month', at(2026, 9, 17));
    expect((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000).toBe(42);
    // Which is inside the server's 62-day cap.
    expect(42).toBeLessThanOrEqual(62);
  });
});

describe('the heading over the grid', () => {
  const anchor = at(2026, 9, 17);

  it('names the month', () => {
    expect(periodLabel('month', anchor)).toBe('September 2026');
  });

  it('shows a week as a span', () => {
    // "Sept", not "Sep": that is what en-GB actually renders, and pinning the
    // wrong abbreviation would test my assumption rather than the code.
    expect(periodLabel('week', anchor)).toBe('14 – 20 Sept 2026');
  });

  it('names both months when a week straddles two', () => {
    expect(periodLabel('week', at(2026, 9, 30))).toBe('28 Sept – 4 Oct 2026');
  });

  it('names the day', () => {
    expect(periodLabel('day', anchor)).toBe('Thu, 17 Sept 2026');
  });

  it('does not shift the date by applying the zone twice', () => {
    // A civil date already holds Dubai wall-clock in its UTC fields. Formatting
    // it with timeZone: 'Asia/Dubai' would add another four hours and roll the
    // day over at 20:00.
    expect(periodLabel('day', at(2026, 9, 17, 22, 0))).toBe('Thu, 17 Sept 2026');
  });
});

describe('grouping tasks into cells', () => {
  it('puts each task in its Dubai day', () => {
    const tasks = [
      { id: 'a', due_at: '2026-09-17T06:00:00Z' }, // 10:00 on the 17th
      { id: 'b', due_at: '2026-09-17T21:00:00Z' }, // 01:00 on the 18th
      { id: 'c', due_at: '2026-09-17T19:00:00Z' }, // 23:00 on the 17th
    ];
    const grouped = groupByDay(tasks, (task) => task.due_at);
    expect(grouped.get('2026-09-17')?.map((t) => t.id)).toEqual(['a', 'c']);
    expect(grouped.get('2026-09-18')?.map((t) => t.id)).toEqual(['b']);
  });

  it('returns nothing for a day with no tasks', () => {
    expect(groupByDay([], () => '').get('2026-09-17')).toBeUndefined();
  });
});

describe('the due-date field', () => {
  it('shows an instant as the Dubai time the agent means', () => {
    expect(toLocalInput(new Date('2026-09-17T06:30:00Z'))).toBe('2026-09-17T10:30');
  });

  it('reads what the agent typed as Dubai time', () => {
    expect(fromLocalInput('2026-09-17T10:30')?.toISOString()).toBe('2026-09-17T06:30:00.000Z');
  });

  it('round-trips', () => {
    const typed = '2026-12-31T23:45';
    expect(toLocalInput(fromLocalInput(typed) as Date)).toBe(typed);
  });

  it('rejects an empty or half-typed value rather than inventing a date', () => {
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('2026-09-17')).toBeNull();
    expect(fromLocalInput('not a date')).toBeNull();
  });
});
