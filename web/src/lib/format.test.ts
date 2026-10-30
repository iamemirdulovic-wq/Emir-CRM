import { describe, expect, it } from 'vitest';
import { formatAedShort } from './format.js';

/**
 * The short budget appears on the pipeline card, in Incoming and on the
 * new-lead alert — the three places an agent decides whether a lead is worth
 * picking up first. A figure rounded the wrong way there is a figure they act
 * on, so the awkward numbers are settled here.
 */
describe('the short budget figure', () => {
  it('keeps a round million round', () => {
    expect(formatAedShort(2_000_000)).toBe('AED 2M');
  });

  it('gives one decimal to anything in between', () => {
    expect(formatAedShort(2_500_000)).toBe('AED 2.5M');
    expect(formatAedShort(1_250_000)).toBe('AED 1.3M');
  });

  it('drops to thousands below a million', () => {
    expect(formatAedShort(850_000)).toBe('AED 850K');
    expect(formatAedShort(1_000)).toBe('AED 1K');
  });

  /* Under a thousand is a deposit or a typo, not a budget — show it as it is
     rather than rounding it to "AED 0K". */
  it('leaves a small number alone', () => {
    expect(formatAedShort(750)).toBe('AED 750');
  });

  /*
   * No budget is not a budget of nothing. "AED 0" on a card would read as a
   * lead with no money, which is a different thing from one who was never
   * asked, and the callers drop the dash rather than print it.
   */
  it('does not turn a missing budget into a number', () => {
    expect(formatAedShort(null)).toBe('—');
    expect(formatAedShort(undefined)).toBe('—');
    expect(formatAedShort(0)).toBe('—');
  });
});
