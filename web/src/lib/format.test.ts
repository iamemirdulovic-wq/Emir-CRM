import { describe, expect, it } from 'vitest';
import { formatAedShort, maskPhone, plural } from './format.js';

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

/**
 * The masked number in a list. It is deliberately not security — the full
 * number is in the same response, because the Call button has to dial it
 * without a round trip. It raises the effort of copying a column of clients
 * by hand, and nothing more. See DECISIONS.md.
 */
describe('hiding the middle of a phone number', () => {
  it('leaves enough to recognise a client you already know', () => {
    expect(maskPhone('+971501234567')).toBe('+971 50 ••• 4567');
  });

  it('ignores the spaces a number may already carry', () => {
    expect(maskPhone('+971 50 123 4567')).toBe('+971 50 ••• 4567');
  });

  it('splits on the real dial code, not a fixed number of characters', () => {
    expect(maskPhone('+919876543210')).toBe('+91 98 ••• 3210');
  });

  /* A number too short to mask is shown as it is rather than turned into
     something that looks like a different number. */
  it('does not mangle a number with nothing to hide', () => {
    expect(maskPhone('+9715')).toBe('+9715');
  });

  it('says nothing rather than "undefined" when there is no number', () => {
    expect(maskPhone(null)).toBe('—');
    expect(maskPhone(undefined)).toBe('—');
    expect(maskPhone('')).toBe('—');
  });
});

describe('plural', () => {
  it('says one of a thing without an s', () => {
    expect(plural(1, 'contact')).toBe('1 contact');
    expect(plural(1, 'lead')).toBe('1 lead');
  });

  it('adds the s for everything else, including none', () => {
    expect(plural(0, 'contact')).toBe('0 contacts');
    expect(plural(2, 'contact')).toBe('2 contacts');
  });

  it('takes the plural when it is not just an s', () => {
    expect(plural(1, 'person', 'people')).toBe('1 person');
    expect(plural(3, 'person', 'people')).toBe('3 people');
  });

  it('groups a big number the way a reader expects', () => {
    expect(plural(12500, 'contact')).toBe('12,500 contacts');
  });

  it('treats a negative as a plural rather than throwing', () => {
    expect(plural(-1, 'contact')).toBe('-1 contacts');
  });
});
