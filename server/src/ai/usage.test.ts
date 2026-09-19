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

/**
 * Google ships dated releases like `gemini-2.5-flash-lite-preview-09-2025`.
 * An exact-name price table missed every one of them, so the cheapest model
 * in the catalogue was billed at the unknown-model rate — and, worse, an
 * expensive one could have been billed at far less than it costs.
 */
describe('pricing a model by its family', () => {
  it('prices a dated release like its family', () => {
    expect(estimateCostMicros('gemini-2.5-flash-lite-preview-09-2025', 1_000_000, 0))
      .toBe(estimateCostMicros('gemini-2.5-flash-lite', 1_000_000, 0));
  });

  /* 'gemini-2.5-flash-lite' also starts with 'gemini-2.5-flash'. The longer
     prefix has to win, or the cheapest model is billed as the dearer one. */
  it('does not mistake a lite model for its full sibling', () => {
    const lite = estimateCostMicros('gemini-2.5-flash-lite', 1_000_000, 0);
    const full = estimateCostMicros('gemini-2.5-flash', 1_000_000, 0);
    expect(lite).toBeLessThan(full);
  });

  it('knows Pro costs far more than Flash', () => {
    expect(estimateCostMicros('gemini-2.5-pro', 0, 1_000_000))
      .toBeGreaterThan(estimateCostMicros('gemini-2.5-flash', 0, 1_000_000) * 3);
  });

  /*
   * An unknown model must never be cheaper than the dearest known one, or a
   * single Pro-class call could spend most of the month before the cap saw it.
   */
  it('prices an unknown model at least as high as the dearest known one', () => {
    const unknown = estimateCostMicros('gemini-9.9-enormous', 1_000_000, 1_000_000);
    const pro = estimateCostMicros('gemini-2.5-pro', 1_000_000, 1_000_000);
    expect(unknown).toBeGreaterThanOrEqual(pro);
  });
});
