import { describe, expect, it } from 'vitest';
import {
  describeDeadline, dubaiMinuteOfDay, isOutOfHours, parseClock, slaDeadline, type Hours,
} from './hours.js';

/**
 * The night shift problem.
 *
 * A lead arriving at 03:10 still gets its WhatsApp inside thirty seconds. What
 * must not happen is holding a sleeping agent to a five-minute call-back and
 * taking the lead off them at 03:15 for failing — by morning the lead has
 * bounced, the agent has a breach against their name, and nobody has spoken to
 * the client.
 *
 * The window wraps midnight, which is where this kind of arithmetic usually
 * goes wrong, so every edge of it is pinned here.
 */

const NIGHT: Hours = { startMinute: 22 * 60, endMinute: 8 * 60 };

/** A Date at a given Dubai wall-clock time. Dubai is UTC+4, no daylight saving. */
const dubai = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 9, day, hour - 4, minute, 0));

describe('reading the clock', () => {
  it('reads a time an owner typed', () => {
    expect(parseClock('22:00', 0)).toBe(1320);
    expect(parseClock('08:30', 0)).toBe(510);
    expect(parseClock('0:05', 0)).toBe(5);
  });

  /* A bad value must never throw on a lead arriving. */
  it('falls back rather than failing on nonsense', () => {
    expect(parseClock('', 480)).toBe(480);
    expect(parseClock(null, 480)).toBe(480);
    expect(parseClock('tea time', 480)).toBe(480);
    expect(parseClock('25:00', 480)).toBe(480);
    expect(parseClock('08:70', 480)).toBe(480);
  });

  it('converts a moment to the minute of the Dubai day', () => {
    expect(dubaiMinuteOfDay(dubai(15, 14, 30))).toBe(14 * 60 + 30);
    expect(dubaiMinuteOfDay(dubai(15, 0, 0))).toBe(0);
  });
});

describe('knowing when the office is shut', () => {
  it('is shut late at night and in the small hours', () => {
    expect(isOutOfHours(dubai(15, 22, 0), NIGHT)).toBe(true);
    expect(isOutOfHours(dubai(15, 23, 59), NIGHT)).toBe(true);
    expect(isOutOfHours(dubai(15, 3, 10), NIGHT)).toBe(true);
    expect(isOutOfHours(dubai(15, 7, 59), NIGHT)).toBe(true);
  });

  it('is open through the working day', () => {
    expect(isOutOfHours(dubai(15, 8, 0), NIGHT)).toBe(false);
    expect(isOutOfHours(dubai(15, 13, 0), NIGHT)).toBe(false);
    expect(isOutOfHours(dubai(15, 21, 59), NIGHT)).toBe(false);
  });

  /* Both ends matter: 22:00 is shut, 08:00 is open. An off-by-one here is an
     agent woken at ten to eight, or a lead left until five past. */
  it('is exact at both edges', () => {
    expect(isOutOfHours(dubai(15, 21, 59), NIGHT)).toBe(false);
    expect(isOutOfHours(dubai(15, 22, 0), NIGHT)).toBe(true);
    expect(isOutOfHours(dubai(15, 7, 59), NIGHT)).toBe(true);
    expect(isOutOfHours(dubai(15, 8, 0), NIGHT)).toBe(false);
  });

  it('handles a window that does not wrap midnight', () => {
    const siesta: Hours = { startMinute: 13 * 60, endMinute: 16 * 60 };
    expect(isOutOfHours(dubai(15, 14, 0), siesta)).toBe(true);
    expect(isOutOfHours(dubai(15, 12, 0), siesta)).toBe(false);
    expect(isOutOfHours(dubai(15, 23, 0), siesta)).toBe(false);
  });

  /* Start equal to end means somebody switched it off, not a 24-hour night. */
  it('treats an empty window as no quiet hours at all', () => {
    const none: Hours = { startMinute: 480, endMinute: 480 };
    expect(isOutOfHours(dubai(15, 3, 0), none)).toBe(false);
  });
});

describe('when the five minutes start', () => {
  it('starts now during the working day', () => {
    const at = dubai(15, 14, 0);
    const { deadline, deferred } = slaDeadline(at, 5, NIGHT);
    expect(deferred).toBe(false);
    expect(deadline.getTime()).toBe(at.getTime() + 5 * 60_000);
  });

  it('starts at opening time for a lead that arrives in the small hours', () => {
    const { deadline, deferred } = slaDeadline(dubai(15, 3, 10), 5, NIGHT);
    expect(deferred).toBe(true);
    expect(dubaiMinuteOfDay(deadline)).toBe(8 * 60 + 5);
    /* Same morning, not the next one. */
    expect(deadline.getTime()).toBe(dubai(15, 8, 5).getTime());
  });

  it('carries a late-evening lead over to the next morning', () => {
    const { deadline, deferred } = slaDeadline(dubai(15, 23, 30), 5, NIGHT);
    expect(deferred).toBe(true);
    expect(deadline.getTime()).toBe(dubai(16, 8, 5).getTime());
  });

  it('gives the agent the whole window awake, not what is left of it', () => {
    /* Arriving one minute before closing must not mean four minutes at 08:00. */
    const { deadline } = slaDeadline(dubai(15, 21, 59), 5, NIGHT);
    expect(deadline.getTime()).toBe(dubai(15, 22, 4).getTime());

    const overnight = slaDeadline(dubai(15, 22, 1), 5, NIGHT);
    expect(overnight.deadline.getTime()).toBe(dubai(16, 8, 5).getTime());
  });

  it('respects a longer SLA the owner has set', () => {
    const { deadline } = slaDeadline(dubai(15, 2, 0), 30, NIGHT);
    expect(deadline.getTime()).toBe(dubai(15, 8, 30).getTime());
  });

  it('never moves the deadline when quiet hours are switched off', () => {
    const at = dubai(15, 3, 10);
    const { deadline, deferred } = slaDeadline(at, 5, null);
    expect(deferred).toBe(false);
    expect(deadline.getTime()).toBe(at.getTime() + 5 * 60_000);
  });

  /* Whatever happens, the deadline is in the future. A deadline in the past
     is a lead bounced the instant it is assigned. */
  it('is always ahead of the moment the lead arrived', () => {
    for (const hour of [0, 3, 7, 8, 12, 21, 22, 23]) {
      const at = dubai(15, hour, 30);
      expect(slaDeadline(at, 5, NIGHT).deadline.getTime(), `at ${hour}:30`).toBeGreaterThan(at.getTime());
    }
  });
});

describe('saying the deadline out loud', () => {
  it('gives just the time when it is today', () => {
    expect(describeDeadline(dubai(15, 14, 5), dubai(15, 14, 0))).toBe('by 14:05');
  });

  it('says tomorrow when it is tomorrow', () => {
    expect(describeDeadline(dubai(16, 8, 5), dubai(15, 23, 30))).toBe('by 08:05 tomorrow');
  });

  /* Crossing midnight is a different day even when it is four hours away. */
  it('counts days, not hours', () => {
    expect(describeDeadline(dubai(16, 8, 5), dubai(15, 22, 0))).toBe('by 08:05 tomorrow');
  });
});
