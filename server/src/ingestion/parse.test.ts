import { describe, expect, it } from 'vitest';
import {
  cleanText,
  detectLanguage,
  joinName,
  parseBoolean,
  parseBudgetBand,
  parseEmirate,
  parsePaymentMethod,
  parsePurpose,
  parseTimeline,
  splitName,
} from './parse.js';

describe('parseBudgetBand', () => {
  it('reads a millions range', () => {
    expect(parseBudgetBand('AED 1M - 2M')).toEqual({ min: 1_000_000, max: 2_000_000 });
    expect(parseBudgetBand('1.5M – 3M')).toEqual({ min: 1_500_000, max: 3_000_000 });
  });

  it('reads thousands', () => {
    expect(parseBudgetBand('800k - 1.2m')).toEqual({ min: 800_000, max: 1_200_000 });
  });

  it('reads an exact figure with separators', () => {
    expect(parseBudgetBand('AED 1,500,000')).toEqual({ min: 1_500_000, max: 1_500_000 });
  });

  it('reads open-ended bands', () => {
    expect(parseBudgetBand('Up to 3M')).toEqual({ min: null, max: 3_000_000 });
    expect(parseBudgetBand('5M+')).toEqual({ min: 5_000_000, max: null });
    expect(parseBudgetBand('More than 10 million')).toEqual({ min: 10_000_000, max: null });
  });

  it('treats a bare small number as millions', () => {
    expect(parseBudgetBand('2 - 4')).toEqual({ min: 2_000_000, max: 4_000_000 });
  });

  it('returns nulls for unparseable answers', () => {
    expect(parseBudgetBand('not sure yet')).toEqual({ min: null, max: null });
    expect(parseBudgetBand('')).toEqual({ min: null, max: null });
    expect(parseBudgetBand(null)).toEqual({ min: null, max: null });
  });
});

describe('enum parsers', () => {
  it('parses purpose in English and Arabic', () => {
    expect(parsePurpose('Investment')).toBe('investment');
    expect(parsePurpose('For rental yield')).toBe('investment');
    expect(parsePurpose('End use')).toBe('end_use');
    expect(parsePurpose('To live in with my family')).toBe('end_use');
    expect(parsePurpose('استثمار')).toBe('investment');
    expect(parsePurpose('maybe')).toBe('unknown');
    expect(parsePurpose(null)).toBe('unknown');
  });

  it('parses payment method', () => {
    expect(parsePaymentMethod('Cash')).toBe('cash');
    expect(parsePaymentMethod('Bank mortgage')).toBe('mortgage');
    expect(parsePaymentMethod('Developer payment plan')).toBe('payment_plan');
    expect(parsePaymentMethod('تمويل')).toBe('mortgage');
    expect(parsePaymentMethod('dunno')).toBe('unknown');
  });

  it('parses timeline', () => {
    expect(parseTimeline('Immediately')).toBe('immediate');
    expect(parseTimeline('ASAP')).toBe('immediate');
    expect(parseTimeline('1-3 months')).toBe('1_3_months');
    expect(parseTimeline('3-6 months')).toBe('3_6_months');
    expect(parseTimeline('6-12 months')).toBe('6_12_months');
    expect(parseTimeline('Just looking')).toBe('12_plus');
    expect(parseTimeline('hmm')).toBe('unknown');
  });

  it('parses emirate in English and Arabic', () => {
    expect(parseEmirate('Dubai')).toBe('dubai');
    expect(parseEmirate('Abu Dhabi')).toBe('abu_dhabi');
    expect(parseEmirate('abudhabi')).toBe('abu_dhabi');
    expect(parseEmirate('دبي')).toBe('dubai');
    expect(parseEmirate('أبوظبي')).toBe('abu_dhabi');
    expect(parseEmirate('RAK')).toBe('ras_al_khaimah');
    expect(parseEmirate('London')).toBeNull();
  });

  it('parses booleans', () => {
    expect(parseBoolean('yes')).toBe(true);
    expect(parseBoolean('TRUE')).toBe(true);
    expect(parseBoolean('نعم')).toBe(true);
    expect(parseBoolean('no')).toBe(false);
    expect(parseBoolean(null)).toBe(false);
  });
});

describe('detectLanguage', () => {
  it('detects Arabic and English', () => {
    expect(detectLanguage('مرحبا، أريد معلومات عن المشروع')).toBe('ar');
    expect(detectLanguage('Hello, I want project details')).toBe('en');
  });

  it('prefers the dominant script in mixed text', () => {
    expect(detectLanguage('Hello I am interested in Emaar Beachfront please send details شكرا')).toBe('en');
  });

  it('returns null when there is nothing to judge', () => {
    expect(detectLanguage('', null, undefined)).toBeNull();
    expect(detectLanguage('12345')).toBeNull();
  });
});

describe('name helpers', () => {
  it('splits and rejoins names', () => {
    expect(splitName('Sara Al Mansoori')).toEqual({ first: 'Sara', last: 'Al Mansoori' });
    expect(splitName('Sara')).toEqual({ first: 'Sara', last: null });
    expect(splitName('  ')).toEqual({ first: null, last: null });
    expect(joinName('Sara', 'Al Mansoori')).toBe('Sara Al Mansoori');
    expect(joinName('Sara', null)).toBe('Sara');
    expect(joinName(null, null)).toBeNull();
  });
});

describe('cleanText', () => {
  it('collapses whitespace and truncates', () => {
    expect(cleanText('  hello   world  ')).toBe('hello world');
    expect(cleanText('x'.repeat(600), 10)).toHaveLength(10);
    expect(cleanText('')).toBeNull();
    expect(cleanText(null)).toBeNull();
  });
});
