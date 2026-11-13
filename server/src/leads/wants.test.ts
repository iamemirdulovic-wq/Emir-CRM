import { describe, expect, it } from 'vitest';
import { PAYMENTS, PURPOSES, TIMELINES, WANT_CHOICES, parseBudget } from './wants.js';

/**
 * Reading a budget out of what somebody typed.
 *
 * This is the one place on the lead page that turns typing into a number, so
 * every form an agent actually writes is pinned here rather than argued about
 * from a screenshot. The rule that matters: where there is no figure in the
 * text, there is no figure in the row — it keeps their words and stores no
 * number at all, because a guessed budget is quoted back to a client.
 */
describe('reading a budget', () => {
  it('reads one figure as one figure, not a range', () => {
    expect(parseBudget('2M')).toEqual({ min: 2_000_000, max: 2_000_000, band: '2M' });
    expect(parseBudget('AED 2M')).toEqual({ min: 2_000_000, max: 2_000_000, band: 'AED 2M' });
    expect(parseBudget('2,000,000').min).toBe(2_000_000);
    expect(parseBudget('800K').min).toBe(800_000);
    expect(parseBudget('1.5m').min).toBe(1_500_000);
  });

  it('reads a range as a range, lowest first', () => {
    expect(parseBudget('1.5M - 2M')).toEqual({ min: 1_500_000, max: 2_000_000, band: '1.5M - 2M' });
    expect(parseBudget('1.5–2M').min).toBe(1_500_000);
    expect(parseBudget('2M to 1.5M'), 'written backwards, stored forwards')
      .toEqual({ min: 1_500_000, max: 2_000_000, band: '2M to 1.5M' });
  });

  /* "2" on the budget line means two million. No brokerage in Dubai sells a
     flat for AED 2, and an agent who types a bare number means millions. */
  it('reads a bare small number as millions', () => {
    expect(parseBudget('2').min).toBe(2_000_000);
    expect(parseBudget('1.5').min).toBe(1_500_000);
    expect(parseBudget('950000').min, 'a real figure is left exactly as typed').toBe(950_000);
  });

  it('keeps the words and invents no number when there is none', () => {
    expect(parseBudget('needs a mortgage first'))
      .toEqual({ min: null, max: null, band: 'needs a mortgage first' });
    expect(parseBudget('Not said yet'))
      .toEqual({ min: null, max: null, band: 'Not said yet' });
  });

  it('treats an empty line as nothing said', () => {
    expect(parseBudget('')).toEqual({ min: null, max: null, band: null });
    expect(parseBudget('   ')).toEqual({ min: null, max: null, band: null });
    expect(parseBudget(null)).toEqual({ min: null, max: null, band: null });
  });

  it('ignores anything after the second figure', () => {
    /* "1.5M-2M, maybe 3M later" is two ends and a hope. */
    const read = parseBudget('1.5M-2M, maybe 3M later');
    expect(read.min).toBe(1_500_000);
    expect(read.max).toBe(2_000_000);
  });
});

/**
 * The menus behind Purpose, Timeline and Payment.
 *
 * Every value offered has to be one the ENUM column can hold: MySQL here runs
 * with STRICT_TRANS_TABLES and refuses anything else outright rather than
 * storing an approximation, which is exactly how five of the six Lost reasons
 * came to be unwritable.
 */
describe('the choices the three menu lines offer', () => {
  it('offers only values the columns hold', () => {
    expect(WANT_CHOICES.purpose.map((one) => one.value)).toEqual([...PURPOSES]);
    expect(WANT_CHOICES.timeline.map((one) => one.value)).toEqual([...TIMELINES]);
    expect(WANT_CHOICES.payment.map((one) => one.value)).toEqual([...PAYMENTS]);
  });

  it('writes them in plain English', () => {
    for (const list of Object.values(WANT_CHOICES)) {
      for (const one of list) {
        expect(one.label, one.value).not.toContain('_');
        expect(one.label.length).toBeGreaterThan(2);
      }
    }
  });

  it('has a way to say nothing was said', () => {
    for (const list of Object.values(WANT_CHOICES)) {
      expect(list.some((one) => one.value === 'unknown')).toBe(true);
      expect(list.find((one) => one.value === 'unknown')?.label).toBe('Not said yet');
    }
  });
});
