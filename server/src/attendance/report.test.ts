import { describe, expect, it } from 'vitest';
import { monthRange, recentMonths } from './report.js';

/**
 * The month picker on `design/web/settings-attendance.html`.
 *
 * Dubai is UTC+4 with no daylight saving, so these are fixed-offset sums on
 * purpose: at 02:00 on the first of the month in Dubai it is still the last
 * day of the previous month in UTC, and a picker that offered the wrong three
 * months is a report for the wrong three months.
 */
describe('which months the picker offers', () => {
  it('offers this month and the two before it, newest first', () => {
    /* 11 Nov 2026, 10:00 UTC — mid-afternoon in Dubai. */
    const months = recentMonths(new Date('2026-11-11T10:00:00Z'));
    expect(months.map((one) => one.key)).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(months[0]?.label).toBe('November 2026');
  });

  it('crosses a year without inventing month thirteen', () => {
    const months = recentMonths(new Date('2027-01-05T10:00:00Z'));
    expect(months.map((one) => one.key)).toEqual(['2027-01', '2026-12', '2026-11']);
    expect(months[2]?.label).toBe('November 2026');
  });

  it('is already the next month at 02:00 Dubai on the 1st', () => {
    /* 22:30 UTC on 31 October is 02:30 on 1 November in Dubai. An owner
       opening the page then is in November. */
    const months = recentMonths(new Date('2026-10-31T22:30:00Z'));
    expect(months[0]?.key).toBe('2026-11');
  });
});

describe('a month’s first and last day', () => {
  it('ends on the real last day, February included', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    /* 2028 is a leap year, and a 28-day February in it would lose a day of
       everybody's attendance. */
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});
