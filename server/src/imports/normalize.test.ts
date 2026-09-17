import { describe, expect, it } from 'vitest';
import { defaultSettings, mapRow, parseDate, rowToLead, type ImportSettings } from './normalize.js';
import type { ColumnMapping } from './mapping.js';

const HEADERS = ['Name', 'Mobile', 'Email', 'Project', 'Budget'];
const MAPPING: ColumnMapping = {
  Name: 'fullName',
  Mobile: 'phone',
  Email: 'email',
  Project: 'projectName',
  Budget: 'budgetBand',
};

const settings = (extra: Partial<ImportSettings> = {}): ImportSettings => ({
  ...defaultSettings(),
  sourceLabel: 'Expo 2026',
  ...extra,
});

function normalize(values: string[], extra: Partial<ImportSettings> = {}) {
  const { mapped, unmapped } = mapRow(HEADERS, values, MAPPING);
  return rowToLead(mapped, unmapped, settings(extra), 2);
}

describe('mapRow', () => {
  it('keys values by the field their column maps to', () => {
    const { mapped } = mapRow(HEADERS, ['Sara', '0501234567', '', 'Emaar', ''], MAPPING);
    expect(mapped).toEqual({ fullName: 'Sara', phone: '0501234567', projectName: 'Emaar' });
  });

  it('keeps unmapped columns instead of dropping them', () => {
    // An unmapped answer is still something the lead told us.
    const { unmapped } = mapRow(
      ['Name', 'Ref'],
      ['Sara', 'ABC-1'],
      { Name: 'fullName', Ref: null },
    );
    expect(unmapped).toEqual({ Ref: 'ABC-1' });
  });

  it('does not let a second column overwrite the first', () => {
    const { mapped, unmapped } = mapRow(
      ['Phone', 'Phone2'],
      ['0501111111', '0502222222'],
      { Phone: 'phone', Phone2: 'phone' },
    );
    expect(mapped.phone).toBe('0501111111');
    expect(unmapped.Phone2).toBe('0502222222');
  });

  it('ignores blank cells', () => {
    const { mapped } = mapRow(HEADERS, ['Sara', '   ', '', '', ''], MAPPING);
    expect(mapped.phone).toBeUndefined();
  });
});

describe('rowToLead', () => {
  it('normalises a UAE mobile into E.164', () => {
    const result = normalize(['Sara Ahmed', '050 123 4567', '', 'Emaar Beachfront', '']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.person.phoneE164).toBe('+971501234567');
  });

  it('lowercases the email', () => {
    const result = normalize(['Sara', '0501234567', 'Sara.A@Example.COM', '', '']);
    expect(result.ok && result.lead.person.email).toBe('sara.a@example.com');
  });

  it('parses a budget band into numbers', () => {
    const result = normalize(['Sara', '0501234567', '', '', 'AED 1,500,000 - 2,500,000']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.realEstate.budgetMinAed).toBe(1_500_000);
    expect(result.lead.realEstate.budgetMaxAed).toBe(2_500_000);
  });

  it('rejects a row with no way to contact the person', () => {
    const result = normalize(['Sara', '', '', 'Emaar', '']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no email/i);
  });

  it('names the bad value when a phone number will not parse', () => {
    // "not a valid phone number" with no number in it is useless when you are
    // fixing four hundred rows.
    const result = normalize(['Sara', 'call the office', '', '', '']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('call the office');
  });

  it('accepts an email-only row', () => {
    const result = normalize(['Sara', '', 'sara@example.com', '', '']);
    expect(result.ok).toBe(true);
  });

  it('catches a header row pasted in as data', () => {
    const result = normalize(['Name', '0501234567', '', '', '']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/header/i);
  });

  it('dedupes on the phone number, which two people never share', () => {
    const result = normalize(['Sara', '0501234567', 'shared@family.com', '', '']);
    expect(result.ok && result.dedupeKey).toBe('+971501234567');
  });

  it('falls back to the email when there is no phone', () => {
    const result = normalize(['Sara', '', 'sara@example.com', '', '']);
    expect(result.ok && result.dedupeKey).toBe('email:sara@example.com');
  });

  it('applies the import-wide project when the row has none', () => {
    const result = normalize(['Sara', '0501234567', '', '', ''], { projectName: 'Damac Lagoons' });
    expect(result.ok && result.lead.realEstate.projectName).toBe('Damac Lagoons');
  });

  it('lets a row override the import-wide project', () => {
    const result = normalize(['Sara', '0501234567', '', 'Emaar Beachfront', ''], { projectName: 'Damac Lagoons' });
    expect(result.ok && result.lead.realEstate.projectName).toBe('Emaar Beachfront');
  });
});

describe('consent', () => {
  it('grants nothing when consent is unknown', () => {
    // An import cannot manufacture consent that was never given.
    const result = normalize(['Sara', '0501234567', '', '', ''], { consent: 'unknown' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.consent.whatsapp).toBe(false);
    expect(result.lead.consent.text).toBeNull();
  });

  it('grants nothing when consent is explicitly absent', () => {
    const result = normalize(['Sara', '0501234567', '', '', ''], { consent: 'none' });
    expect(result.ok && result.lead.consent.whatsapp).toBe(false);
  });

  it('records the wording when the owner confirms an opt-in', () => {
    // UAE PDPL: we must be able to show what the person agreed to.
    const result = normalize(['Sara', '0501234567', '', '', ''], { consent: 'opted_in' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.consent.whatsapp).toBe(true);
    expect(result.lead.consent.text).toContain('Expo 2026');
  });
});

describe('parseDate', () => {
  it('reads ISO dates', () => {
    expect(parseDate('2026-03-04')?.toISOString().slice(0, 10)).toBe('2026-03-04');
  });

  it('reads day-first dates, as the UAE writes them', () => {
    // Guessing month-first turns 3 April into 4 March and nobody notices.
    expect(parseDate('04/03/2026')?.toISOString().slice(0, 10)).toBe('2026-03-04');
  });

  it('expands a two-digit year', () => {
    expect(parseDate('04/03/26')?.getUTCFullYear()).toBe(2026);
  });

  it('returns null rather than guessing at nonsense', () => {
    expect(parseDate('sometime last year')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });

  it('rejects an impossible day', () => {
    expect(parseDate('45/03/2026')).toBeNull();
  });
});

describe('ragged files, where the columns shift partway through', () => {
  const settings = { ...defaultSettings(), phoneRegion: 'PT' };

  /*
   * A real 535-lead export turned out to be several Meta forms stacked
   * together, each asking different questions. The column holding a phone in
   * one block held a name in the next, so 152 reachable leads were rejected
   * with `"Angie Sandridge" is not a valid phone number`.
   */
  it('finds the number one column over when the mapped column holds a name', () => {
    const outcome = rowToLead(
      { phone: 'Angie Sandridge', fullName: 'Angie Sandridge' },
      { 'Column 8': 'p:+351939768966', 'Column 9': '939 768 966' },
      settings,
      42,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.lead.person.phoneE164).toBe('+351939768966');
  });

  it('finds an email that was never mapped', () => {
    const outcome = rowToLead(
      { fullName: 'Sara Ahmed' },
      { 'Column 4': 'sara@example.ae' },
      settings,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.lead.person.email).toBe('sara@example.ae');
  });

  it('will not mistake a budget for a number to call', () => {
    // The whole risk of looking in other columns: inventing a phone number out
    // of an id, a year or a price. libphonenumber has to accept it as real.
    const outcome = rowToLead(
      { phone: 'not a number' },
      { 'Column 3': '2500000', 'Column 4': '2026', 'Column 5': '12' },
      settings,
      7,
    );
    expect(outcome.ok).toBe(false);
  });

  it('still says which value failed when nothing can be found', () => {
    const outcome = rowToLead({ phone: 'Wayne' }, { 'Column 3': 'ig' }, settings, 9);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('"Wayne"');
  });

  it('prefers the mapped column when it is perfectly good', () => {
    const outcome = rowToLead(
      { phone: '934 741 207' },
      { 'Column 9': '+351999999999' },
      settings,
      2,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.lead.person.phoneE164).toBe('+351934741207');
  });

  it('rejects a row with nothing to reach anyone by', () => {
    const outcome = rowToLead({ fullName: 'Someone' }, { 'Column 3': 'ig' }, settings, 3);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/No phone number and no email/);
  });
});
