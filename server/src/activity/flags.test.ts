import { describe, expect, it } from 'vitest';
import {
  IMPOSSIBLE_TRAVEL_HOURS, describeLastSeen, flagsFor, isLive, isOddHour, worstLevel,
  type SessionFacts,
} from './flags.js';

/** 09:00 Dubai on a Tuesday. */
const MORNING = new Date('2026-10-27T05:00:00Z');

const base: SessionFacts = {
  userName: 'Layla Hassan',
  deviceKey: 'phone:iPhone:Safari',
  deviceLabel: 'iPhone · Safari',
  network: '94.200.12',
  city: 'Dubai',
  country: 'United Arab Emirates',
  at: MORNING,
  knownDevices: ['phone:iPhone:Safari', 'desktop:Mac:Chrome'],
  knownNetworks: ['94.200.12'],
  knownCountries: ['United Arab Emirates'],
  previous: { at: new Date('2026-10-26T05:00:00Z'), country: 'United Arab Emirates', city: 'Dubai' },
  firstEver: false,
};

describe('an ordinary morning', () => {
  it('says nothing at all', () => {
    /* Ten agents signing in from their phones is Tuesday, not an event. */
    expect(flagsFor(base)).toEqual([]);
  });

  it('says nothing about an evening, because agents work evenings', () => {
    expect(flagsFor({ ...base, at: new Date('2026-10-27T15:30:00Z') })).toEqual([]);
  });
});

describe('a device nobody has seen before', () => {
  it('is worth a look', () => {
    const flags = flagsFor({ ...base, deviceKey: 'desktop:Windows:Edge', deviceLabel: 'Windows · Edge' });
    expect(flags.map((f) => f.key)).toEqual(['new_device']);
    expect(flags[0]?.level).toBe('watch');
    expect(flags[0]?.message).toContain('Windows · Edge');
  });
});

describe('a country nobody has signed in from', () => {
  it('is an alarm, not a note', () => {
    const flags = flagsFor({ ...base, country: 'Philippines', city: 'Manila', knownNetworks: [] });
    const country = flags.find((f) => f.key === 'new_country');
    expect(country?.level).toBe('alarm');
    expect(country?.message).toContain('Philippines');
  });

  it('is not raised on the very first sign-in, where there is nothing to compare', () => {
    expect(flagsFor({ ...base, knownCountries: [], country: 'Philippines' }).map((f) => f.key))
      .not.toContain('new_country');
  });
});

describe('a different internet connection', () => {
  it('is a note, not an alarm — a café or 4G instead of the office', () => {
    const flags = flagsFor({ ...base, network: '5.32.100' });
    const network = flags.find((f) => f.key === 'new_network');
    expect(network?.level).toBe('info');
  });

  it('is not raised as well when the country is already the alarm', () => {
    /* One event, one flag: two rows for the same sign-in reads as two
       problems. */
    const flags = flagsFor({ ...base, country: 'Philippines', city: 'Manila', network: '5.32.100' });
    expect(flags.map((f) => f.key)).toContain('new_country');
    expect(flags.map((f) => f.key)).not.toContain('new_network');
  });
});

describe('the middle of the night', () => {
  it('counts 1am to 5am Dubai, and not the evening', () => {
    expect(isOddHour(new Date('2026-10-27T19:00:00Z'))).toBe(false);  // 23:00 — still working
    expect(isOddHour(new Date('2026-10-26T22:30:00Z'))).toBe(true);   // 02:30 — yes
    expect(isOddHour(new Date('2026-10-27T15:00:00Z'))).toBe(false);  // 19:00 — working
    expect(isOddHour(new Date('2026-10-27T05:00:00Z'))).toBe(false);  // 09:00 — working
  });

  it('is flagged with the Dubai time, not UTC', () => {
    const flags = flagsFor({ ...base, at: new Date('2026-10-26T22:30:00Z') });
    expect(flags.find((f) => f.key === 'odd_hour')?.message).toContain('02:30');
  });
});

describe('two countries too close together to have flown', () => {
  const jump = (hoursApart: number): SessionFacts => ({
    ...base,
    country: 'Philippines',
    city: 'Manila',
    knownCountries: ['United Arab Emirates', 'Philippines'],
    at: new Date(MORNING.getTime() + hoursApart * 3_600_000),
    previous: { at: MORNING, country: 'United Arab Emirates', city: 'Dubai' },
  });

  it('is the one thing worth waking an owner for', () => {
    const flag = flagsFor(jump(0.3)).find((f) => f.key === 'impossible_travel');
    expect(flag?.level).toBe('alarm');
    expect(flag?.message).toContain('may be in use by somebody else');
  });

  it('says less than an hour when it is minutes', () => {
    expect(flagsFor(jump(0.3)).find((f) => f.key === 'impossible_travel')?.message)
      .toContain('less than an hour');
  });

  it('leaves a real flight alone', () => {
    /* Dubai to London is seven hours, and people do fly. */
    expect(flagsFor(jump(IMPOSSIBLE_TRAVEL_HOURS + 2)).map((f) => f.key))
      .not.toContain('impossible_travel');
  });

  it('says nothing when the country is the same', () => {
    expect(flagsFor({ ...base, at: new Date(MORNING.getTime() + 600_000) }).map((f) => f.key))
      .not.toContain('impossible_travel');
  });

  it('says nothing when a country is unknown', () => {
    expect(flagsFor({ ...jump(0.3), country: null }).map((f) => f.key))
      .not.toContain('impossible_travel');
  });
});

describe('the first sign-in on a new account', () => {
  it('is one line, not three alarms for one ordinary event', () => {
    const flags = flagsFor({
      ...base, firstEver: true, knownDevices: [], knownNetworks: [], knownCountries: [],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]?.key).toBe('first_sign_in');
    expect(flags[0]?.level).toBe('info');
  });
});

describe('what colours the row', () => {
  it('takes the worst of them', () => {
    expect(worstLevel([
      { key: 'a', level: 'info', message: '' },
      { key: 'b', level: 'alarm', message: '' },
      { key: 'c', level: 'watch', message: '' },
    ])).toBe('alarm');
    expect(worstLevel([{ key: 'a', level: 'info', message: '' }])).toBe('info');
    expect(worstLevel([])).toBeNull();
  });
});

describe('who is on right now', () => {
  const now = new Date('2026-10-27T05:00:00Z');

  it('counts somebody whose browser beat a moment ago', () => {
    expect(isLive(new Date(now.getTime() - 20_000), now)).toBe(true);
  });

  it('survives one missed beat — a lift, a tunnel', () => {
    expect(isLive(new Date(now.getTime() - 70_000), now)).toBe(true);
  });

  it('does not count a closed laptop', () => {
    expect(isLive(new Date(now.getTime() - 10 * 60_000), now)).toBe(false);
  });

  it('is not confused by a clock slightly ahead', () => {
    expect(isLive(new Date(now.getTime() + 5_000), now)).toBe(false);
  });
});

describe('saying when somebody was last seen', () => {
  const now = new Date('2026-10-27T05:00:00Z');
  const ago = (ms: number) => describeLastSeen(new Date(now.getTime() - ms), now);

  it('reads naturally at every scale', () => {
    expect(ago(10_000)).toBe('Just now');
    expect(ago(4 * 60_000)).toBe('4 min ago');
    expect(ago(3 * 3_600_000)).toBe('3 h ago');
    expect(ago(26 * 3_600_000)).toBe('Yesterday');
    expect(ago(5 * 24 * 3_600_000)).toBe('5 days ago');
  });

  it('never shows a negative time', () => {
    expect(describeLastSeen(new Date(now.getTime() + 60_000), now)).toBe('Just now');
  });
});
