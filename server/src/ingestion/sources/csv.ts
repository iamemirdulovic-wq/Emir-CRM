import { createHash } from 'node:crypto';
import { normalizeLead } from '../normalize.js';
import type { LeadDTO } from '../dto.js';

/**
 * CSV upload and manual entry. Parsing is deliberately dependency-free and
 * RFC 4180 compliant enough for the exports agents actually paste in
 * (quoted fields, embedded commas, embedded newlines, escaped quotes).
 */

export function parseCsv(text: string): Array<Record<string, string>> {
  const rows = parseRows(text.replace(/^﻿/, ''));
  if (rows.length === 0) return [];

  const header = (rows[0] ?? []).map((h) => h.trim());
  const out: Array<Record<string, string>> = [];

  for (const row of rows.slice(1)) {
    if (row.length === 1 && (row[0] ?? '').trim() === '') continue; // blank line
    const record: Record<string, string> = {};
    header.forEach((key, i) => {
      if (!key) return;
      record[key] = (row[i] ?? '').trim();
    });
    out.push(record);
  }
  return out;
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const HEADER_ALIASES: Record<string, string> = {
  name: 'full_name',
  'full name': 'full_name',
  fullname: 'full_name',
  'first name': 'first_name',
  firstname: 'first_name',
  'last name': 'last_name',
  lastname: 'last_name',
  mobile: 'phone',
  'phone number': 'phone',
  'mobile number': 'phone',
  whatsapp: 'phone',
  'e-mail': 'email',
  'email address': 'email',
  budget: 'budget_band',
  'budget range': 'budget_band',
  'unit type': 'unit_type',
  bedrooms: 'unit_type',
  'project name': 'project',
  interest: 'project',
  location: 'preferred_location',
  area: 'preferred_location',
  'golden visa': 'golden_visa',
  comments: 'notes',
  note: 'notes',
  notes: 'notes',
  message: 'notes',
};

/** Map loose spreadsheet headers onto CRM field names. */
export function normalizeCsvRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(row)) {
    if (!value || !value.trim()) continue;
    const key = rawKey.toLowerCase().trim();
    const mapped = HEADER_ALIASES[key] ?? key.replace(/\s+/g, '_');
    if (out[mapped] === undefined) out[mapped] = value.trim();
  }
  return out;
}

export type CsvImportOptions = {
  /** Distinguishes one upload from another so re-uploading the same file is idempotent. */
  batchId: string;
  source?: 'csv_import' | 'manual';
  consent?: { whatsapp: boolean; email: boolean; sms: boolean; text: string | null };
};

export function normalizeCsvLead(row: Record<string, string>, rowIndex: number, opts: CsvImportOptions): LeadDTO {
  const mapped = normalizeCsvRow(row);
  const identity = [opts.batchId, mapped.phone ?? '', mapped.email ?? '', String(rowIndex)].join('|');
  const externalId = `csv_${createHash('sha256').update(identity).digest('hex').slice(0, 40)}`;

  const known = new Set([
    'full_name', 'first_name', 'last_name', 'phone', 'email', 'city', 'country', 'language',
    'project', 'developer', 'emirate', 'preferred_location', 'unit_type', 'budget_band',
    'budget_min', 'budget_max', 'purpose', 'payment_method', 'timeline', 'golden_visa', 'notes',
  ]);
  const unmapped = Object.fromEntries(Object.entries(mapped).filter(([k]) => !known.has(k)));

  return normalizeLead({
    source: opts.source ?? 'csv_import',
    externalId,
    mapped,
    unmapped,
    // An uploaded list carries no proof of consent unless the importer declares it.
    consent: opts.consent ?? { whatsapp: false, email: false, sms: false, text: null },
  });
}
