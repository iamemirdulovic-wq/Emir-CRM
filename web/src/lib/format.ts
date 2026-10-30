import { locale } from './i18n.js';
import { countryOfE164 } from '../design/phone.js';

/** Asia/Dubai is the business timezone; everything is shown in it. */
const TZ = 'Asia/Dubai';

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale() === 'ar' ? 'ar-AE' : 'en-AE', {
    timeZone: TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale() === 'ar' ? 'ar-AE' : 'en-AE', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** "3 minutes ago" — the inbox reads much better with this than timestamps. */
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale() === 'ar' ? 'ar-AE' : 'en-AE', { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(Math.round(seconds), 'second');
}

export function formatAed(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat(locale() === 'ar' ? 'ar-AE' : 'en-AE', { maximumFractionDigits: 0 }).format(amount);
}

/**
 * AED 2,500,000 is a number to count; AED 2.5M is a number to read. Used
 * wherever a budget sits in a list or on a card and the exact dirham does
 * not matter — the full figure stays on the lead itself.
 */
export function formatAedShort(amount: number | null | undefined): string {
  if (!amount) return '—';
  if (amount >= 1_000_000) return `AED ${(amount / 1_000_000).toFixed(amount % 1_000_000 === 0 ? 0 : 1)}M`;
  if (amount >= 1_000) return `AED ${Math.round(amount / 1_000)}K`;
  return `AED ${amount}`;
}

/**
 * Hide the middle of a phone number in a list.
 *
 * `+971 50 ••• 4567` — enough to recognise a client you know, not enough to
 * read a column of them off a screen into a notebook.
 *
 * Be clear about what this is: the full number is still in the response, so
 * that the Call button can dial it without a round trip. It raises the effort
 * of copying the list by hand; it does not stop anyone determined. The real
 * protection is elsewhere — agents only ever receive their own leads, exports
 * are the owner's alone, and opening hundreds of leads in an hour tells the
 * owner. See DECISIONS.md.
 */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  const digits = e164.replace(/\D+/g, '');
  if (digits.length < 8) return e164;

  /*
   * Split on the real dial code rather than a fixed number of characters:
   * +971 and +91 are different lengths, and slicing blindly turns both into
   * something that is not a phone number in any country.
   */
  const country = countryOfE164(`+${digits}`);
  const dial = country?.dial ?? digits.slice(0, 3);
  const national = digits.slice(dial.length);

  /* Country code, the operator's two digits, then the last four — which is
     what a person uses to recognise a number they already know. */
  return `+${dial} ${national.slice(0, 2)} ••• ${national.slice(-4)}`;
}

/**
 * Enum values whose underscores are ranges rather than word breaks, so the
 * generic rule below would render "1_3_months" as "1 3 Months".
 */
const PHRASES: Record<string, string> = {
  '1_3_months': '1–3 months',
  '3_6_months': '3–6 months',
  '6_12_months': '6–12 months',
  '12_plus': '12 months or more',
  end_use: 'End use',
  meta_ctwa: 'Click-to-WhatsApp',
  meta_lead_ads: 'Meta lead ads',
  whatsapp_direct: 'WhatsApp',
  ras_al_khaimah: 'Ras Al Khaimah',
  umm_al_quwain: 'Umm Al Quwain',
  abu_dhabi: 'Abu Dhabi',
};

export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const phrase = PHRASES[value];
  if (phrase) return phrase;
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * "1 contact", "12 contacts", "0 contacts".
 *
 * Built by hand in nine places and wrong in at least one of them — a list
 * with one person in it read "1 contacts", which is the kind of thing that
 * makes software feel unfinished. English plurals are mostly an "s"; the few
 * that are not take the second argument.
 */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}
