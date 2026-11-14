import { describe, expect, it } from 'vitest';
import {
  CALL_TRIES_DEFAULTS, DIALLER_RESULTS, EVENING_MINUTE, MORNING_MINUTE, TRY_STEPS,
  dubaiClock, dubaiWhen, fitToHours, missedCallMessage, nextTryFor, noAnswerOf,
  savedWords, stepInstant,
} from './call-results.js';
import { CALL_FROM, CALL_UNTIL, hourIn } from '../leads/countries.js';
import { WORK_END_MINUTE, WORK_START_MINUTE } from '../leads/next-step.js';
import { dubaiMinuteOfDay } from '../routing/hours.js';

/**
 * The no-answer ladder, settled here rather than argued about from a
 * screenshot.
 *
 * Every one of these is a sentence from Emir's section A turned into a number:
 * try 2 after two hours, try 3 next morning, try 4 next evening, try 5 two
 * days later, a busy line after thirty minutes, and never a time when the
 * client is asleep or the office is shut.
 */

/** A real instant from a Dubai wall-clock time. Dubai is UTC+4 all year. */
function dubai(day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 10, day, hour - 4, minute, 0, 0));
}

function dubaiHour(at: Date): number {
  return Math.floor(dubaiMinuteOfDay(at) / 60);
}

describe('where each rung of the ladder lands', () => {
  it('two hours means two hours', () => {
    const at = stepInstant('2h', dubai(16, 10, 20));
    expect(at.getTime() - dubai(16, 10, 20).getTime()).toBe(2 * 60 * 60 * 1000);
    expect(dubaiClock(at)).toBe('12:20');
  });

  it('next morning is tomorrow at 11:00 when the morning has gone', () => {
    /* A.3's own example: "next try tomorrow 11:00". */
    const at = stepInstant('next_morning', dubai(16, 14, 0));
    expect(dubaiClock(at)).toBe('11:00');
    expect(dubaiWhen(at, dubai(16, 14, 0))).toBe('tomorrow 11:00');
  });

  it('next morning is today when it has not happened yet', () => {
    const at = stepInstant('next_morning', dubai(16, 9, 45));
    expect(dubaiWhen(at, dubai(16, 9, 45))).toBe('today 11:00');
    expect(dubaiMinuteOfDay(at)).toBe(MORNING_MINUTE);
  });

  it('next evening is the same day when the evening is still ahead', () => {
    const at = stepInstant('next_evening', dubai(16, 11, 0));
    expect(dubaiWhen(at, dubai(16, 11, 0))).toBe('today 17:00');
    expect(dubaiMinuteOfDay(at)).toBe(EVENING_MINUTE);
  });

  it('a wait of days lands in the morning, not at the hour of the tap', () => {
    const at = stepInstant('2d', dubai(16, 19, 10));
    expect(dubaiWhen(at, dubai(16, 19, 10))).toBe('Wed 18 Nov 11:00');
  });

  it('has a label and a landing for every rung the owner can pick', () => {
    for (const step of TRY_STEPS) {
      const at = stepInstant(step, dubai(16, 10, 0));
      expect(at.getTime(), step).toBeGreaterThan(dubai(16, 10, 0).getTime());
    }
  });
});

describe('the hours a follow-up may land in', () => {
  it('waits for the office when the time is before we open', () => {
    const at = fitToHours(dubai(16, 6, 0), 'Asia/Dubai');
    expect(at).not.toBeNull();
    expect(dubaiMinuteOfDay(at as Date)).toBe(WORK_START_MINUTE);
  });

  it('moves to the next morning when the office has shut', () => {
    const at = fitToHours(dubai(16, 22, 30), 'Asia/Dubai');
    expect(at).not.toBeNull();
    expect(dubaiMinuteOfDay(at as Date)).toBe(WORK_START_MINUTE);
    expect(dubaiWhen(at as Date, dubai(16, 22, 30))).toBe('tomorrow 09:30');
  });

  it('leaves a time alone when both clocks are happy with it', () => {
    const want = dubai(16, 11, 0);
    expect(fitToHours(want, 'Asia/Dubai')?.getTime()).toBe(want.getTime());
  });

  it('will not ring a London client at 11:00 Dubai, which is 07:00 there', () => {
    const at = fitToHours(dubai(16, 11, 0), 'Europe/London');
    expect(at).not.toBeNull();
    /* 09:00 in London is 13:00 in Dubai in November. */
    expect(hourIn('Europe/London', at as Date)).toBe(CALL_FROM);
    expect(dubaiClock(at as Date)).toBe('13:00');
  });

  it('accepts a time we cannot read a zone for, rather than refusing to plan', () => {
    const want = dubai(16, 11, 0);
    expect(fitToHours(want, null)?.getTime()).toBe(want.getTime());
  });
});

describe('the next try, for every result', () => {
  const settings = CALL_TRIES_DEFAULTS;
  const zone = 'Asia/Dubai';

  it('try 1 promises try 2 in two hours', () => {
    const { at, step } = nextTryFor('no_answer', 1, settings, zone, dubai(16, 10, 0));
    expect(step).toBe('2h');
    expect(dubaiWhen(at as Date, dubai(16, 10, 0))).toBe('today 12:00');
  });

  it('try 2 promises try 3 next morning', () => {
    const { at, step } = nextTryFor('no_answer', 2, settings, zone, dubai(16, 12, 0));
    expect(step).toBe('next_morning');
    expect(dubaiWhen(at as Date, dubai(16, 12, 0))).toBe('tomorrow 11:00');
  });

  it('try 3 promises try 4 the same evening', () => {
    const { at, step } = nextTryFor('no_answer', 3, settings, zone, dubai(17, 11, 0));
    expect(step).toBe('next_evening');
    expect(dubaiWhen(at as Date, dubai(17, 11, 0))).toBe('today 17:00');
  });

  it('try 4 promises try 5 two days later', () => {
    const { at, step } = nextTryFor('no_answer', 4, settings, zone, dubai(17, 17, 0));
    expect(step).toBe('2d');
    expect(dubaiWhen(at as Date, dubai(17, 17, 0))).toBe('Thu 19 Nov 11:00');
  });

  it('promises nothing after the last try — a person decides (A.5)', () => {
    expect(nextTryFor('no_answer', 5, settings, zone, dubai(17, 11, 0)).at).toBeNull();
    expect(nextTryFor('no_answer', 9, settings, zone, dubai(17, 11, 0)).at).toBeNull();
  });

  it('a busy line is half an hour and never takes a rung of the ladder', () => {
    for (const tries of [1, 2, 3, 4]) {
      const { at, step } = nextTryFor('busy', tries, settings, zone, dubai(16, 10, 0));
      expect(step, `try ${tries}`).toBeNull();
      expect(dubaiWhen(at as Date, dubai(16, 10, 0)), `try ${tries}`).toBe('today 10:30');
    }
  });

  it('a busy line on the last try still stops, like a no-answer', () => {
    expect(nextTryFor('busy', 5, settings, zone, dubai(16, 10, 0)).at).toBeNull();
  });

  it('plans nothing for the four results that end the run', () => {
    for (const result of ['answered', 'call_back', 'wrong_number', 'not_interested'] as const) {
      expect(nextTryFor(result, 0, settings, zone, dubai(16, 10, 0)).at, result).toBeNull();
    }
  });

  it('honours an owner who shortens the ladder', () => {
    const short = { max: 2, steps: ['30m' as const], busyMinutes: 10 };
    const first = nextTryFor('no_answer', 1, short, zone, dubai(16, 10, 0));
    expect(dubaiWhen(first.at as Date, dubai(16, 10, 0))).toBe('today 10:30');
    /* Two tries is the lot. */
    expect(nextTryFor('no_answer', 2, short, zone, dubai(16, 10, 0)).at).toBeNull();
    expect(dubaiWhen(
      nextTryFor('busy', 1, short, zone, dubai(16, 10, 0)).at as Date, dubai(16, 10, 0),
    )).toBe('today 10:10');
  });

  /*
   * The rule that matters most, swept rather than sampled: whatever hour the
   * agent taps the button, and wherever the client is, the time that comes
   * back is inside our working hours AND inside their waking hours.
   */
  it('never lands while the client is asleep or the office is shut', () => {
    const zones = ['Asia/Dubai', 'Europe/London', 'Asia/Kolkata', 'America/New_York', 'Australia/Sydney'];
    for (const where of zones) {
      for (let hour = 0; hour < 24; hour += 1) {
        for (const tries of [1, 2, 3, 4]) {
          for (const result of ['no_answer', 'busy'] as const) {
            const now = dubai(16, hour, 7);
            const { at } = nextTryFor(result, tries, settings, where, now);
            const what = `${where} ${hour}:07 try ${tries} ${result}`;
            expect(at, what).not.toBeNull();
            const when = at as Date;
            expect(when.getTime(), what).toBeGreaterThan(now.getTime());
            const minute = dubaiMinuteOfDay(when);
            expect(minute >= WORK_START_MINUTE, `${what} — our hours, got ${dubaiClock(when)}`).toBe(true);
            expect(minute < WORK_END_MINUTE, `${what} — our hours, got ${dubaiClock(when)}`).toBe(true);
            const theirs = hourIn(where, when) as number;
            expect(theirs >= CALL_FROM && theirs < CALL_UNTIL, `${what} — their hours, got ${theirs}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('the field every lead row carries', () => {
  it('is nothing at all for a lead nobody has rung without an answer', () => {
    expect(noAnswerOf({ no_answer_count: 0, next_step_at: new Date() })).toBeNull();
    expect(noAnswerOf({})).toBeNull();
  });

  it('carries the count, the last try and the next one', () => {
    const last = dubai(16, 10, 0);
    const next = dubai(16, 12, 0);
    expect(noAnswerOf({ no_answer_count: 2, last_try_at: last, next_step_at: next })).toEqual({
      tries: 2,
      lastTryAt: last.toISOString(),
      nextTryAt: next.toISOString(),
    });
  });

  it('says nothing rather than guessing when a lead has run out of tries', () => {
    expect(noAnswerOf({ no_answer_count: 5, last_try_at: null, next_step_at: null })).toEqual({
      tries: 5, lastTryAt: null, nextTryAt: null,
    });
  });
});

describe('the "I tried to call you" message', () => {
  it('is in the client’s own language and names the project', async () => {
    const message = await missedCallMessage({
      fullName: 'Marco Bellini', language: 'en', project: 'Sei Saadiyat', agentName: 'Layla Hassan',
    });
    expect(message.lang).toBe('en');
    expect(message.langName).toBe('English');
    expect(message.text).toContain('Marco');
    expect(message.text).toContain('Layla Hassan');
    expect(message.text).toContain('Sei Saadiyat');
  });

  it('leaves the project out rather than inventing one', async () => {
    const message = await missedCallMessage({
      fullName: null, language: 'en', project: null, agentName: 'Layla Hassan',
    });
    expect(message.text).not.toContain('undefined');
    expect(message.text).not.toContain('null');
    expect(message.text).toContain('I just tried to call you');
  });

  it('writes Arabic for an Arabic-speaking client', async () => {
    const message = await missedCallMessage({
      fullName: 'سارة', language: 'ar', project: 'Sei Saadiyat', agentName: 'Layla',
    });
    expect(message.lang).toBe('ar');
    expect(message.langName).toBe('Arabic');
    expect(message.text).toContain('حاولت الاتصال بك');
  });

  it('falls back to English for a language we have no words for', async () => {
    const message = await missedCallMessage({
      fullName: 'Jan', language: 'nl', project: null, agentName: 'Layla',
    });
    expect(message.lang).toBe('en');
  });

  /* E.1: no emoji anywhere. A line icon is a line icon; a smiley is not. */
  it('carries no emoji, in any language', async () => {
    for (const language of ['en', 'ar', 'ru', 'hi']) {
      const message = await missedCallMessage({
        fullName: 'Marco', language, project: 'Sei Saadiyat', agentName: 'Layla',
      });
      expect(/\p{Extended_Pictographic}/u.test(message.text), language).toBe(false);
    }
  });
});

describe('what the toast says', () => {
  const state = (over: Partial<Parameters<typeof savedWords>[1]> = {}) => ({
    tries: 0, maxTries: 5, lastTryAt: null, nextTryAt: null, exhausted: false,
    whatsapp: null, line: null, undoUntil: null, ...over,
  });

  it('carries the ladder when a try was counted', () => {
    const said = savedWords('no_answer', state({
      tries: 2, line: 'Try 2 of 5 · next try tomorrow 11:00',
    }));
    expect(said).toBe('No answer · try 2 of 5 · next try tomorrow 11:00');
  });

  it('says what happened for the results that end the run', () => {
    expect(savedWords('interested', state())).toBe('Moved to Interested');
    expect(savedWords('call_back', state())).toBe('Call back set');
    expect(savedWords('not_interested', state())).toBe('Marked Lost');
    expect(savedWords('wrong_number', state())).toBe('Flagged as a wrong number');
    expect(savedWords('answered', state())).toBe('Call logged');
  });

  it('never shows a raw value and never an emoji', () => {
    for (const result of DIALLER_RESULTS) {
      const said = savedWords(result, state({ tries: 1, line: 'Try 1 of 5 · next try today 12:00' }));
      expect(said, result).not.toContain('_');
      expect(/\p{Extended_Pictographic}/u.test(said), result).toBe(false);
    }
  });
});

describe('the clock', () => {
  it('is 24-hour, Dubai, like every other time in the CRM', () => {
    expect(dubaiClock(dubai(16, 17, 5))).toBe('17:05');
    expect(dubaiClock(dubai(16, 9, 30))).toBe('09:30');
    expect(dubaiWhen(dubai(16, 17, 5), dubai(16, 9, 0))).toBe('today 17:05');
  });
});
