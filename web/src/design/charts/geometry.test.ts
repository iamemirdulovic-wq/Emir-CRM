import { describe, expect, it } from 'vitest';
import { scale, smooth, type Point } from './geometry.js';

describe('smooth', () => {
  it('returns nothing for an empty series', () => {
    expect(smooth([])).toBe('');
  });

  it('moves to the only point of a single-point series', () => {
    expect(smooth([[3, 4]])).toBe('M3 4');
  });

  it('emits one cubic segment per gap', () => {
    const points: Point[] = [
      [0, 10],
      [10, 0],
      [20, 10],
      [30, 0],
    ];
    const d = smooth(points);
    expect(d.startsWith('M0 10')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(points.length - 1);
    // The curve must end exactly on the last data point, or the line and the
    // area fill under it stop lining up.
    expect(d.endsWith('30 0')).toBe(true);
  });

  it('matches the design file’s control points', () => {
    // Worked through the design’s own formula: control points sit a sixth of
    // the way along the span between each point’s neighbours.
    expect(smooth([[0, 0], [10, 10]])).toBe('M0 0 C1.6666666666666667 1.6666666666666667 8.333333333333334 8.333333333333334 10 10');
  });

  it('never produces NaN, whatever the coordinates', () => {
    const d = smooth([
      [0, 0],
      [0, 0],
      [5, -3],
    ]);
    expect(d).not.toContain('NaN');
  });
});

describe('scale', () => {
  it('maps a value onto 0..1', () => {
    expect(scale(5, 0, 10)).toBe(0.5);
    expect(scale(0, 0, 10)).toBe(0);
    expect(scale(10, 0, 10)).toBe(1);
  });

  it('centres a flat series instead of dividing by zero', () => {
    // Eight identical days should draw a line through the middle, not vanish.
    expect(scale(7, 7, 7)).toBe(0.5);
  });
});
