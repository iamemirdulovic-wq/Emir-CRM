import { describe, expect, it } from 'vitest';
import {
  digitsOf, likeTerm, looksLikePhone, MIN_PHONE_DIGITS, phoneAnywhere, phonePatterns, phoneTail,
} from './search-terms.js';

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
    expect(phoneTail('1234')).toBeNull();
    expect(phoneTail('')).toBeNull();
    expect(phoneTail('Ahmed')).toBeNull();
  });

  /* Five digits is what an agent reads off a missed call before ringing
     back. It was six, and six is why "99693" found nothing. */
  it('accepts the five digits somebody reads off a screen', () => {
    expect(phoneTail('99693')).toBe('%99693');
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
    expect(looksLikePhone('202')).toBe(false);
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

describe('phoneAnywhere', () => {
  it('finds a run of digits from the middle of a number', () => {
    expect(phoneAnywhere('99693')).toBe('%99693%');
  });

  it('ignores how the number was spaced', () => {
    expect(phoneAnywhere('99693 42716')).toBe('%9969342716%');
  });

  it('drops a leading zero, which no E.164 number has', () => {
    expect(phoneAnywhere('0501234567')).toBe('%501234567%');
  });

  it('refuses anything too short to be a number', () => {
    expect(phoneAnywhere('1234')).toBeNull();
    expect(phoneAnywhere('Ahmed')).toBeNull();
  });
});

describe('phonePatterns', () => {
  /*
   * The fault this was written for, in one test. `+91 99693 42716` is stored
   * as `+919969342716`, the agent types the five digits they can see, and the
   * CRM has to find the client it already has rather than offer to create
   * them a second time.
   */
  const held = '+919969342716';
  const matches = (pattern: string): boolean =>
    new RegExp(`^${pattern.replace(/%/g, '.*')}$`).test(held);

  it('finds a stored number from a run of digits inside it', () => {
    const patterns = phonePatterns('99693');
    expect(patterns).toEqual(['%99693%']);
    expect(patterns.some(matches)).toBe(true);
  });

  it('finds it from the end of the number too', () => {
    expect(phonePatterns('42716').some(matches)).toBe(true);
  });

  it('finds it from the whole number, spaced as the owner sees it', () => {
    expect(phonePatterns('+91 99693 42716').some(matches)).toBe(true);
  });

  it('still finds a UAE number typed with the country code and a zero', () => {
    const patterns = phonePatterns('+971 0 50 123 4567');
    expect(patterns).toHaveLength(2);
    expect(patterns.some((p) => new RegExp(`^${p.replace(/%/g, '.*')}$`).test('+971501234567'))).toBe(true);
  });

  it('asks one question when the query is short enough for one to do', () => {
    expect(phonePatterns('0501234567')).toEqual(['%501234567%']);
  });

  it('says nothing at all for a name or a year', () => {
    expect(phonePatterns('Ahmed')).toEqual([]);
    expect(phonePatterns('2026')).toEqual([]);
  });
});
