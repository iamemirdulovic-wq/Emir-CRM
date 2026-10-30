import { describe, expect, it } from 'vitest';
import {
  COMPANY_DEFAULTS, COMPANY_FIELDS, COMPANY_SETTING, MAX_LENGTH, RENAME_WARNING, WHATSAPP_FOOTER_LIMIT,
  companyFrom, companyIssues, displayName, footerFor, type CompanyDetails,
} from './company.js';
import { COMPANY_LOCALITY_AR, COMPANY_LOCALITY_EN, COMPANY_NAME } from './constants.js';

const TODAY = new Date('2026-03-04T08:00:00.000Z');

function details(over: Partial<CompanyDetails> = {}): CompanyDetails {
  return { ...COMPANY_DEFAULTS, ...over };
}

describe('companyFrom', () => {
  it('falls back to the constants when nothing is saved', () => {
    const company = companyFrom({});
    expect(company.legalName).toBe(COMPANY_NAME);
    expect(company.localityEn).toBe(COMPANY_LOCALITY_EN);
    expect(company.localityAr).toBe(COMPANY_LOCALITY_AR);
  });

  it('leaves the fields nobody can guess empty', () => {
    const company = companyFrom({});
    expect(company.trn).toBe('');
    expect(company.orn).toBe('');
    expect(company.logoUrl).toBe('');
  });

  it('takes what is saved', () => {
    const company = companyFrom({ legalName: 'Another Brokerage LLC', trn: '100123456700003' });
    expect(company.legalName).toBe('Another Brokerage LLC');
    expect(company.trn).toBe('100123456700003');
  });

  it('falls back field by field, not all or nothing', () => {
    const company = companyFrom({ trn: '100123456700003' });
    expect(company.trn).toBe('100123456700003');
    expect(company.legalName).toBe(COMPANY_NAME);
  });

  it('treats blank and whitespace as nothing saved', () => {
    expect(companyFrom({ legalName: '' }).legalName).toBe(COMPANY_NAME);
    expect(companyFrom({ legalName: '   ' }).legalName).toBe(COMPANY_NAME);
    expect(companyFrom({ legalName: null }).legalName).toBe(COMPANY_NAME);
    expect(companyFrom({ legalName: undefined }).legalName).toBe(COMPANY_NAME);
  });

  it('trims and caps what it stores', () => {
    expect(companyFrom({ legalName: '  Spaced LLC  ' }).legalName).toBe('Spaced LLC');
    expect(companyFrom({ legalName: 'x'.repeat(400) }).legalName).toHaveLength(MAX_LENGTH.legalName as number);
  });

  it('has a setting name and a length for every field', () => {
    for (const field of COMPANY_FIELDS) {
      expect(COMPANY_SETTING[field]).toMatch(/^COMPANY_[A-Z_]+$/);
      expect(MAX_LENGTH[field]).toBeGreaterThan(0);
      /* The column is VARCHAR(255). */
      expect(MAX_LENGTH[field]).toBeLessThanOrEqual(255);
    }
  });

  it('gives every field its own setting name', () => {
    const names = COMPANY_FIELDS.map((field) => COMPANY_SETTING[field]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('displayName', () => {
  it('prefers what people call us', () => {
    expect(displayName(details({ tradingName: 'Emigeo Homes' }))).toBe('Emigeo Homes');
  });

  it('falls back to the registered name', () => {
    expect(displayName(details({ tradingName: '' }))).toBe(COMPANY_NAME);
    expect(displayName(details({ tradingName: '   ' }))).toBe(COMPANY_NAME);
  });

  it('never returns nothing', () => {
    expect(displayName(details({ tradingName: '', legalName: '' }))).toBe(COMPANY_NAME);
  });
});

describe('footerFor', () => {
  it('says where we are, in the reader’s language', () => {
    const company = details({ tradingName: 'Emigeo Homes' });
    expect(footerFor(company, 'en')).toBe(`Emigeo Homes — ${COMPANY_LOCALITY_EN}`);
    expect(footerFor(company, 'ar')).toBe(`Emigeo Homes — ${COMPANY_LOCALITY_AR}`);
  });

  it('keeps the name in Latin script in the Arabic footer', () => {
    /* The legal name is registered that way and is not ours to translate. */
    expect(footerFor(details(), 'ar')).toContain(COMPANY_NAME);
  });

  it('treats an unknown language as English', () => {
    expect(footerFor(details(), 'ru')).toBe(footerFor(details(), 'en'));
  });

  it('drops the dash when there is no locality', () => {
    expect(footerFor(details({ localityEn: '' }), 'en')).toBe(COMPANY_NAME);
  });

  it('fits a WhatsApp footer, which Meta caps at 60 characters', () => {
    expect(footerFor(details(), 'en').length).toBeLessThanOrEqual(WHATSAPP_FOOTER_LIMIT);
    expect(footerFor(details(), 'ar').length).toBeLessThanOrEqual(WHATSAPP_FOOTER_LIMIT);
  });
});

describe('companyIssues', () => {
  const full: CompanyDetails = details({
    legalName: 'Emigeo Homes Real Estate LLC',
    trn: '100123456700003',
    orn: '12345',
    licenceExpiry: '2027-01-01',
    email: 'hello@homes.me',
    website: 'https://homes.me',
    phone: '+971 4 123 4567',
    whatsapp: '+971501234567',
    logoUrl: '/uploads/logo.png',
  });

  it('says nothing when everything is in order', () => {
    expect(companyIssues(full, TODAY)).toEqual([]);
  });

  it('asks for the TRN, which every tax invoice needs', () => {
    expect(companyIssues(details({ logoUrl: 'x' }), TODAY).join(' ')).toMatch(/TRN/);
  });

  it('checks the TRN is fifteen digits', () => {
    expect(companyIssues({ ...full, trn: '12345' }, TODAY).join(' ')).toMatch(/fifteen digits/);
    /* Spaces in a pasted TRN are not an error. */
    expect(companyIssues({ ...full, trn: '100 123 456 700 003' }, TODAY)).toEqual([]);
  });

  it('checks the ORN is the RERA number', () => {
    expect(companyIssues({ ...full, orn: 'ORN-12345' }, TODAY).join(' ')).toMatch(/ORN/);
  });

  it('warns a month before the licence expires', () => {
    expect(companyIssues({ ...full, licenceExpiry: '2026-03-20' }, TODAY).join(' ')).toMatch(/expires in 16 days/);
    expect(companyIssues({ ...full, licenceExpiry: '2026-03-05' }, TODAY).join(' ')).toMatch(/expires in 1 day\b/);
  });

  it('says plainly when it has already expired', () => {
    expect(companyIssues({ ...full, licenceExpiry: '2026-03-01' }, TODAY).join(' ')).toMatch(/expired 3 days ago/);
    expect(companyIssues({ ...full, licenceExpiry: '2026-03-03' }, TODAY).join(' ')).toMatch(/expired 1 day ago/);
  });

  it('says nothing about a licence that is months away', () => {
    expect(companyIssues({ ...full, licenceExpiry: '2026-12-31' }, TODAY)).toEqual([]);
  });

  it('rejects a date it cannot read rather than guessing at it', () => {
    expect(companyIssues({ ...full, licenceExpiry: '1 Jan 2027' }, TODAY).join(' ')).toMatch(/not a date/);
  });

  it('checks the obvious shape of an email, a website and a number', () => {
    expect(companyIssues({ ...full, email: 'hello' }, TODAY).join(' ')).toMatch(/email/);
    expect(companyIssues({ ...full, website: 'homes.me' }, TODAY).join(' ')).toMatch(/https/);
    expect(companyIssues({ ...full, phone: '04 123 4567' }, TODAY).join(' ')).toMatch(/\+971/);
    expect(companyIssues({ ...full, whatsapp: '0501234567' }, TODAY).join(' ')).toMatch(/\+971/);
  });

  it('catches a name too long for a WhatsApp footer, where it is typed', () => {
    const issues = companyIssues({ ...full, tradingName: 'A Very Long Brokerage Name Indeed Limited LLC' }, TODAY);
    expect(issues.join(' ')).toMatch(/WhatsApp allows 60/);
  });

  it('measures the Arabic footer too, which is the longer one', () => {
    const issues = companyIssues(
      { ...full, tradingName: 'Brokerage', localityAr: 'ا'.repeat(60) },
      TODAY,
    );
    expect(issues.join(' ')).toMatch(/WhatsApp allows 60/);
  });

  it('mentions the missing logo, because it changes what a client sees', () => {
    expect(companyIssues({ ...full, logoUrl: '' }, TODAY).join(' ')).toMatch(/logo/);
  });

  it('writes every issue in plain English, with no field names in it', () => {
    const all = companyIssues(details(), TODAY);
    expect(all.length).toBeGreaterThan(0);
    for (const issue of all) {
      expect(issue).not.toMatch(/[a-z][A-Z]/); // no camelCase field names
      expect(issue).toMatch(/[.!]$/);
    }
  });
});

describe('the rename warning', () => {
  it('says what changing the name does not change', () => {
    expect(RENAME_WARNING).toMatch(/approved/i);
    expect(RENAME_WARNING).toMatch(/footer/i);
    expect(RENAME_WARNING).toMatch(/submit/i);
  });
});
