import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { DEFAULT_PHONE_REGION } from '../config/constants.js';

export type ParsedPhone = {
  /** E.164, e.g. +971501234567. Null when the input cannot be parsed into a valid number. */
  e164: string | null;
  /** Digits only, no leading +. This is what WhatsApp calls the `wa_id`. */
  waId: string | null;
  country: string | null;
  isValid: boolean;
  /** True when the number is a mobile (or mobile-or-fixed) line — used by lead scoring. */
  isMobile: boolean;
  raw: string;
};

const INVALID: Omit<ParsedPhone, 'raw'> = {
  e164: null,
  waId: null,
  country: null,
  isValid: false,
  isMobile: false,
};

/**
 * Parse any phone input into E.164. Defaults to the AE region so that local
 * formats such as `050 123 4567` and `0501234567` resolve to +971501234567.
 */
export function parsePhone(input: string | null | undefined, region: string = DEFAULT_PHONE_REGION): ParsedPhone {
  const raw = (input ?? '').toString().trim();
  if (!raw) return { ...INVALID, raw };

  // Meta and WhatsApp deliver bare digits ("971501234567"); libphonenumber needs
  // a leading + to read them as international.
  const candidates = [raw];
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits && !digits.startsWith('+')) candidates.push(`+${digits}`);

  for (const candidate of candidates) {
    const parsed = parsePhoneNumberFromString(candidate, region as CountryCode);
    if (parsed?.isValid()) {
      const type = parsed.getType();
      return {
        e164: parsed.number,
        waId: parsed.number.replace(/^\+/, ''),
        country: parsed.country ?? null,
        isValid: true,
        isMobile: type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE' || type === undefined,
        raw,
      };
    }
  }
  return { ...INVALID, raw };
}

/** Convenience: E.164 or null. */
export function toE164(input: string | null | undefined, region?: string): string | null {
  return parsePhone(input, region).e164;
}

/** WhatsApp `wa_id` (digits, no plus) or null. */
export function toWaId(input: string | null | undefined, region?: string): string | null {
  return parsePhone(input, region).waId;
}
