/**
 * The canonical Lead DTO. Every source normalizes into exactly this shape
 * before identity resolution sees it.
 */

export const LEAD_SOURCES = [
  'meta_lead_ads',
  'meta_ctwa',
  'whatsapp_direct',
  'website',
  'google_ads',
  'csv_import',
  'manual',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export type Purpose = 'investment' | 'end_use' | 'unknown';
export type PaymentMethod = 'cash' | 'mortgage' | 'payment_plan' | 'unknown';
export type Timeline = 'immediate' | '1_3_months' | '3_6_months' | '6_12_months' | '12_plus' | 'unknown';
export type Emirate =
  | 'dubai'
  | 'abu_dhabi'
  | 'sharjah'
  | 'ras_al_khaimah'
  | 'ajman'
  | 'fujairah'
  | 'umm_al_quwain'
  | 'other';

export type LeadPerson = {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Exactly as it arrived, for the audit trail. */
  phoneRaw: string | null;
  phoneE164: string | null;
  waId: string | null;
  email: string | null;
  language: string | null;
  country: string | null;
  city: string | null;
};

export type LeadRealEstate = {
  projectName: string | null;
  developer: string | null;
  emirate: Emirate | null;
  preferredLocation: string | null;
  unitType: string | null;
  budgetMinAed: number | null;
  budgetMaxAed: number | null;
  /** The band exactly as the lead chose it, e.g. "AED 1M – 2M". */
  budgetBand: string | null;
  purpose: Purpose;
  paymentMethod: PaymentMethod;
  timeline: Timeline;
  goldenVisaInterest: boolean;
};

export type LeadAttribution = {
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  formId: string | null;
  formName: string | null;
  metaLeadId: string | null;
  ctwaClid: string | null;
  gclid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  landingPage: string | null;
  referrer: string | null;
  fbp: string | null;
  fbc: string | null;
  clientIp: string | null;
  clientUserAgent: string | null;
};

export type LeadConsent = {
  whatsapp: boolean;
  email: boolean;
  sms: boolean;
  /** UAE PDPL: the exact wording the lead agreed to. */
  text: string | null;
};

export type LeadDTO = {
  source: LeadSource;
  /** Stable per-source identifier. Idempotency hangs off this. */
  externalId: string;
  receivedAt: Date;
  person: LeadPerson;
  realEstate: LeadRealEstate;
  attribution: LeadAttribution;
  consent: LeadConsent;
  notes: string | null;
  /** Questions with no mapping yet — surfaced to admins, never dropped. */
  unmapped: Record<string, string>;
};

export function emptyPerson(): LeadPerson {
  return {
    fullName: null,
    firstName: null,
    lastName: null,
    phoneRaw: null,
    phoneE164: null,
    waId: null,
    email: null,
    language: null,
    country: null,
    city: null,
  };
}

export function emptyRealEstate(): LeadRealEstate {
  return {
    projectName: null,
    developer: null,
    emirate: null,
    preferredLocation: null,
    unitType: null,
    budgetMinAed: null,
    budgetMaxAed: null,
    budgetBand: null,
    purpose: 'unknown',
    paymentMethod: 'unknown',
    timeline: 'unknown',
    goldenVisaInterest: false,
  };
}

export function emptyAttribution(): LeadAttribution {
  return {
    campaignId: null,
    campaignName: null,
    adsetId: null,
    adsetName: null,
    adId: null,
    adName: null,
    formId: null,
    formName: null,
    metaLeadId: null,
    ctwaClid: null,
    gclid: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
    landingPage: null,
    referrer: null,
    fbp: null,
    fbc: null,
    clientIp: null,
    clientUserAgent: null,
  };
}

export function emptyLead(source: LeadSource, externalId: string): LeadDTO {
  return {
    source,
    externalId,
    receivedAt: new Date(),
    person: emptyPerson(),
    realEstate: emptyRealEstate(),
    attribution: emptyAttribution(),
    consent: { whatsapp: false, email: false, sms: false, text: null },
    notes: null,
    unmapped: {},
  };
}

/** A lead we can actually work: it needs at least one reachable identifier. */
export function isContactable(lead: LeadDTO): boolean {
  return Boolean(lead.person.phoneE164 || lead.person.waId || lead.person.email);
}
