import { describe, expect, it } from 'vitest';
import { isQuietHours, nextAllowedSendTime, dubaiParts } from './time.js';

/** Asia/Dubai is UTC+4 year round (no DST). */
const dubai = (isoLocal: string) => new Date(`${isoLocal}+04:00`);

describe('quiet hours (22:00–08:00 Asia/Dubai)', () => {
  it('is quiet late at night and early morning', () => {
    expect(isQuietHours(dubai('2026-03-10T22:00:00'))).toBe(true);
    expect(isQuietHours(dubai('2026-03-10T23:59:00'))).toBe(true);
    expect(isQuietHours(dubai('2026-03-11T00:30:00'))).toBe(true);
    expect(isQuietHours(dubai('2026-03-11T07:59:00'))).toBe(true);
  });

  it('is open during business hours', () => {
    expect(isQuietHours(dubai('2026-03-11T08:00:00'))).toBe(false);
    expect(isQuietHours(dubai('2026-03-11T13:00:00'))).toBe(false);
    expect(isQuietHours(dubai('2026-03-11T21:59:00'))).toBe(false);
  });

  it('reads the Dubai wall clock, not UTC', () => {
    // 21:00 UTC is 01:00 the next day in Dubai → quiet.
    expect(isQuietHours(new Date('2026-03-10T21:00:00Z'))).toBe(true);
    expect(dubaiParts(new Date('2026-03-10T21:00:00Z')).hour).toBe(1);
  });
});

describe('nextAllowedSendTime', () => {
  it('passes through when already allowed', () => {
    const t = dubai('2026-03-11T13:00:00');
    expect(nextAllowedSendTime(t).getTime()).toBe(t.getTime());
  });

  it('moves a 23:30 send to 08:00 the next morning', () => {
    const next = nextAllowedSendTime(dubai('2026-03-10T23:30:00'));
    expect(dubaiParts(next).hour).toBe(8);
    expect(isQuietHours(next)).toBe(false);
    expect(next.getTime()).toBeGreaterThan(dubai('2026-03-10T23:30:00').getTime());
  });

  it('moves a 03:00 send to 08:00 the same morning', () => {
    const next = nextAllowedSendTime(dubai('2026-03-11T03:00:00'));
    expect(dubaiParts(next).hour).toBe(8);
    expect(dubaiParts(next).day).toBe(11);
  });
});
