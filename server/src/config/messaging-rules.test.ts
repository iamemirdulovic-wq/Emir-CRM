import { describe, expect, it } from 'vitest';
import {
  describeQuiet, hoursUntilOpen, inQuietWindow, isCustomised, MAX_BOT_PAUSE_HOURS,
  MAX_PER_24H_CEILING, MESSAGING_DEFAULTS, MIN_BOT_PAUSE_HOURS, MIN_QUIET_HOURS, rulesFrom,
} from './messaging-rules.js';
import { MAX_AUTOMATED_MESSAGES_PER_24H, QUIET_HOURS } from './constants.js';

describe('rulesFrom — the defaults the master prompt fixes', () => {
  it('uses them when nothing is saved', () => {
    expect(rulesFrom({})).toEqual(MESSAGING_DEFAULTS);
    expect(MESSAGING_DEFAULTS.quietStartHour).toBe(QUIET_HOURS.startHour);
    expect(MESSAGING_DEFAULTS.quietEndHour).toBe(QUIET_HOURS.endHour);
    expect(MESSAGING_DEFAULTS.maxPer24h).toBe(MAX_AUTOMATED_MESSAGES_PER_24H);
  });

  it('uses them for anything unreadable', () => {
    expect(rulesFrom({ quietStart: 'ten', quietEnd: '', maxPer24h: 'lots', botPauseHours: null })).toEqual(
      MESSAGING_DEFAULTS,
    );
  });

  it('takes what is saved', () => {
    const rules = rulesFrom({ quietStart: '21', quietEnd: '9', maxPer24h: '2', botPauseHours: '48' });
    expect(rules.quietStartHour).toBe(21);
    expect(rules.quietEndHour).toBe(9);
    expect(rules.maxPer24h).toBe(2);
    expect(rules.botPauseMs).toBe(48 * 3_600_000);
  });
});

describe('rulesFrom — what cannot be typed away', () => {
  it('never lets more than the ceiling through', () => {
    expect(rulesFrom({ maxPer24h: '99' }).maxPer24h).toBe(MAX_PER_24H_CEILING);
    expect(rulesFrom({ maxPer24h: '0' }).maxPer24h).toBe(1);
    expect(rulesFrom({ maxPer24h: '-5' }).maxPer24h).toBe(1);
  });

  it('never lets the night be made shorter than four hours', () => {
    const rules = rulesFrom({ quietStart: '23', quietEnd: '0' });
    expect((rules.quietEndHour - rules.quietStartHour + 24) % 24).toBe(MIN_QUIET_HOURS);
  });

  it('refuses to let the quiet window be switched off entirely', () => {
    const rules = rulesFrom({ quietStart: '22', quietEnd: '22' });
    expect((rules.quietEndHour - rules.quietStartHour + 24) % 24).toBe(MIN_QUIET_HOURS);
  });

  it('keeps the bot pause inside its range', () => {
    expect(rulesFrom({ botPauseHours: '999' }).botPauseMs).toBe(MAX_BOT_PAUSE_HOURS * 3_600_000);
    expect(rulesFrom({ botPauseHours: '0' }).botPauseMs).toBe(MIN_BOT_PAUSE_HOURS * 3_600_000);
  });

  it('ignores an hour outside the clock', () => {
    expect(rulesFrom({ quietStart: '25' }).quietStartHour).toBe(MESSAGING_DEFAULTS.quietStartHour);
    expect(rulesFrom({ quietStart: '-1' }).quietStartHour).toBe(MESSAGING_DEFAULTS.quietStartHour);
  });

  it('accepts a longer night without complaint', () => {
    const rules = rulesFrom({ quietStart: '20', quietEnd: '10' });
    expect(rules.quietStartHour).toBe(20);
    expect(rules.quietEndHour).toBe(10);
  });
});

describe('inQuietWindow', () => {
  const rules = MESSAGING_DEFAULTS;

  it('covers the night, which wraps midnight', () => {
    expect(inQuietWindow(23, rules)).toBe(true);
    expect(inQuietWindow(2, rules)).toBe(true);
    expect(inQuietWindow(7, rules)).toBe(true);
  });

  it('is open during the day', () => {
    expect(inQuietWindow(8, rules)).toBe(false);
    expect(inQuietWindow(14, rules)).toBe(false);
    expect(inQuietWindow(21, rules)).toBe(false);
  });

  it('includes the start hour and excludes the end hour', () => {
    expect(inQuietWindow(22, rules)).toBe(true);
    expect(inQuietWindow(8, rules)).toBe(false);
  });

  it('handles a window that does not wrap', () => {
    const daytime = rulesFrom({ quietStart: '1', quietEnd: '6' });
    expect(inQuietWindow(3, daytime)).toBe(true);
    expect(inQuietWindow(23, daytime)).toBe(false);
  });
});

describe('hoursUntilOpen', () => {
  it('is nothing when it is already open', () => {
    expect(hoursUntilOpen(10, MESSAGING_DEFAULTS)).toBe(0);
  });

  it('counts forward to the end of the night', () => {
    expect(hoursUntilOpen(23, MESSAGING_DEFAULTS)).toBe(9);
    expect(hoursUntilOpen(2, MESSAGING_DEFAULTS)).toBe(6);
    expect(hoursUntilOpen(22, MESSAGING_DEFAULTS)).toBe(10);
  });

  it('never answers zero from inside the window', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      if (inQuietWindow(hour, MESSAGING_DEFAULTS)) {
        expect(hoursUntilOpen(hour, MESSAGING_DEFAULTS)).toBeGreaterThan(0);
      }
    }
  });
});

describe('describeQuiet', () => {
  it('reads as a sentence', () => {
    expect(describeQuiet(MESSAGING_DEFAULTS)).toBe('22:00 to 08:00 — 10 hours');
  });

  it('pads a single-digit hour', () => {
    expect(describeQuiet(rulesFrom({ quietStart: '21', quietEnd: '9' }))).toBe('21:00 to 09:00 — 12 hours');
  });
});

describe('isCustomised', () => {
  it('is false for the defaults', () => {
    expect(isCustomised(MESSAGING_DEFAULTS)).toBe(false);
    expect(isCustomised(rulesFrom({}))).toBe(false);
  });

  it('is true the moment anything moves', () => {
    expect(isCustomised(rulesFrom({ quietStart: '21' }))).toBe(true);
    expect(isCustomised(rulesFrom({ maxPer24h: '2' }))).toBe(true);
    expect(isCustomised(rulesFrom({ botPauseHours: '48' }))).toBe(true);
  });
});
