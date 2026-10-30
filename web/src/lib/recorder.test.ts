import { describe, expect, it } from 'vitest';
import { formatDuration } from './recorder.js';

describe('showing how long a recording is', () => {
  it('reads as minutes and seconds', () => {
    expect(formatDuration(7)).toBe('0:07');
    expect(formatDuration(64)).toBe('1:04');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('pads the seconds, so 1:4 never appears', () => {
    expect(formatDuration(61)).toBe('1:01');
  });

  it('rounds rather than truncating', () => {
    expect(formatDuration(7.6)).toBe('0:08');
  });

  it('shows 0:00 for a length the browser could not measure', () => {
    expect(formatDuration(null)).toBe('0:00');
    expect(formatDuration(undefined)).toBe('0:00');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(-3)).toBe('0:00');
  });
});
