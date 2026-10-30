import { describe, expect, it } from 'vitest';
import {
  COUNTRIES, countryOfE164, DEFAULT_COUNTRY, flagOf, groupNational, readPhone, stripPrefixes,
} from './phone.js';

const AE = DEFAULT_COUNTRY;
const country = (iso: string) => COUNTRIES.find((c) => c.iso === iso)!;

/**
 * A wrong phone number is a lost lead: nobody can call it, the WhatsApp never
 * arrives, and the client thinks Emigeo ignored them. Agents type these into a
 * phone in a car park, from a number read aloud, so every shape a person
 * actually produces is settled here.
 */
describe('reading a phone number as it is typed', () => {
  it('defaults to the UAE, because most numbers typed here are', () => {
    expect(AE.iso).toBe('AE');
    expect(AE.dial).toBe('971');
  });

  it('groups a UAE mobile the way it is said out loud', () => {
    expect(readPhone('501234567', AE).display).toBe('50 123 4567');
    expect(readPhone('501234567', AE).e164).toBe('+971501234567');
  });

  /* "050 123 4567" is how every UAE number is written on a card and a sign. */
  it('drops the leading zero people write on the front', () => {
    expect(readPhone('0501234567', AE).e164).toBe('+971501234567');
    expect(readPhone('00501234567', AE).e164).toBe('+971501234567');
  });

  /* Pasting the whole international number into the national box is the most
     common paste there is, and it must not become +97197150…. */
  it('does not double the country code when the whole number is pasted', () => {
    expect(readPhone('971501234567', AE).e164).toBe('+971501234567');
    expect(readPhone('+971 50 123 4567', AE).e164).toBe('+971501234567');
    expect(readPhone('00971501234567', AE).e164).toBe('+971501234567');
  });

  it('ignores spaces, dashes and brackets', () => {
    expect(readPhone('(050) 123-4567', AE).e164).toBe('+971501234567');
  });

  it('keeps partial input readable instead of waiting for the last digit', () => {
    expect(readPhone('50', AE).display).toBe('50');
    expect(readPhone('5012', AE).display).toBe('50 12');
    expect(readPhone('50123456', AE).display).toBe('50 123 456');
  });

  it('refuses to grow past what the country allows', () => {
    expect(readPhone('50123456789999', AE).e164).toBe('+971501234567');
  });
});

describe('telling the agent what is wrong', () => {
  it('says nothing while the field is empty', () => {
    const value = readPhone('', AE);
    expect(value).toEqual({ e164: '', display: '', valid: true, problem: null });
  });

  it('is valid and quiet on a complete number', () => {
    expect(readPhone('501234567', AE).valid).toBe(true);
    expect(readPhone('501234567', AE).problem).toBeNull();
  });

  it('says a short number is short, in words, naming the country', () => {
    const value = readPhone('5012345', AE);
    expect(value.valid).toBe(false);
    expect(value.problem).toContain('short');
    expect(value.problem).toContain('9 digits');
    expect(value.problem).toContain('+971');
  });

  /* A country with a real range must not be nagged at either end of it. */
  it('accepts anything inside a country that has a range', () => {
    const lb = country('LB');
    expect(readPhone('1234567', lb).valid).toBe(true);
    expect(readPhone('12345678', lb).valid).toBe(true);
    expect(readPhone('123456', lb).valid).toBe(false);
  });
});

describe('other countries', () => {
  it('groups an Indian mobile in fives', () => {
    expect(readPhone('9876543210', country('IN')).display).toBe('98765 43210');
  });

  it('groups a Russian number the way Russians read it', () => {
    expect(readPhone('9161234567', country('RU')).display).toBe('916 123 45 67');
  });

  it('builds the right E.164 for a short Gulf number', () => {
    expect(readPhone('33123456', country('QA')).e164).toBe('+97433123456');
  });
});

describe('recognising the country of a number already stored', () => {
  it('finds the country from an E.164', () => {
    expect(countryOfE164('+971501234567')?.iso).toBe('AE');
    expect(countryOfE164('+919876543210')?.iso).toBe('IN');
  });

  /* +97 is a prefix of +971; the longer code has to win or every UAE number
     would be read as a Kazakh one. */
  it('prefers the longest matching dial code', () => {
    expect(countryOfE164('+971501234567')?.dial).toBe('971');
    expect(countryOfE164('+966501234567')?.iso).toBe('SA');
  });

  it('gives nothing rather than a guess when there is no number', () => {
    expect(countryOfE164(null)).toBeNull();
    expect(countryOfE164('')).toBeNull();
  });
});

describe('the pieces', () => {
  it('strips a country code only when something is left behind it', () => {
    /* "971" alone is someone part-way through typing, not a country code. */
    expect(stripPrefixes('971', '971')).toBe('971');
    expect(stripPrefixes('9715', '971')).toBe('5');
  });

  it('keeps digits that overflow the grouping rather than eating them', () => {
    expect(groupNational('1234567890123', [2, 3, 4])).toBe('12 345 6789 0123');
  });

  it('turns an ISO code into its flag', () => {
    expect(flagOf('AE')).toBe('🇦🇪');
    expect(flagOf('gb')).toBe('🇬🇧');
  });

  it('has no country whose grouping cannot hold its own digits', () => {
    for (const item of COUNTRIES) {
      const max = Array.isArray(item.length) ? item.length[1] : item.length;
      const room = item.groups.reduce((sum, size) => sum + size, 0);
      expect(room, `${item.name} groups ${room} digits but has up to ${max}`).toBeGreaterThanOrEqual(max);
    }
  });

  it('has no duplicate ISO codes', () => {
    const seen = new Set(COUNTRIES.map((item) => item.iso));
    expect(seen.size).toBe(COUNTRIES.length);
  });
});
