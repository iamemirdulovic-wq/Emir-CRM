import { describe, expect, it } from 'vitest';
import { clockIn, flagOf, originOf, whenToCall } from './dialling.js';

/**
 * Reading a foreign clock before dialling.
 *
 * This is the card an agent glances at before ringing somebody three time
 * zones away. It was built on 10 Nov after an agent rang Germany at six in
 * the morning, and the thing it must never do is give a time that cannot be
 * acted on.
 */

describe('where a number is from', () => {
  it('reads the country from the dialling code', () => {
    expect(originOf('+971501234567')?.iso2).toBe('AE');
    expect(originOf('+393331234567')?.iso2).toBe('IT');
    expect(originOf('+447911123456')?.iso2).toBe('GB');
  });

  it('says nothing rather than guessing', () => {
    expect(originOf(null)).toBeNull();
    expect(originOf('')).toBeNull();
    expect(originOf('0501234567')).toBeNull();
  });

  it('makes a flag from the country', () => {
    expect(flagOf('AE')).toBe('🇦🇪');
    expect(flagOf('')).toBe('');
  });
});

describe('what time it is there', () => {
  it('is twelve-hour, because the card exists to save a sum', () => {
    const at = new Date('2026-11-12T11:00:00Z'); // 15:00 in Dubai
    expect(clockIn('Asia/Dubai', at)?.time).toBe('3:00 PM');
  });

  it('says how far from Dubai they are', () => {
    const at = new Date('2026-11-12T11:00:00Z');
    expect(clockIn('Asia/Dubai', at)?.offset).toMatch(/same time/i);
    expect(clockIn('Europe/Rome', at)?.offset).toMatch(/behind/i);
  });
});

describe('whether now is a decent hour', () => {
  it('says yes inside working hours', () => {
    const at = new Date('2026-11-12T07:00:00Z'); // 11:00 Dubai
    const advice = whenToCall(clockIn('Asia/Dubai', at), 'Asia/Dubai');
    expect(advice?.ok).toBe(true);
  });

  /*
   * The bug this test exists for: the next-good-hour search stepped forward
   * in whole hours from right now, so at 9:41 PM it reported "call after
   * 9:41 AM" -- a time that means nothing. Seen on the v2 lead page on
   * 12 Nov, and live on crm.homes.me before that.
   */
  it('names a time on the hour, not whatever minute it is now', () => {
    const at = new Date('2026-11-12T17:41:00Z'); // 21:41 Dubai, too late
    const advice = whenToCall(clockIn('Asia/Dubai', at), 'Asia/Dubai');

    expect(advice?.ok).toBe(false);
    expect(advice?.line).toContain('9:00 AM');
    expect(advice?.line, 'never the current minute').not.toContain(':41');
  });

  it('keeps half-hour zones honest', () => {
    /* 09:00 in Mumbai is 07:30 in Dubai. Rounding in the wrong clock would
       say 07:00, and an agent would ring half an hour early. */
    const at = new Date('2026-11-12T17:41:00Z');
    const advice = whenToCall(clockIn('Asia/Kolkata', at), 'Asia/Kolkata');
    expect(advice?.ok).toBe(false);
    expect(advice?.line).toContain(':30');
  });

  it('tells an agent it is too early, not just too late', () => {
    const at = new Date('2026-11-12T02:30:00Z'); // 06:30 Dubai
    const advice = whenToCall(clockIn('Asia/Dubai', at), 'Asia/Dubai');
    expect(advice?.line).toMatch(/too early/i);
  });
});
