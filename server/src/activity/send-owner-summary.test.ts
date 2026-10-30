import { describe, expect, it } from 'vitest';
import { yesterdayInDubai, yesterdayWindow } from './send-owner-summary.js';

describe('what "yesterday" means to an owner in Dubai', () => {
  it('is the Dubai day, not the UTC one', () => {
    /* 09:00 Dubai on the 30th is 05:00 UTC on the 30th; yesterday is the
       29th either way. */
    expect(yesterdayInDubai(new Date('2026-10-30T05:00:00Z'))).toBe('2026-10-29');
  });

  it('does not roll over early just because UTC has', () => {
    /* 02:00 UTC on the 30th is still 06:00 Dubai on the 30th. */
    expect(yesterdayInDubai(new Date('2026-10-30T02:00:00Z'))).toBe('2026-10-29');
  });

  it('rolls over when Dubai does, four hours before UTC', () => {
    /* 20:30 UTC on the 29th is already 00:30 on the 30th in Dubai. */
    expect(yesterdayInDubai(new Date('2026-10-29T20:30:00Z'))).toBe('2026-10-29');
    expect(yesterdayInDubai(new Date('2026-10-29T19:30:00Z'))).toBe('2026-10-28');
  });
});

describe('the window the numbers are counted over', () => {
  const { from, to } = yesterdayWindow(new Date('2026-10-30T05:00:00Z'));

  it('runs from midnight to midnight, Dubai time', () => {
    /* Midnight in Dubai is 20:00 UTC the evening before. */
    expect(from.toISOString()).toBe('2026-10-28T20:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-29T20:00:00.000Z');
  });

  it('is exactly one day long', () => {
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('puts an evening’s work in the right day', () => {
    /* 21:00 Dubai on the 29th is 17:00 UTC on the 29th, and belongs to the
       29th — which is most of an agent's evening in this business. */
    const evening = new Date('2026-10-29T17:00:00Z');
    expect(evening >= from && evening < to).toBe(true);
  });

  it('excludes this morning', () => {
    const thisMorning = new Date('2026-10-30T04:00:00Z');
    expect(thisMorning >= to).toBe(true);
  });

  it('moves with the clock rather than being fixed', () => {
    const later = yesterdayWindow(new Date('2026-10-31T05:00:00Z'));
    expect(later.from.getTime()).toBe(from.getTime() + 24 * 60 * 60 * 1000);
  });
});
