/**
 * Phone entry for a Dubai brokerage.
 *
 * No parsing library on this side on purpose. The server already runs every
 * number through libphonenumber before it is stored, and a client can never be
 * the authority on whether a number is real. What a browser has to do is
 * narrower: make a number readable while it is being typed, and catch the
 * obvious mistake — eight digits where nine belong — before the agent loses
 * the lead they were halfway through adding.
 *
 * So: grouping that matches how people here say a number out loud, a length
 * check per country, and the raw E.164 sent on for the server to rule on.
 */

export interface Country {
  iso: string;
  name: string;
  dial: string;
  /** Digits after the country code. A range where a country really has one. */
  length: number | [number, number];
  /** How to group those digits, e.g. [2,3,4] → "50 123 4567". */
  groups: number[];
}

/*
 * The GCC first, then the markets Dubai off-plan actually sells into, then
 * everywhere else alphabetically. Ordered by who walks through the door, not
 * by the alphabet, because the alphabet puts Afghanistan above the UAE.
 */
export const COUNTRIES: Country[] = [
  { iso: 'AE', name: 'United Arab Emirates', dial: '971', length: 9, groups: [2, 3, 4] },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966', length: 9, groups: [2, 3, 4] },
  { iso: 'QA', name: 'Qatar', dial: '974', length: 8, groups: [4, 4] },
  { iso: 'KW', name: 'Kuwait', dial: '965', length: 8, groups: [4, 4] },
  { iso: 'BH', name: 'Bahrain', dial: '973', length: 8, groups: [4, 4] },
  { iso: 'OM', name: 'Oman', dial: '968', length: 8, groups: [4, 4] },
  { iso: 'IN', name: 'India', dial: '91', length: 10, groups: [5, 5] },
  { iso: 'PK', name: 'Pakistan', dial: '92', length: 10, groups: [3, 7] },
  { iso: 'GB', name: 'United Kingdom', dial: '44', length: 10, groups: [4, 6] },
  { iso: 'RU', name: 'Russia', dial: '7', length: 10, groups: [3, 3, 2, 2] },
  { iso: 'CN', name: 'China', dial: '86', length: 11, groups: [3, 4, 4] },
  { iso: 'EG', name: 'Egypt', dial: '20', length: 10, groups: [3, 3, 4] },
  { iso: 'JO', name: 'Jordan', dial: '962', length: 9, groups: [1, 4, 4] },
  { iso: 'LB', name: 'Lebanon', dial: '961', length: [7, 8], groups: [2, 3, 3] },
  { iso: 'SY', name: 'Syria', dial: '963', length: 9, groups: [3, 3, 3] },
  { iso: 'IQ', name: 'Iraq', dial: '964', length: 10, groups: [3, 3, 4] },
  { iso: 'IR', name: 'Iran', dial: '98', length: 10, groups: [3, 3, 4] },
  { iso: 'TR', name: 'Türkiye', dial: '90', length: 10, groups: [3, 3, 4] },
  { iso: 'KZ', name: 'Kazakhstan', dial: '7', length: 10, groups: [3, 3, 2, 2] },
  { iso: 'UA', name: 'Ukraine', dial: '380', length: 9, groups: [2, 3, 4] },
  { iso: 'US', name: 'United States', dial: '1', length: 10, groups: [3, 3, 4] },
  { iso: 'CA', name: 'Canada', dial: '1', length: 10, groups: [3, 3, 4] },
  { iso: 'DE', name: 'Germany', dial: '49', length: [10, 11], groups: [4, 7] },
  { iso: 'FR', name: 'France', dial: '33', length: 9, groups: [1, 2, 2, 2, 2] },
  { iso: 'IT', name: 'Italy', dial: '39', length: 10, groups: [3, 3, 4] },
  { iso: 'ES', name: 'Spain', dial: '34', length: 9, groups: [3, 3, 3] },
  { iso: 'NL', name: 'Netherlands', dial: '31', length: 9, groups: [1, 4, 4] },
  { iso: 'BE', name: 'Belgium', dial: '32', length: 9, groups: [3, 3, 3] },
  { iso: 'CH', name: 'Switzerland', dial: '41', length: 9, groups: [2, 3, 2, 2] },
  { iso: 'AT', name: 'Austria', dial: '43', length: [10, 11], groups: [4, 7] },
  { iso: 'PL', name: 'Poland', dial: '48', length: 9, groups: [3, 3, 3] },
  { iso: 'RO', name: 'Romania', dial: '40', length: 9, groups: [3, 3, 3] },
  { iso: 'SE', name: 'Sweden', dial: '46', length: 9, groups: [2, 3, 2, 2] },
  { iso: 'NO', name: 'Norway', dial: '47', length: 8, groups: [3, 2, 3] },
  { iso: 'DK', name: 'Denmark', dial: '45', length: 8, groups: [2, 2, 2, 2] },
  { iso: 'IE', name: 'Ireland', dial: '353', length: 9, groups: [2, 3, 4] },
  { iso: 'PT', name: 'Portugal', dial: '351', length: 9, groups: [3, 3, 3] },
  { iso: 'GR', name: 'Greece', dial: '30', length: 10, groups: [3, 3, 4] },
  { iso: 'CZ', name: 'Czechia', dial: '420', length: 9, groups: [3, 3, 3] },
  { iso: 'RS', name: 'Serbia', dial: '381', length: [8, 9], groups: [2, 3, 4] },
  { iso: 'BA', name: 'Bosnia and Herzegovina', dial: '387', length: 8, groups: [2, 3, 3] },
  { iso: 'AZ', name: 'Azerbaijan', dial: '994', length: 9, groups: [2, 3, 4] },
  { iso: 'AM', name: 'Armenia', dial: '374', length: 8, groups: [2, 3, 3] },
  { iso: 'GE', name: 'Georgia', dial: '995', length: 9, groups: [3, 3, 3] },
  { iso: 'UZ', name: 'Uzbekistan', dial: '998', length: 9, groups: [2, 3, 4] },
  { iso: 'BD', name: 'Bangladesh', dial: '880', length: 10, groups: [4, 6] },
  { iso: 'LK', name: 'Sri Lanka', dial: '94', length: 9, groups: [2, 3, 4] },
  { iso: 'NP', name: 'Nepal', dial: '977', length: 10, groups: [3, 7] },
  { iso: 'PH', name: 'Philippines', dial: '63', length: 10, groups: [3, 3, 4] },
  { iso: 'ID', name: 'Indonesia', dial: '62', length: [9, 11], groups: [3, 4, 4] },
  { iso: 'MY', name: 'Malaysia', dial: '60', length: [9, 10], groups: [2, 4, 4] },
  { iso: 'SG', name: 'Singapore', dial: '65', length: 8, groups: [4, 4] },
  { iso: 'TH', name: 'Thailand', dial: '66', length: 9, groups: [2, 3, 4] },
  { iso: 'JP', name: 'Japan', dial: '81', length: 10, groups: [2, 4, 4] },
  { iso: 'KR', name: 'South Korea', dial: '82', length: 10, groups: [2, 4, 4] },
  { iso: 'AU', name: 'Australia', dial: '61', length: 9, groups: [3, 3, 3] },
  { iso: 'NZ', name: 'New Zealand', dial: '64', length: [8, 9], groups: [2, 3, 4] },
  { iso: 'ZA', name: 'South Africa', dial: '27', length: 9, groups: [2, 3, 4] },
  { iso: 'NG', name: 'Nigeria', dial: '234', length: 10, groups: [3, 3, 4] },
  { iso: 'KE', name: 'Kenya', dial: '254', length: 9, groups: [3, 3, 3] },
  { iso: 'MA', name: 'Morocco', dial: '212', length: 9, groups: [3, 3, 3] },
  { iso: 'DZ', name: 'Algeria', dial: '213', length: 9, groups: [3, 3, 3] },
  { iso: 'TN', name: 'Tunisia', dial: '216', length: 8, groups: [2, 3, 3] },
  { iso: 'SD', name: 'Sudan', dial: '249', length: 9, groups: [3, 3, 3] },
  { iso: 'BR', name: 'Brazil', dial: '55', length: 11, groups: [2, 5, 4] },
  { iso: 'AR', name: 'Argentina', dial: '54', length: 10, groups: [3, 3, 4] },
  { iso: 'MX', name: 'Mexico', dial: '52', length: 10, groups: [3, 3, 4] },
];

export const DEFAULT_COUNTRY = COUNTRIES[0] as Country;

/** The flag emoji for an ISO code, built from the regional indicator letters. */
export function flagOf(iso: string): string {
  return iso
    .toUpperCase()
    .replace(/[A-Z]/g, (letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65));
}

export function digitsOf(value: string): string {
  return value.replace(/\D+/g, '');
}

/**
 * Group the national digits the way the country writes them, and keep any
 * extra digits on the end rather than dropping them — a number being typed is
 * briefly wrong, and silently eating a keystroke is maddening.
 */
export function groupNational(digits: string, groups: number[]): string {
  const parts: string[] = [];
  let at = 0;
  for (const size of groups) {
    if (at >= digits.length) break;
    parts.push(digits.slice(at, at + size));
    at += size;
  }
  if (at < digits.length) parts.push(digits.slice(at));
  return parts.join(' ');
}

/**
 * Strip what people actually paste in front of a national number: the leading
 * zero every UAE number is printed with (`050…`), the `00` dialling prefix
 * used across the Gulf and Europe, and the country's own code when the whole
 * number goes into the national box (`971501234567`, `00971 50…`).
 *
 * Zeros come off before the code and again after it, because `00971 050…` is
 * a real thing a person pastes.
 */
export function stripPrefixes(digits: string, dial: string): string {
  const dropZeros = (value: string) => value.replace(/^0+/, '');
  let rest = dropZeros(digits);
  if (rest.startsWith(dial) && rest.length > dial.length) rest = dropZeros(rest.slice(dial.length));
  return rest;
}

export function maxLengthOf(country: Country): number {
  return Array.isArray(country.length) ? country.length[1] : country.length;
}

function lengthOk(country: Country, digits: string): boolean {
  if (Array.isArray(country.length)) {
    const [min, max] = country.length;
    return digits.length >= min && digits.length <= max;
  }
  return digits.length === country.length;
}

export interface PhoneValue {
  /** What the server is sent: `+971501234567`, or '' when nothing is typed. */
  e164: string;
  /** What the agent reads back: `50 123 4567`. */
  display: string;
  /** Empty counts as valid; "required" is the form's business, not this one's. */
  valid: boolean;
  /** Plain words for under the field, or null when there is nothing to say. */
  problem: string | null;
}

export function readPhone(raw: string, country: Country): PhoneValue {
  const national = stripPrefixes(digitsOf(raw), country.dial).slice(0, maxLengthOf(country));
  const display = groupNational(national, country.groups);

  if (national.length === 0) return { e164: '', display: '', valid: true, problem: null };

  const e164 = `+${country.dial}${national}`;
  if (lengthOk(country, national)) return { e164, display, valid: true, problem: null };

  const want = Array.isArray(country.length) ? `${country.length[0]}–${country.length[1]}` : String(country.length);
  const problem = national.length < maxLengthOf(country)
    ? `That looks short — ${country.name} numbers have ${want} digits after +${country.dial}.`
    : `That looks long — ${country.name} numbers have ${want} digits after +${country.dial}.`;
  return { e164, display, valid: false, problem };
}

/** Pick the country an existing `+971…` belongs to, longest dial code first. */
export function countryOfE164(e164: string | null | undefined): Country | null {
  if (!e164) return null;
  const digits = digitsOf(e164);
  const matches = COUNTRIES.filter((country) => digits.startsWith(country.dial))
    .sort((a, b) => b.dial.length - a.dial.length);
  /*
   * +1 and +7 are each shared by two countries here. Without the national
   * number there is nothing to tell them apart, so take the first, which is
   * the one more of this brokerage's clients are in.
   */
  return matches[0] ?? null;
}
