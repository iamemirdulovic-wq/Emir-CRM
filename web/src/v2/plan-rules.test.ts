import { describe, expect, it } from 'vitest';
import {
  addDays, clashIn, dayKey, freeGap, instantOf, nextFreeSlot, pastProblem, resultChip,
  slots, withSlot, type Occupied,
} from './plan-rules.js';

/**
 * The calendar's and the tasks list's own rules.
 *
 * Five of the eight faults the owner found by hand are here, in the half that
 * can be checked without a browser: the past is refused and the refusal names
 * the field, a new plan opens at the next free time rather than at ten, a
 * clash is noticed, and a cancelled plan is told apart from one that went
 * well.
 */

/** Wednesday 11 November 2026, 14:55 — the hour every design file is set at. */
const NOW = new Date(2026, 10, 11, 14, 55);
const TODAY = '2026-11-11';

function plan(id: string, day: string, time: string, minutes: number, over: Partial<Occupied> = {}): Occupied {
  const at = instantOf(day, time);
  return {
    id,
    title: id,
    at,
    until: new Date(at.getTime() + minutes * 60_000),
    allDay: false,
    done: false,
    ...over,
  };
}

/* ── 1 and 4: the past, and which field is wrong ─────────────────────────── */

describe('a day and time in the past', () => {
  it('blames the day when the day has gone', () => {
    expect(pastProblem('2026-11-10', '16:00', NOW)).toEqual({
      field: 'day',
      message: 'This day is in the past. Pick today or later.',
    });
  });

  it('blames the time when only the hour has gone', () => {
    /*
     * The fault the owner found: a past time on today produced the *day's*
     * sentence, printed under the *title* field. Two things wrong at once.
     */
    expect(pastProblem(TODAY, '09:30', NOW)).toEqual({
      field: 'time',
      message: 'This time has passed. It is 14:55 now.',
    });
  });

  it('allows later today, and the current minute', () => {
    expect(pastProblem(TODAY, '15:00', NOW)).toBeNull();
    expect(pastProblem(TODAY, '14:55', NOW)).toBeNull();
  });

  it('allows any hour on a later day, including an early one', () => {
    expect(pastProblem('2026-11-12', '07:00', NOW)).toBeNull();
  });

  it('asks for a day before it asks anything else', () => {
    expect(pastProblem('', '09:00', NOW)).toEqual({ field: 'day', message: 'Choose a day.' });
  });

  it('judges the day on its own when there is no time yet', () => {
    expect(pastProblem(TODAY, null, NOW)).toBeNull();
    expect(pastProblem('2026-11-01', null, NOW)?.field).toBe('day');
  });
});

/* ── 4: the next free time, not ten o'clock ─────────────────────────────── */

describe('the time a new plan opens at', () => {
  it('is the next half hour on today, not 10:00', () => {
    expect(nextFreeSlot(TODAY, [], NOW)).toBe('15:00');
  });

  it('steps over what is already there', () => {
    const taken = [plan('a', TODAY, '15:00', 60), plan('b', TODAY, '16:00', 60)];
    expect(nextFreeSlot(TODAY, taken, NOW)).toBe('17:00');
  });

  it('ignores a plan that is already finished', () => {
    const taken = [plan('a', TODAY, '15:00', 60, { done: true })];
    expect(nextFreeSlot(TODAY, taken, NOW)).toBe('15:00');
  });

  it('ignores an all-day plan, which takes no hour', () => {
    const taken = [plan('expo', TODAY, '00:00', 24 * 60, { allDay: true })];
    expect(nextFreeSlot(TODAY, taken, NOW)).toBe('15:00');
  });

  it('starts at 10:00 on another day', () => {
    expect(nextFreeSlot('2026-11-13', [], NOW)).toBe('10:00');
    expect(nextFreeSlot('2026-11-13', [plan('a', '2026-11-13', '10:00', 60)], NOW)).toBe('11:00');
  });

  it('does not run past the evening when the day is full', () => {
    const full = Array.from({ length: 24 }, (_unused, i) =>
      plan(`p${i}`, TODAY, `${String(7 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, 30));
    expect(Number(nextFreeSlot(TODAY, full, NOW).slice(0, 2))).toBeLessThanOrEqual(21);
  });

  it('does not suggest an hour that has already gone, even on an empty day', () => {
    const late = new Date(2026, 10, 11, 19, 10);
    expect(nextFreeSlot(TODAY, [], late)).toBe('19:30');
  });
});

/* ── 6: the clash warning ───────────────────────────────────────────────── */

describe('the clash warning', () => {
  const taken = [plan('viewing', TODAY, '16:30', 60)];

  it('finds a plan that overlaps the new one', () => {
    expect(clashIn(taken, TODAY, '17:00', 60)?.id).toBe('viewing');
  });

  it('finds one the new plan starts before and runs into', () => {
    expect(clashIn(taken, TODAY, '16:00', 60)?.id).toBe('viewing');
  });

  it('is silent when they merely touch', () => {
    expect(clashIn(taken, TODAY, '17:30', 60)).toBeNull();
    expect(clashIn(taken, TODAY, '15:30', 60)).toBeNull();
  });

  it('is silent on another day', () => {
    expect(clashIn(taken, '2026-11-12', '17:00', 60)).toBeNull();
  });

  it('does not count the plan being edited against itself', () => {
    expect(clashIn(taken, TODAY, '16:30', 60, 'viewing')).toBeNull();
  });

  it('does not count a finished plan or an all-day one', () => {
    expect(clashIn([plan('old', TODAY, '16:30', 60, { done: true })], TODAY, '16:30', 60)).toBeNull();
    expect(clashIn([plan('expo', TODAY, '00:00', 1440, { allDay: true })], TODAY, '16:30', 60)).toBeNull();
  });

  it('needs both a day and a time before it says anything', () => {
    expect(clashIn(taken, '', '16:30', 60)).toBeNull();
    expect(clashIn(taken, TODAY, null, 60)).toBeNull();
  });
});

/* ── 3: a cancelled plan is not a plan that went well ───────────────────── */

describe('what a finished plan is called', () => {
  it('gives each result its own word', () => {
    expect(resultChip('showed')?.label).toBe('Showed up');
    expect(resultChip('no_show')?.label).toBe('No-show');
    expect(resultChip('cancelled')?.label).toBe('Cancelled');
    expect(resultChip('booked')?.label).toBe('Booked a unit');
  });

  it('does not dress a cancelled plan up as a good one', () => {
    expect(resultChip('cancelled')?.tone).not.toBe(resultChip('showed')?.tone);
    expect(resultChip('no_show')?.tone).not.toBe(resultChip('showed')?.tone);
  });

  it('says nothing about a plan with no result, or one that only moved', () => {
    expect(resultChip(null)).toBeNull();
    /* A moved plan still has to happen, so the server leaves it unresolved. */
    expect(resultChip('rescheduled')).toBeNull();
  });
});

/* ── the furniture ──────────────────────────────────────────────────────── */

describe('the time list', () => {
  it('runs every quarter hour from 07:00 to 21:00, 24-hour', () => {
    const list = slots();
    expect(list[0]).toBe('07:00');
    expect(list[1]).toBe('07:15');
    expect(list[list.length - 1]).toBe('21:00');
    expect(list).toHaveLength(57);
  });

  it('makes room for a time already in the diary that is off the grid', () => {
    const list = withSlot(slots(), '10:07');
    expect(list).toContain('10:07');
    expect(list.indexOf('10:07')).toBe(list.indexOf('10:00') + 1);
  });

  it('leaves the list alone when the time is already in it', () => {
    expect(withSlot(slots(), '10:00')).toHaveLength(57);
    expect(withSlot(slots(), null)).toHaveLength(57);
  });
});

describe('the busy-day hint', () => {
  it('names the longest gap left', () => {
    const day = [plan('a', TODAY, '15:30', 30), plan('b', TODAY, '16:00', 30)];
    expect(freeGap(day, TODAY, NOW)).toBe('Free from 16:30 to 18:00.');
  });

  it('says so when there is none', () => {
    const day = [plan('a', TODAY, '14:00', 5 * 60)];
    expect(freeGap(day, TODAY, NOW)).toBe('No free time left.');
  });
});

describe('days', () => {
  it('counts forward over a month end', () => {
    expect(addDays('2026-11-30', 2)).toBe('2026-12-02');
  });

  it('reads a day and time as the hour the person standing there means', () => {
    const at = instantOf('2026-11-11', '16:30');
    expect(dayKey(at)).toBe('2026-11-11');
    expect(at.getHours()).toBe(16);
  });
});
