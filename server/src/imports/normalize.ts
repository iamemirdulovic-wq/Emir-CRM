/**
 * Turning one spreadsheet row into a lead.
 *
 * The row is mapped onto CRM field names and then handed to the same
 * `normalizeLead` every webhook goes through, so an imported phone number is
 * cleaned by exactly the rules a Meta lead's is. Step 3 of the wizard —
 * "phones normalised to E.164, emails lowercased" — is that function, not a
 * second implementation of it.
 *
 * Pure: no database, no clock beyond the one passed in.
 */
import { normalizeEmail } from '../lib/email.js';
import { parsePhone } from '../lib/phone.js';
import { findName, notAName } from './names.js';
import { normalizeLead } from '../ingestion/normalize.js';
import type { LeadDTO, LeadSource } from '../ingestion/dto.js';
import type { ColumnMapping, ImportField } from './mapping.js';

export type ConsentStatus = 'opted_in' | 'unknown' | 'none';
export type DuplicateStrategy = 'skip' | 'fill_empty' | 'create_anyway';

export interface ImportSettings {
  /** Free text the owner types, e.g. "Import – Expo 2026". Stored as a tag. */
  sourceLabel: string;
  /** The LEAD_SOURCES value the opportunity gets. */
  source: LeadSource;
  tags: string[];
  projectName: string | null;
  pipelineKey: string;
  stageKey: string;
  consent: ConsentStatus;
  duplicateStrategy: DuplicateStrategy;
  /** Default region for phone parsing. UAE unless the file says otherwise. */
  phoneRegion: string;
}

export function defaultSettings(): ImportSettings {
  return {
    sourceLabel: 'Import',
    source: 'csv_import',
    tags: [],
    projectName: null,
    pipelineKey: 'sales',
    stageKey: 'new_lead',
    // The safe default. An unknown consent status means no automated message
    // may go out, which is what the UAE PDPL rules require of us.
    consent: 'unknown',
    duplicateStrategy: 'fill_empty',
    phoneRegion: 'AE',
  };
}

/** header -> value for one row, keyed by the CRM field the column maps to. */
export function mapRow(
  headers: string[],
  values: string[],
  mapping: ColumnMapping,
): { mapped: Partial<Record<ImportField, string>>; unmapped: Record<string, string> } {
  const mapped: Partial<Record<ImportField, string>> = {};
  const unmapped: Record<string, string> = {};

  headers.forEach((header, index) => {
    const value = (values[index] ?? '').trim();
    if (!value) return;
    const field = mapping[header];
    if (field) {
      // Two columns mapped to one field would silently lose data; the first
      // non-empty wins and the rest are kept as unmapped answers.
      if (mapped[field] === undefined) mapped[field] = value;
      else unmapped[header] = value;
    } else {
      unmapped[header] = value;
    }
  });

  return { mapped, unmapped };
}

export type RowOutcome =
  | { ok: true; lead: LeadDTO; dedupeKey: string | null }
  | { ok: false; reason: string };

/** Anything that is obviously not a real name, so a header row pasted twice is caught. */
/*
 * Superseded by `notAName`, which knows about form answers in six languages,
 * digits, sentences and keyboard mashing. Kept only as the one case that means
 * the *file* is wrong rather than the row: a literal header repeated mid-file.
 */
const SECOND_HEADER_ROW = new Set(['name', 'full name', 'fullname', 'first name', 'last name']);

/**
 * Validates and normalizes one row.
 *
 * A lead with neither a usable phone nor an email cannot be contacted, so it is
 * rejected with a reason rather than imported as an unreachable record — the
 * user gets it back in the failed-rows CSV to fix and re-upload.
 */
/**
 * The first value in the unmapped columns that is a real phone number.
 *
 * Deliberately strict: `parsePhone` has to accept it for the import's region,
 * so a budget, a row id or a year cannot be mistaken for a number to call.
 */
function findPhone(unmapped: Record<string, string>, region: string): string | null {
  for (const value of Object.values(unmapped)) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    // Meta writes the same number again prefixed; the prefix is not part of it.
    const candidate = trimmed.replace(/^p:/i, '').trim();
    const parsed = parsePhone(candidate, region);
    if (parsed.e164) return parsed.e164;
  }
  return null;
}

/** The first value in the unmapped columns that is a real email address. */
function findEmail(unmapped: Record<string, string>): string | null {
  for (const value of Object.values(unmapped)) {
    const normalized = normalizeEmail(value ?? null);
    if (normalized) return normalized;
  }
  return null;
}

/** Keep a row's own notes and anything rescued from the name column. */
function joinNotes(notes: string | null, salvaged: string | null): string | null {
  if (!salvaged) return notes;
  const rescued = `Form answer (was in the name column): ${salvaged}`;
  return notes ? `${notes}\n${rescued}` : rescued;
}

export function rowToLead(
  mapped: Partial<Record<ImportField, string>>,
  unmapped: Record<string, string>,
  settings: ImportSettings,
  lineNumber: number,
  now: Date = new Date(),
): RowOutcome {
  const phoneRaw = mapped.phone ?? mapped.altPhone ?? null;
  const email = normalizeEmail(mapped.email ?? null) ?? findEmail(unmapped);

  let phoneE164: string | null = null;
  if (phoneRaw) {
    const parsed = parsePhone(phoneRaw, settings.phoneRegion);
    phoneE164 = parsed.e164;
  }

  /*
   * Real exports are ragged. A file is often several Meta forms stacked
   * together, each asking different questions, so the column holding a phone in
   * one block holds a name in the next — and a row whose phone column says
   * "Angie Sandridge" is a lead we can still reach, if the number is sitting one
   * column over.
   *
   * So when the mapped column yields nothing usable, look through the columns
   * nobody mapped. Only a value libphonenumber accepts as a real number for the
   * chosen region is taken, which is what keeps this from inventing numbers out
   * of ids and budgets.
   */
  if (!phoneE164) {
    phoneE164 = findPhone(unmapped, settings.phoneRegion);
  }

  if (!phoneE164 && phoneRaw && !email) {
    // Be explicit about which value failed: "not a valid phone number" with
    // no number in it is useless when you are fixing four hundred rows.
    return { ok: false, reason: `"${phoneRaw}" is not a valid phone number` };
  }

  if (!phoneE164 && !email) {
    return { ok: false, reason: 'No phone number and no email address' };
  }

  /*
   * The name column, checked value by value rather than trusted because the
   * column was chosen once.
   *
   * A Meta export stacked out of several forms holds a name in this column for
   * one block of rows and an answer to a question in the next — "2pm / 6pm",
   * "24 horas", "I am on holiday till 25.05". The row is still a reachable
   * person, so it is never rejected over this; the name is simply not used, the
   * answer is kept in the notes where it belongs, and the inbox falls back to
   * showing the phone number, which is what the agent needs to call them.
   */
  const rawName = (mapped.fullName ?? '').trim();
  if (rawName && SECOND_HEADER_ROW.has(rawName.toLowerCase())) {
    return { ok: false, reason: `"${rawName}" is not a name — is this a second header row?` };
  }

  const nameProblem = rawName ? notAName(rawName) : 'empty';
  // Only look sideways when the mapped column let us down.
  const name = nameProblem === false ? rawName : findName(unmapped);
  const salvagedAnswer = nameProblem === false || !rawName ? null : rawName;

  const createdAt = parseDate(mapped.createdAt);

  const lead = normalizeLead({
    source: settings.source,
    // Stable and unique per row, so replaying the same import is idempotent
    // at the inbound-event layer as well as the identity layer.
    externalId: `import:${settings.sourceLabel}:${lineNumber}:${phoneE164 ?? email ?? lineNumber}`,
    // A date in the file is what the lead's history says; anything in the
    // future, or unreadable, falls back to now and normalizeLead clamps it.
    ...(createdAt ? { receivedAt: createdAt } : {}),
    phoneRegion: settings.phoneRegion,
    // The keys are the ones normalizeLead reads; see ingestion/normalize.ts.
    mapped: {
      ...(name ? { full_name: name } : {}),
      ...(mapped.firstName ? { first_name: mapped.firstName } : {}),
      ...(mapped.lastName ? { last_name: mapped.lastName } : {}),
      /*
       * The resolved values, not the raw ones. When the mapped column held a
       * name and the number was found one column over, passing `phoneRaw` here
       * would create the contact with no phone at all — reachable in principle,
       * unreachable in fact, and silent about it.
       */
      ...(phoneE164 ?? phoneRaw ? { phone: (phoneE164 ?? phoneRaw) as string } : {}),
      ...(email ? { email } : {}),
      ...(mapped.language ? { language: mapped.language } : {}),
      ...(mapped.projectName ?? settings.projectName
        ? { project: mapped.projectName ?? (settings.projectName as string) }
        : {}),
      ...(mapped.developer ? { developer: mapped.developer } : {}),
      ...(mapped.emirate ? { emirate: mapped.emirate } : {}),
      ...(mapped.preferredLocation ? { preferred_location: mapped.preferredLocation } : {}),
      ...(mapped.unitType ? { unit_type: mapped.unitType } : {}),
      ...(mapped.budgetBand ? { budget_band: mapped.budgetBand } : {}),
      ...(mapped.budgetMinAed ? { budget_min: mapped.budgetMinAed } : {}),
      ...(mapped.budgetMaxAed ? { budget_max: mapped.budgetMaxAed } : {}),
      ...(mapped.purpose ? { purpose: mapped.purpose } : {}),
      ...(mapped.paymentMethod ? { payment_method: mapped.paymentMethod } : {}),
      ...(mapped.timeline ? { timeline: mapped.timeline } : {}),
      ...(mapped.goldenVisaInterest ? { golden_visa: mapped.goldenVisaInterest } : {}),
    },
    unmapped,
    ...(mapped.campaignName ? { attribution: { campaignName: mapped.campaignName } } : {}),
    consent: consentFor(settings, now),
    /*
     * The discarded value is appended rather than dropped. "I am on holiday
     * till 25.05, 9am to 8pm Cyprus time" is not a name, but it is the single
     * most useful thing in the row for whoever has to ring this person.
     */
    notes: joinNotes(mapped.notes ?? null, salvagedAnswer),
  });

  return {
    ok: true,
    lead,
    // What "the same person twice in this file" means. Phone first, because
    // two family members often share an email but never a mobile.
    dedupeKey: phoneE164 ?? (email ? `email:${email}` : null),
  };
}

/**
 * Consent for an imported contact.
 *
 * Only "opted_in" grants anything, and the wording is recorded because the UAE
 * PDPL requires us to be able to show what the person agreed to. An import
 * cannot manufacture consent that was never given, so "unknown" and "none"
 * both grant nothing — the difference is what we tell the user later.
 */
function consentFor(settings: ImportSettings, now: Date): {
  whatsapp: boolean;
  email: boolean;
  sms: boolean;
  text: string | null;
} {
  if (settings.consent !== 'opted_in') {
    return { whatsapp: false, email: false, sms: false, text: null };
  }
  return {
    whatsapp: true,
    email: true,
    sms: false,
    text:
      `Consent recorded at import from "${settings.sourceLabel}" on ` +
      `${now.toISOString().slice(0, 10)}. The importing user confirmed these contacts had ` +
      'previously agreed to be contacted about property offers.',
  };
}

/** Dates as spreadsheets write them. Returns null rather than guessing badly. */
export function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const text = value.trim();

  // ISO, or anything Date understands unambiguously.
  const iso = /^\d{4}-\d{2}-\d{2}/.test(text) ? new Date(text) : null;
  if (iso && !Number.isNaN(iso.getTime())) return iso;

  // d/m/y and d-m-y, which is how the UAE writes dates. Never m/d/y: guessing
  // wrong turns 3 April into 4 March and nobody notices for a month.
  const parts = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (parts) {
    const day = Number(parts[1]);
    const month = Number(parts[2]);
    let year = Number(parts[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const date = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(date.getTime())) return date;
    }
  }

  const loose = new Date(text);
  return Number.isNaN(loose.getTime()) ? null : loose;
}
