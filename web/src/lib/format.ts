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

export function budgetLabel(min: number | null, max: number | null, band: string | null): string {
  if (min && max && min !== max) return `AED ${formatAed(min)} – ${formatAed(max)}`;
  if (max) return `AED ${formatAed(max)}`;
  if (min) return `AED ${formatAed(min)}+`;
  return band ?? '—';
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  return `${(parts[0] as string)[0]}${(parts[parts.length - 1] as string)[0]}`.toUpperCase();
}

/** Deterministic avatar colour, so a person keeps the same one. */
export function avatarColor(seed: string | null | undefined): string {
  const palette = ['bg-brand-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-violet-500', 'bg-cyan-600'];
  const key = seed ?? '';
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length] as string;
}

export function scoreTone(score: number): string {
  if (score >= 70) return 'bg-rose-100 text-rose-700';
  if (score >= 40) return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-600';
}

export function stageTone(stage: string): string {
  switch (stage) {
    case 'new_lead':
      return 'bg-slate-100 text-slate-700';
    case 'attempted_contact':
      return 'bg-amber-100 text-amber-800';
    case 'engaged_qualified':
      return 'bg-sky-100 text-sky-800';
    case 'appointment_scheduled':
      return 'bg-violet-100 text-violet-800';
    case 'deal_sent':
      return 'bg-indigo-100 text-indigo-800';
    case 'won':
      return 'bg-emerald-100 text-emerald-800';
    case 'lost':
      return 'bg-rose-100 text-rose-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
