import { describe, expect, it } from 'vitest';
import { budgetLabel } from './ui.js';

/**
 * How a budget reads on a card. Agents glance at this a hundred times a day,
 * so a figure that reads as a range when it is not is worth a test.
 */
describe('budgetLabel', () => {
  it('shows a range when there is one', () => {
    expect(budgetLabel(1_000_000, 2_000_000, null)).toBe('AED 1M–2M');
  });

  it('shows one figure when both ends are the same', () => {
    expect(budgetLabel(3_500_000, 3_500_000, null)).toBe('AED 3.5M');
  });

  it('shows one figure when both ends round to the same short form', () => {
    /* 3,450,000 and 3,500,000 are both "3.5M". Showing it twice looks broken. */
    expect(budgetLabel(3_450_000, 3_500_000, null)).toBe('AED 3.5M');
  });

  it('writes millions with at most one decimal', () => {
    expect(budgetLabel(2_500_000, null, null)).toBe('AED 2.5M+');
    expect(budgetLabel(2_000_000, null, null)).toBe('AED 2M+');
  });

  it('writes anything under a million in thousands', () => {
    expect(budgetLabel(750_000, null, null)).toBe('AED 750K+');
    expect(budgetLabel(null, 900_000, null)).toBe('up to AED 900K');
  });

  it('says "up to" when only a ceiling is known', () => {
    expect(budgetLabel(null, 3_000_000, null)).toBe('up to AED 3M');
  });

  it('says "+" when only a floor is known', () => {
    expect(budgetLabel(1_500_000, null, null)).toBe('AED 1.5M+');
  });

  it('falls back to the band the lead actually said', () => {
    expect(budgetLabel(null, null, '1M - 2M')).toBe('1M - 2M');
  });

  it('shows a dash when there is nothing at all', () => {
    expect(budgetLabel(null, null, null)).toBe('—');
    expect(budgetLabel(0, 0, null)).toBe('—');
  });
});
