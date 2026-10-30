import { describe, expect, it } from 'vitest';
import { noteBounce, STORM_THRESHOLD, STORM_WINDOW_MS } from './storm.js';

/**
 * The morning after an outage.
 *
 * A worker that has been down comes back to a queue of expired timers and runs
 * them within seconds. Each is a real bounce wanting to tell somebody — so the
 * owner's phone buzzes seven times in four seconds, they silence it, and the
 * eighth, which happens on a normal Tuesday and actually matters, is silenced
 * too. One summary is worth more than seven alerts nobody reads.
 */
describe('alerting about bounces', () => {
  const run = (count: number, gapMs = 100, from = 1_000_000) => {
    let window = null;
    const told: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const result = noteBounce(window, from + i * gapMs);
      window = result.window;
      told.push(result.verdict.tell === 'summary' ? `summary:${result.verdict.count}` : result.verdict.tell);
    }
    return told;
  };

  it('tells the owner about a bounce on a normal day', () => {
    expect(run(1)).toEqual(['each']);
    expect(run(2)).toEqual(['each', 'each']);
  });

  /* The third in a minute is no longer a normal day. */
  it('switches to one summary once they start arriving together', () => {
    expect(run(STORM_THRESHOLD)).toEqual(['each', 'each', 'summary:3']);
  });

  it('stays quiet for the rest of the catch-up', () => {
    const told = run(9);
    expect(told.slice(0, 2)).toEqual(['each', 'each']);
    expect(told[2]).toBe('summary:3');
    expect(told.slice(3)).toEqual(Array(6).fill('nothing'));
  });

  /* Exactly one summary, however long the backlog is. */
  it('summarises once, not once per lead past the line', () => {
    expect(run(50).filter((t) => t.startsWith('summary'))).toHaveLength(1);
  });

  it('goes back to normal once the rush is over', () => {
    let window = null;
    for (let i = 0; i < 9; i += 1) window = noteBounce(window, 1_000_000 + i * 100).window;

    const later = noteBounce(window, 1_000_000 + STORM_WINDOW_MS + 1);
    expect(later.verdict.tell).toBe('each');
    expect(later.window.count).toBe(1);
  });

  /* Bounces spread across a quiet afternoon are each worth hearing about. */
  it('does not summarise bounces that are simply spread out', () => {
    expect(run(6, STORM_WINDOW_MS + 1)).toEqual(Array(6).fill('each'));
  });

  it('starts cleanly with no window', () => {
    const result = noteBounce(null, Date.now());
    expect(result.verdict.tell).toBe('each');
    expect(result.window.count).toBe(1);
  });

  /* The caller keeps the returned window, so the one passed in must not be
     edited underneath whoever else is holding it. */
  it('does not change the window it was given', () => {
    const first = noteBounce(null, 1_000_000);
    noteBounce(first.window, 1_000_100);
    expect(first.window.count).toBe(1);
  });
});
