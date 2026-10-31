import { COMPANY_LOCALITY_AR, COMPANY_LOCALITY_EN, COMPANY_NAME } from './constants.js';
import { setting } from './secrets.js';

/**
 * The company, as it introduces itself to a client.
 *
 * It used to be three constants in `constants.ts`, with a comment saying they
 * belonged in Settings beside the TRN and the ORN. This is that. The constants
 * remain as the defaults, so a database with nothing saved behaves exactly as
 * it did before, and an owner who renames the company does not need a
 * developer.
 *
 * Everything here reaches a client — the WhatsApp footer, the signature on
 * every follow-up email, the business card, the offer letterhead — which is
 * why it is one record read from one place rather than a string written out
 * in nine files that drift apart.
 */

export interface CompanyDetails {
  /** As registered. This is the one that goes on an offer and an invoice. */
  legalName: string;
  /** What people actually call us, if that differs. Used in conversation. */
  tradingName: string;
  localityEn: string;
  localityAr: string;
  /** UAE tax registration number: fifteen digits. */
  trn: string;
  /** RERA office registration number. */
  orn: string;
  licenceNo: string;
  /** ISO date. The CRM warns before it expires. */
  licenceExpiry: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  logoUrl: string;
}

export const COMPANY_FIELDS = [
  'legalName', 'tradingName', 'localityEn', 'localityAr', 'trn', 'orn', 'licenceNo',
  'licenceExpiry', 'address', 'phone', 'whatsapp', 'email', 'website', 'logoUrl',
] as const;

export type CompanyField = (typeof COMPANY_FIELDS)[number];

/** The setting name each field is stored under. */
export const COMPANY_SETTING: Record<CompanyField, string> = {
  legalName: 'COMPANY_LEGAL_NAME',
  tradingName: 'COMPANY_TRADING_NAME',
  localityEn: 'COMPANY_LOCALITY_EN',
  localityAr: 'COMPANY_LOCALITY_AR',
  trn: 'COMPANY_TRN',
  orn: 'COMPANY_ORN',
  licenceNo: 'COMPANY_LICENCE_NO',
  licenceExpiry: 'COMPANY_LICENCE_EXPIRY',
  address: 'COMPANY_ADDRESS',
  phone: 'COMPANY_PHONE',
  whatsapp: 'COMPANY_WHATSAPP',
  email: 'COMPANY_EMAIL',
  website: 'COMPANY_WEBSITE',
  logoUrl: 'COMPANY_LOGO_URL',
};

/**
 * What a database with nothing saved falls back to.
 *
 * The three that already reach clients keep the values they had as constants,
 * so nothing changes for an installation that never opens this screen. The
 * rest are empty: a blank TRN is honest, an invented one is a document that
 * says something false.
 */
export const COMPANY_DEFAULTS: CompanyDetails = {
  legalName: COMPANY_NAME,
  tradingName: '',
  localityEn: COMPANY_LOCALITY_EN,
  localityAr: COMPANY_LOCALITY_AR,
  trn: '',
  orn: '',
  licenceNo: '',
  licenceExpiry: '',
  address: '',
  phone: '',
  whatsapp: '',
  email: '',
  website: '',
  logoUrl: '',
};

/** How long each field may be. The column holds 255. */
export const MAX_LENGTH: Partial<Record<CompanyField, number>> = {
  legalName: 160,
  tradingName: 160,
  localityEn: 120,
  localityAr: 120,
  trn: 20,
  orn: 20,
  licenceNo: 40,
  licenceExpiry: 10,
  address: 240,
  phone: 32,
  whatsapp: 32,
  email: 160,
  website: 200,
  logoUrl: 255,
};

/** Build the record from whatever is stored, falling back field by field. */
export function companyFrom(stored: Partial<Record<CompanyField, string | null | undefined>>): CompanyDetails {
  const out = { ...COMPANY_DEFAULTS };
  for (const field of COMPANY_FIELDS) {
    const value = stored[field];
    if (typeof value === 'string' && value.trim()) {
      out[field] = value.trim().slice(0, MAX_LENGTH[field] ?? 255);
    }
  }
  return out;
}

/** The name to use in conversation: what people call us, or the registered name. */
export function displayName(company: CompanyDetails): string {
  return company.tradingName.trim() || company.legalName.trim() || COMPANY_NAME;
}

/**
 * The WhatsApp template footer, and the signature at the bottom of an email.
 *
 * The Arabic one carries the legal name in Latin script, because it is
 * registered that way and is not ours to translate — the locality is what
 * changes language, which is what UAE brokerages normally do.
 */
export function footerFor(company: CompanyDetails, language: string): string {
  const locality = language === 'ar' ? company.localityAr : company.localityEn;
  const name = displayName(company);
  return locality ? `${name} — ${locality}` : name;
}

/**
 * What is wrong or missing, in words an owner can act on.
 *
 * Not validation that refuses a save: a half-filled company record is a normal
 * state on day one, and refusing to save the legal name because the TRN is not
 * ready yet helps nobody. These are shown beside the fields.
 */
/** Meta's cap on a WhatsApp template footer. */
export const WHATSAPP_FOOTER_LIMIT = 60;

export function companyIssues(company: CompanyDetails, today: Date = new Date()): string[] {
  const issues: string[] = [];

  if (!company.legalName.trim()) {
    issues.push('No legal name. Offers and invoices need the name as registered.');
  }
  if (company.trn && !/^\d{15}$/.test(company.trn.replace(/\s/g, ''))) {
    issues.push('A UAE tax registration number is fifteen digits. Check the TRN.');
  }
  if (!company.trn) {
    issues.push('No TRN yet. It has to appear on every tax invoice.');
  }
  if (company.orn && !/^\d{1,8}$/.test(company.orn.replace(/\s/g, ''))) {
    issues.push('The ORN should be the RERA office number — digits only.');
  }
  if (company.email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(company.email)) {
    issues.push('That email address does not look right.');
  }
  if (company.website && !/^https?:\/\//i.test(company.website)) {
    issues.push('The website should start with https://');
  }
  if (company.phone && !/^\+\d[\d\s-]{6,}$/.test(company.phone)) {
    issues.push('Write the phone number in full, starting with +971.');
  }
  if (company.whatsapp && !/^\+\d[\d\s-]{6,}$/.test(company.whatsapp)) {
    issues.push('Write the WhatsApp number in full, starting with +971.');
  }

  const expiry = parseDate(company.licenceExpiry);
  if (company.licenceExpiry && !expiry) {
    issues.push('The licence expiry date is not a date the CRM can read.');
  } else if (expiry) {
    const days = Math.floor((expiry.getTime() - startOfDay(today).getTime()) / 86_400_000);
    if (days < 0) issues.push(`The trade licence expired ${-days} day${days === -1 ? '' : 's'} ago.`);
    else if (days <= 30) issues.push(`The trade licence expires in ${days} day${days === 1 ? '' : 's'}.`);
  }
  if (!company.logoUrl) {
    issues.push('No logo yet. Offers and the business card fall back to the initials.');
  }

  /*
   * Meta caps a WhatsApp footer at 60 characters and rejects the template
   * otherwise. Worth saying here, where the name is typed, rather than two
   * weeks later when a submission comes back rejected.
   */
  const longest = Math.max(footerFor(company, 'en').length, footerFor(company, 'ar').length);
  if (longest > WHATSAPP_FOOTER_LIMIT) {
    issues.push(
      `The name and the location together are ${longest} characters. WhatsApp allows `
      + `${WHATSAPP_FOOTER_LIMIT} in a footer, so shorten one of them.`,
    );
  }

  return issues;
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Changing the legal name does not change the templates Meta has already
 * approved: their footer is part of the approved content. Said out loud on the
 * screen, because the alternative is a client welcomed by one company and
 * followed up by another — the exact bug the single constant was introduced to
 * fix.
 */
export const RENAME_WARNING =
  'The WhatsApp templates Meta has already approved carry the old name in their footer. '
  + 'Changing it here updates what we would submit next time; the approved ones have to be '
  + 're-submitted and approved again before clients see the new name.';

/**
 * The record as it stands, read from settings. Cached by `setting`, so this is
 * not a database round trip on the path of every message.
 *
 * Named `companyDetails` rather than `company` because every caller already
 * has a local variable called `company`, and a shadowed import is the kind of
 * thing that compiles and then sends the wrong name to a client.
 */
export async function companyDetails(): Promise<CompanyDetails> {
  const entries = await Promise.all(
    COMPANY_FIELDS.map(async (field) => [field, await setting(COMPANY_SETTING[field] as never)] as const),
  );
  return companyFrom(Object.fromEntries(entries) as Partial<Record<CompanyField, string | null>>);
}

/**
 * The company as the outside world sees it: the business card, the signature
 * at the foot of a client email, the offer footer.
 *
 * It exists because two of those used to read a single `app_settings` row
 * called `company` and pick `.name` out of its JSON — a shape nothing has
 * written since the Company screen was built, which stores one setting per
 * field. So both quietly ignored everything the owner typed and printed the
 * hard-coded fallback instead. There was no error to notice: the card simply
 * said the wrong company name forever.
 */
export function brandingFrom(company: CompanyDetails): {
  companyName: string;
  companyLegalName: string | null;
  address: string | null;
  licenceNo: string | null;
  website: string | null;
  logoUrl: string | null;
} {
  const legal = company.legalName.trim();
  const shown = displayName(company);
  return {
    companyName: shown,
    /* Only when it adds something: "Emigeo Homes (Emigeo Homes)" in a footer
       is noise, and the legal name is the one that matters on a document. */
    companyLegalName: legal && legal !== shown ? legal : null,
    address: company.address.trim() || null,
    licenceNo: company.licenceNo.trim() || null,
    website: company.website.trim() || null,
    logoUrl: company.logoUrl.trim() || null,
  };
}
