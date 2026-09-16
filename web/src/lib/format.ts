import { locale } from './i18n.js';

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
