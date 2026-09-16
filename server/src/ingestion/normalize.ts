import { normalizeEmail } from '../lib/email.js';
import { parsePhone } from '../lib/phone.js';
import {
  emptyLead,
  type LeadAttribution,
  type LeadDTO,
  type LeadSource,
} from './dto.js';
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

export type NormalizeInput = {
  source: LeadSource;
  externalId: string;
  receivedAt?: Date;
  /** CRM field name → value, produced by applyFieldMap. */
  mapped: Record<string, string>;
  unmapped?: Record<string, string>;
  attribution?: Partial<LeadAttribution>;
  consent?: { whatsapp?: boolean; email?: boolean; sms?: boolean; text?: string | null };
  notes?: string | null;
  /** Default region for phone parsing; AE unless the source knows better. */
  phoneRegion?: string;
};

/**
 * Turn mapped form answers into the canonical Lead DTO: phone numbers into
 * E.164, emails lowercased, free text into CRM enums.
 */
export function normalizeLead(input: NormalizeInput): LeadDTO {
  const lead = emptyLead(input.source, input.externalId);
  lead.receivedAt = input.receivedAt ?? new Date();
  lead.unmapped = input.unmapped ?? {};

  const f = input.mapped;

  // --- person ---------------------------------------------------------------
  const fullName = cleanText(f.full_name, 200);
  const firstFromField = cleanText(f.first_name, 100);
  const lastFromField = cleanText(f.last_name, 100);
  const split = splitName(fullName);

  lead.person.firstName = firstFromField ?? split.first;
  lead.person.lastName = lastFromField ?? split.last;
  lead.person.fullName = fullName ?? joinName(lead.person.firstName, lead.person.lastName);

  const phoneRaw = cleanText(f.phone, 64);
  lead.person.phoneRaw = phoneRaw;
  if (phoneRaw) {
    const parsed = parsePhone(phoneRaw, input.phoneRegion);
    lead.person.phoneE164 = parsed.e164;
    lead.person.waId = parsed.waId;
    lead.person.country = parsed.country;
  }

  lead.person.email = normalizeEmail(f.email);
  lead.person.city = cleanText(f.city, 120);
  lead.person.country = cleanText(f.country, 8) ?? lead.person.country;

  const declaredLanguage = cleanText(f.language, 8)?.toLowerCase();
  lead.person.language =
    (declaredLanguage === 'ar' || declaredLanguage === 'en' ? declaredLanguage : null) ??
    detectLanguage(fullName, f.notes, f.preferred_location) ??
    null;

  // --- real estate ----------------------------------------------------------
  lead.realEstate.projectName = cleanText(f.project, 160);
  lead.realEstate.developer = cleanText(f.developer, 160);
  lead.realEstate.emirate = parseEmirate(f.emirate ?? f.preferred_location ?? f.city);
  lead.realEstate.preferredLocation = cleanText(f.preferred_location, 160);
  lead.realEstate.unitType = cleanText(f.unit_type, 64);
  lead.realEstate.budgetBand = cleanText(f.budget_band, 120);
  lead.realEstate.purpose = parsePurpose(f.purpose);
  lead.realEstate.paymentMethod = parsePaymentMethod(f.payment_method);
  lead.realEstate.timeline = parseTimeline(f.timeline);
  lead.realEstate.goldenVisaInterest = parseBoolean(f.golden_visa);

  const explicitMin = toPositiveInt(f.budget_min);
  const explicitMax = toPositiveInt(f.budget_max);
  const band = parseBudgetBand(f.budget_band);
  lead.realEstate.budgetMinAed = explicitMin ?? band.min;
  lead.realEstate.budgetMaxAed = explicitMax ?? band.max;
  // A range that arrives back to front is still a range.
  if (
    lead.realEstate.budgetMinAed !== null &&
    lead.realEstate.budgetMaxAed !== null &&
    lead.realEstate.budgetMinAed > lead.realEstate.budgetMaxAed
  ) {
    const min = lead.realEstate.budgetMaxAed;
    lead.realEstate.budgetMaxAed = lead.realEstate.budgetMinAed;
    lead.realEstate.budgetMinAed = min;
  }

  // --- attribution ----------------------------------------------------------
  lead.attribution = { ...lead.attribution, ...stripUndefined(input.attribution ?? {}) };

  // --- consent --------------------------------------------------------------
  lead.consent = {
    whatsapp: input.consent?.whatsapp ?? false,
    email: input.consent?.email ?? false,
    sms: input.consent?.sms ?? false,
    text: input.consent?.text ?? cleanText(f.consent_text, 2000) ?? null,
  };

  // --- notes ----------------------------------------------------------------
  const unmappedNote = Object.entries(lead.unmapped)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  lead.notes =
    [cleanText(input.notes, 2000), cleanText(f.notes, 2000), unmappedNote || null].filter(Boolean).join('\n') || null;

  return lead;
}

function toPositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k as keyof T] = v as T[keyof T];
  }
  return out;
}
