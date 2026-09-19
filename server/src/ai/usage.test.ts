import { describe, expect, it } from 'vitest';
import { estimateCostMicros, estimateTokens, usd } from './usage.js';

describe('estimating what a call costs', () => {
  it('charges input and output at different rates', () => {
    const cost = estimateCostMicros('gemini-2.0-flash-lite', 1_000_000, 0);
    expect(cost).toBe(75_000);
    expect(estimateCostMicros('gemini-2.0-flash-lite', 0, 1_000_000)).toBe(300_000);
  });

  /*
   * An unknown model must cost *more* than a known one, not less. Guessing low
   * on a model we have never seen is how a cap silently stops working.
   */
  it('assumes an unknown model is expensive rather than free', () => {
    const known = estimateCostMicros('gemini-2.0-flash', 100_000, 10_000);
    const unknown = estimateCostMicros('some-new-model', 100_000, 10_000);
    expect(unknown).toBeGreaterThan(known);
    expect(unknown).toBeGreaterThan(0);
  });

  it('never returns a fraction of a micro', () => {
    expect(Number.isInteger(estimateCostMicros('gemini-2.0-flash', 7, 3))).toBe(true);
  });

  it('costs nothing for nothing', () => {
    expect(estimateCostMicros('gemini-2.0-flash', 0, 0)).toBe(0);
  });

  it('shows money to the cent', () => {
    expect(usd(1_000_000)).toBe('1.00');
    expect(usd(5_000_000)).toBe('5.00');
    expect(usd(12_345)).toBe('0.01');
  });
});

describe('counting tokens', () => {
  /*
   * Over-counting is the safe direction: the estimate drives a spending cap, so
   * an under-count spends money the owner said not to spend.
   */
  it('over-estimates rather than under-estimates', () => {
    const text = 'a'.repeat(400);
    // ~100 tokens by the usual 4-chars rule; this should be at least that.
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(100);
  });

  it('counts Arabic, which packs more meaning per character', () => {
    expect(estimateTokens('مرحبا كيف حالك')).toBeGreaterThan(0);
  });

  it('counts nothing as nothing', () => {
    expect(estimateTokens('')).toBe(0);
  });
});
