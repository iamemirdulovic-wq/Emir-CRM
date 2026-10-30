import { describe, expect, it } from 'vitest';
import { budgetStepLabel, describeLocalInput, localInputValue, quickTimes } from './forms.js';

/**
 * A callback time an agent reads wrong is a client who gets a call at the
 * wrong hour, or no call at all. The browser's own date control is formatted
 * from the browser's language, which this CRM does not control, so the echo
 * under it has to be right in every case.
 */
describe('reading a chosen time back to the agent', () => {
  it('writes the date the way the rest of the CRM does', () => {
    expect(describeLocalInput('2026-10-31T10:00')).toBe('Sat 31 Oct 2026 · 10:00');
  });

  it('keeps 24-hour time, as the business does', () => {
    expect(describeLocalInput('2026-01-05T19:30')).toBe('Mon 5 Jan 2026 · 19:30');
    expect(describeLocalInput('2026-01-05T00:05')).toBe('Mon 5 Jan 2026 · 00:05');
  });

  /*
   * The value is wall-clock time already. Putting it through a Date and a
   * timezone is how a 10:00 callback quietly becomes an 06:00 one.
   */
  it('does not shift the hour through a timezone', () => {
    expect(describeLocalInput('2026-06-15T14:00')).toContain('14:00');
    expect(describeLocalInput('2026-12-15T14:00')).toContain('14:00');
  });

  it('drops the leading zero on the day but not on the hour', () => {
    expect(describeLocalInput('2026-03-07T09:05')).toBe('Sat 7 Mar 2026 · 09:05');
  });

  it('says nothing rather than guessing at an empty or broken value', () => {
    expect(describeLocalInput('')).toBe('');
    expect(describeLocalInput('tomorrow')).toBe('');
  });
});

describe('the value the browser control needs', () => {
  /* `datetime-local` wants local wall-clock, never an ISO UTC string — an
     agent in Dubai setting 10:00 must not see 06:00 come back. */
  it('formats a Date as local wall-clock, not UTC', () => {
    const date = new Date(2026, 9, 31, 10, 0);
    expect(localInputValue(date)).toBe('2026-10-31T10:00');
  });

  it('pads every part to the width the control expects', () => {
    expect(localInputValue(new Date(2026, 0, 5, 9, 5))).toBe('2026-01-05T09:05');
  });

  it('round-trips through the echo', () => {
    const value = localInputValue(new Date(2026, 4, 3, 16, 45));
    expect(describeLocalInput(value)).toBe('Sun 3 May 2026 · 16:45');
  });
});

describe('the quick callback times', () => {
  it('offers tonight only while there is an evening left', () => {
    const morning = quickTimes(new Date(2026, 9, 30, 9, 0));
    const evening = quickTimes(new Date(2026, 9, 30, 21, 0));
    expect(morning.some((option) => option.label === 'Tonight 19:00')).toBe(true);
    expect(evening.some((option) => option.label === 'Tonight 19:00')).toBe(false);
  });

  it('always offers tomorrow morning, which is the common one', () => {
    const options = quickTimes(new Date(2026, 9, 30, 21, 0));
    const tomorrow = options.find((option) => option.label === 'Tomorrow 10:00');
    expect(tomorrow?.value).toBe('2026-10-31T10:00');
  });

  /* An "in 1 hour" that lands yesterday would be set and never fire. */
  it('never offers a time in the past', () => {
    const now = new Date(2026, 9, 30, 23, 30);
    for (const option of quickTimes(now)) {
      expect(new Date(option.value).getTime(), option.label).toBeGreaterThan(now.getTime());
    }
  });

  it('carries an hour over midnight into the next day', () => {
    expect(quickTimes(new Date(2026, 9, 30, 23, 30))[0]?.value).toBe('2026-10-31T00:30');
  });
});

describe('the short budget label', () => {
  it('keeps a round million round and tops out with a plus', () => {
    expect(budgetStepLabel(2_000_000)).toBe('AED 2M');
    expect(budgetStepLabel(2_500_000)).toBe('AED 2.5M');
    expect(budgetStepLabel(750_000)).toBe('AED 750K');
    expect(budgetStepLabel(20_000_000)).toBe('AED 20M+');
  });
});
