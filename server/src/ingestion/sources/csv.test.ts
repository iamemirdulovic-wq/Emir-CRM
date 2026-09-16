import { describe, expect, it } from 'vitest';
import { normalizeCsvLead, normalizeCsvRow, parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('parses a simple file', () => {
    const rows = parseCsv('Name,Phone,Email\nSara,0501234567,sara@example.com\nOmar,0559876543,omar@example.com');
    expect(rows).toEqual([
      { Name: 'Sara', Phone: '0501234567', Email: 'sara@example.com' },
      { Name: 'Omar', Phone: '0559876543', Email: 'omar@example.com' },
    ]);
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    const rows = parseCsv('Name,Notes\n"Al Mansoori, Sara","Said ""call me after 6"" twice"');
    expect(rows[0]).toEqual({ Name: 'Al Mansoori, Sara', Notes: 'Said "call me after 6" twice' });
  });

  it('handles embedded newlines inside quotes', () => {
    const rows = parseCsv('Name,Notes\nSara,"line one\nline two"');
    expect(rows[0]?.Notes).toBe('line one\nline two');
  });

  it('handles CRLF line endings and a BOM', () => {
    const rows = parseCsv('﻿Name,Phone\r\nSara,0501234567\r\n');
    expect(rows).toEqual([{ Name: 'Sara', Phone: '0501234567' }]);
  });

  it('skips blank lines', () => {
    const rows = parseCsv('Name,Phone\nSara,0501234567\n\nOmar,0559876543\n');
    expect(rows).toHaveLength(2);
  });

  it('returns an empty list for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('normalizeCsvRow', () => {
  it('maps common spreadsheet headers onto CRM fields', () => {
    expect(
      normalizeCsvRow({ 'Full Name': 'Sara', 'Mobile Number': '0501234567', 'Budget Range': '1M-2M', Comments: 'hot' }),
    ).toEqual({ full_name: 'Sara', phone: '0501234567', budget_band: '1M-2M', notes: 'hot' });
  });

  it('drops empty cells', () => {
    expect(normalizeCsvRow({ Name: 'Sara', Phone: '   ', Email: '' })).toEqual({ full_name: 'Sara' });
  });
});

describe('normalizeCsvLead', () => {
  it('produces a normalized lead with a stable external id', () => {
    const row = { 'Full Name': 'Sara Al Mansoori', Mobile: '050 123 4567', Email: 'SARA@Example.com', Budget: '1M - 2M' };
    const a = normalizeCsvLead(row, 0, { batchId: 'batch-1' });
    const b = normalizeCsvLead(row, 0, { batchId: 'batch-1' });

    expect(a.externalId).toBe(b.externalId);
    expect(a.person.phoneE164).toBe('+971501234567');
    expect(a.person.email).toBe('sara@example.com');
    expect(a.realEstate.budgetMinAed).toBe(1_000_000);
    expect(a.realEstate.budgetMaxAed).toBe(2_000_000);
    expect(a.source).toBe('csv_import');
  });

  it('gives different rows different ids', () => {
    const row = { Name: 'Sara', Phone: '0501234567' };
    expect(normalizeCsvLead(row, 0, { batchId: 'b' }).externalId).not.toBe(
      normalizeCsvLead(row, 1, { batchId: 'b' }).externalId,
    );
  });

  it('defaults to no consent for an uploaded list', () => {
    const lead = normalizeCsvLead({ Name: 'Sara', Phone: '0501234567' }, 0, { batchId: 'b' });
    expect(lead.consent).toEqual({ whatsapp: false, email: false, sms: false, text: null });
  });
});
