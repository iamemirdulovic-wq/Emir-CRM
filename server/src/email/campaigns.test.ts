import { describe, expect, it } from 'vitest';
import {
  BATCH_SIZE, BOUNCE_PAUSE_MIN_SENT, BOUNCE_PAUSE_RATE, bounceRateTooHigh, estimatedMinutes,
} from './campaigns.js';

describe('pausing a campaign that is bouncing', () => {
  it('does nothing on a handful of sends, where a rate means nothing', () => {
    /* One bounce out of three is 33%, and tells you nothing at all. */
    expect(bounceRateTooHigh(3, 1)).toBe(false);
    expect(bounceRateTooHigh(BOUNCE_PAUSE_MIN_SENT - 1, 10)).toBe(false);
  });

  it('pauses once a real rate is above the line', () => {
    expect(bounceRateTooHigh(100, 5)).toBe(true);
    expect(bounceRateTooHigh(200, 20)).toBe(true);
  });

  it('leaves a healthy campaign alone', () => {
    expect(bounceRateTooHigh(100, 4)).toBe(false);
    expect(bounceRateTooHigh(1000, 10)).toBe(false);
  });

  it('does not divide by zero before anything has been sent', () => {
    expect(bounceRateTooHigh(0, 0)).toBe(false);
    expect(bounceRateTooHigh(0, 5)).toBe(false);
  });

  it('draws the line where mailbox providers do', () => {
    expect(BOUNCE_PAUSE_RATE).toBe(0.05);
  });
});

describe('telling someone how long it will take', () => {
  it('is honest about a big list on a slow throttle', () => {
    /* 5,000 at 200 an hour is a day and a bit, and saying so before the
       send is the point. */
    expect(estimatedMinutes(5_000, 200)).toBe(1_500);
  });

  it('rounds up, because a part hour is still an hour of waiting', () => {
    expect(estimatedMinutes(201, 200)).toBe(61);
  });

  it('says nothing for an empty list', () => {
    expect(estimatedMinutes(0, 200)).toBe(0);
  });

  it('does not divide by zero on a throttle of nothing', () => {
    expect(Number.isFinite(estimatedMinutes(100, 0))).toBe(true);
  });
});

describe('the batch size', () => {
  it('is small enough that a crash loses little and a pause lands quickly', () => {
    expect(BATCH_SIZE).toBeGreaterThan(0);
    expect(BATCH_SIZE).toBeLessThanOrEqual(50);
  });
});
