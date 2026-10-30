import { describe, expect, it } from 'vitest';
import { digitsOf, likeTerm, looksLikePhone, MIN_PHONE_DIGITS, phoneTail } from './search-terms.js';

describe('digitsOf', () => {
  it('keeps only digits', () => {
    expect(digitsOf('+971 50 123 4567')).toBe('971501234567');
    expect(digitsOf('(050) 123-4567')).toBe('0501234567');
  });

  it('folds Arabic-Indic numerals', () => {
    expect(digitsOf('٠٥٠١٢٣٤٥٦٧')).toBe('0501234567');
  });

  it('folds the Persian numerals some keyboards produce', () => {
    expect(digitsOf('۰۵۰۱۲۳۴۵۶۷')).toBe('0501234567');
  });

  it('handles a mixed-script paste', () => {
    expect(digitsOf('+٩٧١ 50 ١٢٣4567')).toBe('971501234567');
  });

  it('returns nothing for a name', () => {
    expect(digitsOf('Ahmed Khan')).toBe('');
  });
});

describe('phoneTail', () => {
  it('matches a UAE number from the right-hand end', () => {
    expect(phoneTail('0501234567')).toBe('%501234567');
  });

  it('finds the same number typed with the country code', () => {
    expect(phoneTail('+971 50 123 4567')).toBe('%501234567');
    expect(phoneTail('00971501234567')).toBe('%501234567');
  });

  it('finds the same number typed without the zero', () => {
    expect(phoneTail('50 123 4567')).toBe('%501234567');
  });

  it('agrees on all the shapes one number comes in', () => {
    const shapes = ['0501234567', '+971501234567', '971 50 123 4567', '050-123-4567', '(050) 123 4567'];
    const tails = new Set(shapes.map((shape) => phoneTail(shape)));
    expect(tails.size).toBe(1);
  });

  it('works on a partial number', () => {
    expect(phoneTail('1234567')).toBe('%1234567');
  });

  it('refuses anything too short to be a number', () => {
    expect(phoneTail('12345')).toBeNull();
    expect(phoneTail('')).toBeNull();
    expect(phoneTail('Ahmed')).toBeNull();
  });

  it('respects a shorter tail when asked', () => {
    expect(phoneTail('+971501234567', 6)).toBe('%234567');
  });
});

describe('looksLikePhone', () => {
  it('says yes to a number in any shape', () => {
    for (const value of ['0501234567', '+971 50 123 4567', '(050) 123-4567', '00971501234567']) {
      expect(looksLikePhone(value)).toBe(true);
    }
  });

  it('says no to a name', () => {
    expect(looksLikePhone('Ahmed Khan')).toBe(false);
  });

  it('says no to an address that happens to contain digits', () => {
    expect(looksLikePhone('Flat 302, Marina Heights 2019')).toBe(false);
  });

  it('says no to a short number', () => {
    expect(looksLikePhone('2026')).toBe(false);
    expect(looksLikePhone(`${'1'.repeat(MIN_PHONE_DIGITS - 1)}`)).toBe(false);
    expect(looksLikePhone(`${'1'.repeat(MIN_PHONE_DIGITS)}`)).toBe(true);
  });

  it('says no to nothing at all', () => {
    expect(looksLikePhone('')).toBe(false);
    expect(looksLikePhone('   ')).toBe(false);
  });

  it('accepts an Arabic-numeral number', () => {
    expect(looksLikePhone('٠٥٠١٢٣٤٥٦٧')).toBe(true);
  });
});

describe('likeTerm', () => {
  it('wraps a plain term', () => {
    expect(likeTerm('marina')).toBe('%marina%');
  });

  it('trims what the person typed', () => {
    expect(likeTerm('  marina  ')).toBe('%marina%');
  });

  it('treats a typed wildcard as text, not as a wildcard', () => {
    expect(likeTerm('100%')).toBe('%100\\%%');
    expect(likeTerm('a_b')).toBe('%a\\_b%');
    expect(likeTerm('back\\slash')).toBe('%back\\\\slash%');
  });
});
