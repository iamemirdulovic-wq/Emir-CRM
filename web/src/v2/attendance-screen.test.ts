import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  answerList, askedDays, askedWhen, backFrom, closedNames, dayOfWeek, lastOf, lateWarning,
  cellWord, minutesLate, nextOpenDay, openDays, overlapping, sentence, startOn, weekNumber,
  workedSince, workingDays,
  type DayState, type Leave, type Mark, type Mine, type Shift,
} from './Attendance.js';

/**
 * The rules `design/web/attendance.html` checks, and the facts its tiles name.
 *
 * Every one of these was missing from the build on 13 Nov: the audit
 * (`docs/v2/audit-3.md` §25) lists them. They are all arithmetic over dates
 * and over the days the office is shut, which is exactly the kind of thing
 * that looks right on screen in the week somebody writes it and is wrong the
 * first time a month starts on a Sunday.
 */

const SHIFT: Shift = {
  start: '09:00', end: '18:00', satStart: '11:00', satEnd: '15:00',
  /* Saturday and Sunday shut, as the design's own demo has it. */
  closedDays: [0, 6], graceMinutes: 10,
};

function leave(one: Partial<Leave>): Leave {
  return {
    id: 'lv-1', userId: 'u-1', kind: 'annual', fromDate: '2026-11-18', toDate: '2026-11-20',
    workingDays: 3, reason: null, status: 'pending', decisionNote: null, ...one,
  };
}

describe('which days the office is open', () => {
  it('names the open days as a run, the way a person says it', () => {
    expect(openDays([0, 6])).toBe('Monday to Friday');
    expect(openDays([0])).toBe('Monday to Saturday');
  });

  it('falls back to a list when the open days are not a run', () => {
    expect(openDays([0, 2, 4])).toBe('Mon, Wed, Fri, Sat');
  });

  it('names the closed days for the line under the dates', () => {
    expect(closedNames([0, 6])).toBe('Saturday and Sunday');
    expect(closedNames([0])).toBe('Sunday');
    expect(closedNames([])).toBe('No days');
  });

  it('knows which day of the week a date is, in the stored numbering', () => {
    /* 14 Nov 2026 is a Saturday. */
    expect(dayOfWeek('2026-11-14')).toBe(6);
    expect(dayOfWeek('2026-11-13')).toBe(5);
  });

  it('starts a leave request on the next day the office is open', () => {
    /* Friday the 13th: tomorrow is Saturday, so the form opens on Monday. */
    expect(nextOpenDay('2026-11-13', [0, 6])).toBe('2026-11-16');
    /* A Saturday office opens the form on Saturday. */
    expect(nextOpenDay('2026-11-13', [0])).toBe('2026-11-14');
  });

  it('says when the shift starts on a date, and nothing on a closed day', () => {
    expect(startOn('2026-11-13', SHIFT)).toBe('09:00');
    expect(startOn('2026-11-14', SHIFT)).toBe(null);
    /* Saturday has its own start where the office opens on one. */
    expect(startOn('2026-11-14', { ...SHIFT, closedDays: [0] })).toBe('11:00');
  });
});

describe('counting the days a leave request costs', () => {
  it('counts only the days the office is open, as the server does', () => {
    /* Wed 18 to Fri 20 November: three working days. */
    expect(workingDays('2026-11-18', '2026-11-20', [0, 6])).toBe(3);
    /* Fri 20 to Mon 23: the weekend is not counted. */
    expect(workingDays('2026-11-20', '2026-11-23', [0, 6])).toBe(2);
    /* The same range in an office that opens on Saturday. */
    expect(workingDays('2026-11-20', '2026-11-23', [0])).toBe(3);
  });

  it('counts one day for a single day', () => {
    expect(workingDays('2026-11-18', '2026-11-18', [0, 6])).toBe(1);
  });

  it('finds a request already waiting over the same days', () => {
    const waiting = [leave({ fromDate: '2026-11-18', toDate: '2026-11-20' })];
    /* Right across it, overlapping the end, and touching the first day. */
    expect(overlapping(waiting, '2026-11-19', '2026-11-19')).not.toBe(null);
    expect(overlapping(waiting, '2026-11-20', '2026-11-25')).not.toBe(null);
    expect(overlapping(waiting, '2026-11-16', '2026-11-18')).not.toBe(null);
    /* And leaves other days alone. */
    expect(overlapping(waiting, '2026-11-21', '2026-11-25')).toBe(null);
  });

  it('adds up the days already asked for, for the tile', () => {
    expect(askedDays([leave({ workingDays: 3 }), leave({ id: 'lv-2', workingDays: 2 })])).toBe(5);
    expect(askedDays([])).toBe(0);
  });

  it('finds the last sick day that was approved', () => {
    const rows = [
      leave({ id: 'a', kind: 'sick', status: 'approved', fromDate: '2026-10-14', toDate: '2026-10-14' }),
      leave({ id: 'b', kind: 'sick', status: 'approved', fromDate: '2026-06-02', toDate: '2026-06-03' }),
      /* A sick day that was refused is not a sick day taken. */
      leave({ id: 'c', kind: 'sick', status: 'refused', fromDate: '2026-11-01', toDate: '2026-11-01' }),
    ];
    expect(lastOf(rows, 'sick')?.id).toBe('a');
    expect(lastOf(rows, 'annual')).toBe(null);
  });
});

describe('the words the screen uses', () => {
  it('names the people who answer a leave request', () => {
    expect(answerList(['Emir', 'George'])).toBe('Emir or George');
    expect(answerList(['Emir'])).toBe('Emir');
    expect(answerList(['Emir', 'George', 'Abdullah'])).toBe('Emir, George or Abdullah');
    /* Never a name nobody set, and lower case: it is read inside a
       sentence — "waiting for an owner". */
    expect(answerList([])).toBe('an owner');
    expect(answerList(undefined)).toBe('an owner');
    expect(sentence(answerList([]))).toBe('An owner');
  });

  it('reads the "back by" out of the line the agent wrote on the way out', () => {
    expect(backFrom('Site visit · Valia · with Omar K. · back by 16:30')).toBe('16:30');
    expect(backFrom('Site visit · Valia')).toBe(null);
    expect(backFrom(null)).toBe(null);
  });

  it('warns that a check-in now would count as late', () => {
    const day = { lateAfter: '09:10' } as DayState;
    const warning = lateWarning(day);
    /* Either sentence is the design's; which one depends on the hour this
       test runs at, and both have to name the time. */
    expect(warning).toMatch(/counts as late|after 09:10 counts as late/);
    expect(lateWarning({ lateAfter: null } as DayState)).toBe('');
  });

  it('writes the time a request was asked in 24 hours, in Dubai', () => {
    /* 09:07 UTC is 13:07 in Dubai, and never "1:07 PM". */
    expect(askedWhen('2026-11-02T09:07:00.000Z')).toBe('2 Nov 13:07');
  });
});

describe('how late a check-in was', () => {
  it('counts the minutes past the start of that day\'s shift', () => {
    /* 09:18 Dubai is 05:18 UTC. */
    expect(minutesLate(
      { on_date: '2026-11-04', marked_at: '2026-11-04T05:18:00.000Z', was_late: 1 },
      SHIFT,
    )).toBe(18);
  });

  it('says nothing for a day that was not late', () => {
    expect(minutesLate(
      { on_date: '2026-11-04', marked_at: '2026-11-04T04:50:00.000Z', was_late: 0 },
      SHIFT,
    )).toBe(null);
  });

  it('says nothing when there is no time to count from', () => {
    expect(minutesLate({ on_date: '2026-11-04', marked_at: null, was_late: 1 }, SHIFT)).toBe(null);
  });
});

describe('the hero and the month cells once a day is marked', () => {
  /* The three states the preview cannot be walked into: a day that has been
     marked. Both of these are read straight off the stored time. */
  it('counts the hours since the morning\'s tap', () => {
    const twoAndAHalf = new Date(Date.now() - (150 * 60_000)).toISOString();
    expect(workedSince(twoAndAHalf)).toBe('2 h 30 min');
    /* A tap in the future — a clock that disagrees with the server — reads
       as nothing worked, never as a negative. */
    expect(workedSince(new Date(Date.now() + 60_000).toISOString())).toBe('0 h 00 min');
    expect(workedSince(null)).toBe('—');
  });

  it('writes the design\'s month cell for each kind of day', () => {
    const mine = {
      today: { markedAt: null } as DayState,
      days: [
        { on_date: '2026-11-04', kind: 'office', marked_at: '2026-11-04T05:18:00.000Z', was_late: 1, note: null },
        { on_date: '2026-11-05', kind: 'office', marked_at: '2026-11-05T04:50:00.000Z', was_late: 0, note: null },
        { on_date: '2026-11-06', kind: 'outside', marked_at: '2026-11-06T05:30:00.000Z', was_late: 0, note: 'Site visit' },
      ],
    } as unknown as Mine;

    expect(cellWord(mine, '2026-11-04', 'late' as Mark, false)).toBe('Late 09:18');
    expect(cellWord(mine, '2026-11-05', 'ok' as Mark, false)).toBe('08:50');
    expect(cellWord(mine, '2026-11-06', 'out' as Mark, false)).toBe('Outside 09:30');
    /* A day the office was shut, and one still to come, say nothing. */
    expect(cellWord(mine, '2026-11-07', 'none' as Mark, true)).toBe('');
    expect(cellWord(mine, '2026-11-20', 'future' as Mark, false)).toBe('');
  });
});

describe('the week number the card shows', () => {
  it('is the ISO week', () => {
    /* 13 Nov 2026 is in ISO week 46, which is what the design writes. */
    expect(weekNumber('2026-11-13')).toBe(46);
    expect(weekNumber('2026-01-01')).toBe(1);
    /* 4 Jan is always in week 1, whatever day it falls on. */
    expect(weekNumber('2026-01-04')).toBe(1);
    expect(weekNumber('2026-01-05')).toBe(2);
  });
});

/* ── the markup the audit found missing ────────────────────────────────── */

const SOURCE = readFileSync(
  path.join(path.dirname(new URL(import.meta.url).pathname), 'Attendance.tsx'),
  'utf8',
);

describe('the blocks `attendance.html` draws', () => {
  it('throws confetti on a check-in, as the design does', () => {
    expect(SOURCE).toContain('celebrate()');
  });

  it('keeps the design\'s four tiles, each reaching its tab', () => {
    expect(SOURCE).toContain("onGoto={() => onGoto('month')}");
    expect(SOURCE).toContain("onGoto={() => onGoto('leave')}");
  });

  it('asks twice before a leave request is cancelled, and offers the way back', () => {
    expect(SOURCE).toContain('Tap again to cancel');
    expect(SOURCE).toContain("label: 'Undo'");
  });

  it('asks for "Back by" before it will send somebody outside', () => {
    expect(SOURCE).toContain('Choose when you are back.');
    expect(SOURCE).toContain('Start working outside');
  });

  it('never invents an allowance it has not been given', () => {
    /* "Annual leave left" is the design's label for a number no table in
       this CRM holds. Anything that claims days are *left* is a promise
       somebody books a holiday on. The comments quote the design, so they
       come out before the screen's own words are read. */
    const words = SOURCE
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(words).not.toContain('annual days left');
    expect(words).not.toContain('Annual leave left');
    /* And what it says instead is what it counts. */
    expect(words).toContain('annual days taken');
  });
});
