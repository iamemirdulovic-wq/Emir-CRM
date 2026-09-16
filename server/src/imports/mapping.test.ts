import { describe, expect, it } from 'vitest';
import { matchHeader, normalizeHeader, suggestMapping } from './mapping.js';

describe('normalizeHeader', () => {
  it('reduces the spellings of one header to the same key', () => {
    expect(normalizeHeader('Mobile No.')).toBe('mobileno');
    expect(normalizeHeader('mobile_no')).toBe('mobileno');
    expect(normalizeHeader('MOBILE NO')).toBe('mobileno');
  });

  it('keeps Arabic letters', () => {
    expect(normalizeHeader('رقم الهاتف')).toBe('رقمالهاتف');
  });
});

describe('matchHeader', () => {
  it('places the headers real exports use', () => {
    expect(matchHeader('Mobile No.')).toBe('phone');
    expect(matchHeader('Budget AED')).toBe('budgetBand');
    expect(matchHeader('Client Name')).toBe('fullName');
    expect(matchHeader('Email Address')).toBe('email');
    expect(matchHeader('Lead Source')).toBe('source');
    expect(matchHeader('Assigned To')).toBe('ownerEmail');
  });

  it('tells a minimum budget from a budget range', () => {
    // "budget" is a substring of "budgetmin", so the longer alias has to win or
    // every min/max column collapses into one.
    expect(matchHeader('Budget Min')).toBe('budgetMinAed');
    expect(matchHeader('Max Budget')).toBe('budgetMaxAed');
    expect(matchHeader('Budget')).toBe('budgetBand');
  });

  it('matches Arabic headers', () => {
    expect(matchHeader('الاسم')).toBe('fullName');
    expect(matchHeader('المشروع')).toBe('projectName');
  });

  it('declines a header it does not recognise', () => {
    expect(matchHeader('Internal Ref #')).toBeNull();
    expect(matchHeader('')).toBeNull();
  });

  it('does not match on a one- or two-letter coincidence', () => {
    expect(matchHeader('ID')).toBeNull();
  });
});

describe('suggestMapping', () => {
  it('maps a typical agency export', () => {
    const mapping = suggestMapping(['Full Name', 'Mobile No.', 'Email', 'Project', 'Budget AED', 'Notes']);
    expect(mapping).toEqual({
      'Full Name': 'fullName',
      'Mobile No.': 'phone',
      Email: 'email',
      Project: 'projectName',
      'Budget AED': 'budgetBand',
      Notes: 'notes',
    });
  });

  it('never maps two columns to the same field', () => {
    /*
     * "Phone" and "Phone 2" both look like a phone. Importing the second over
     * the first loses the number people actually call, and nobody notices for
     * weeks — so the weaker match is left for a person to decide.
     */
    const mapping = suggestMapping(['Phone', 'Mobile Number']);
    const fields = Object.values(mapping).filter(Boolean);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it('keeps the better of two competing headers', () => {
    const mapping = suggestMapping(['Contact Info', 'Email Address']);
    expect(mapping['Email Address']).toBe('email');
  });

  it('leaves unknown columns unmapped rather than guessing', () => {
    const mapping = suggestMapping(['Full Name', 'Internal Ref #', 'Sync Token']);
    expect(mapping['Internal Ref #']).toBeNull();
    expect(mapping['Sync Token']).toBeNull();
  });

  it('returns an entry for every header, so the wizard can list them all', () => {
    const headers = ['a', 'Full Name', '', 'Phone'];
    expect(Object.keys(suggestMapping(headers)).length).toBe(new Set(headers).size);
  });
});
