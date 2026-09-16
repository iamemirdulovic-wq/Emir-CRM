import type { Emirate, PaymentMethod, Purpose, Timeline } from './dto.js';

/** Lead-form answers arrive as free text. These turn them into CRM enums. */

const norm = (v: string): string => v.toLowerCase().trim().replace(/[–—]/g, '-').replace(/\s+/g, ' ');

export function parsePurpose(value: string | null | undefined): Purpose {
  if (!value) return 'unknown';
  const v = norm(value);
  if (/invest|rental|roi|yield|resale|استثمار/.test(v)) return 'investment';
  if (/end.?use|live|personal|family|own use|residence|سكن|للسكن/.test(v)) return 'end_use';
  return 'unknown';
}

export function parsePaymentMethod(value: string | null | undefined): PaymentMethod {
  if (!value) return 'unknown';
  const v = norm(value);
  if (/mortgage|finance|loan|bank|رهن|تمويل/.test(v)) return 'mortgage';
  if (/payment plan|installment|instalment|plan|تقسيط|خطة/.test(v)) return 'payment_plan';
  if (/cash|full payment|outright|كاش|نقد/.test(v)) return 'cash';
  return 'unknown';
}

export function parseTimeline(value: string | null | undefined): Timeline {
  if (!value) return 'unknown';
  const v = norm(value);
  if (/immediate|asap|now|ready|urgent|this month|فور|حالا|الان/.test(v)) return 'immediate';
  if (/1\s*-\s*3|within 3|next 3|1 to 3|three months|3 months|شهر|ثلاثة اشهر/.test(v)) return '1_3_months';
  if (/3\s*-\s*6|within 6|3 to 6|six months|6 months|ستة اشهر/.test(v)) return '3_6_months';
  if (/6\s*-\s*12|within a year|within 12|6 to 12|12 months|سنة/.test(v)) return '6_12_months';
  if (/12\+|more than a year|over a year|1\+ year|next year|later|just looking|browsing|اكثر من سنة/.test(v)) return '12_plus';
  return 'unknown';
}

export function parseEmirate(value: string | null | undefined): Emirate | null {
  if (!value) return null;
  const v = norm(value);
  if (/dubai|دبي/.test(v)) return 'dubai';
  if (/abu ?dhabi|abudhabi|أبوظبي|ابوظبي|أبو ظبي/.test(v)) return 'abu_dhabi';
  if (/sharjah|الشارقة/.test(v)) return 'sharjah';
  if (/ras ?al ?khaimah|rak\b|رأس الخيمة/.test(v)) return 'ras_al_khaimah';
  if (/ajman|عجمان/.test(v)) return 'ajman';
  if (/fujairah|الفجيرة/.test(v)) return 'fujairah';
  if (/umm ?al ?quwain|أم القيوين/.test(v)) return 'umm_al_quwain';
  return null;
}

export function parseBoolean(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^(1|true|yes|y|on|interested|نعم)$/i.test(value.trim());
}

/**
 * Turn a budget answer into a numeric AED range.
 * Handles "1M - 2M", "AED 1,500,000", "up to 3M", "800k-1.2m", "5M+".
 */
export function parseBudgetBand(value: string | null | undefined): { min: number | null; max: number | null } {
  if (!value) return { min: null, max: null };
  const v = norm(value);

  const numbers: number[] = [];
  // Digits may carry thousand separators ("1,500,000") and a decimal part ("1.5").
  const tokenRe = /(\d[\d,]*(?:\.\d+)?)\s*(m(?:illion)?|k|thousand)?/g;
  for (const match of v.matchAll(tokenRe)) {
    const rawNumber = Number((match[1] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(rawNumber)) continue;
    const unit = match[2];
    let scaled = rawNumber;
    if (unit?.startsWith('m')) scaled = rawNumber * 1_000_000;
    else if (unit === 'k' || unit === 'thousand') scaled = rawNumber * 1_000;
    // A bare number below 1000 in a budget answer means millions ("1.5 - 3").
    else if (rawNumber < 1000) scaled = rawNumber * 1_000_000;
    numbers.push(Math.round(scaled));
  }
  if (numbers.length === 0) return { min: null, max: null };

  const isUpTo = /up to|under|below|less than|max|حتى|اقل من/.test(v);
  const isFrom = /\+|above|over|more than|plus|from|starting|فوق|اكثر من/.test(v);

  if (numbers.length === 1) {
    const only = numbers[0] as number;
    if (isUpTo) return { min: null, max: only };
    if (isFrom) return { min: only, max: null };
    return { min: only, max: only };
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  return { min: sorted[0] as number, max: sorted[sorted.length - 1] as number };
}

/** Detect the lead's language so we pick the right template. */
export function detectLanguage(...samples: Array<string | null | undefined>): 'ar' | 'en' | null {
  const text = samples.filter(Boolean).join(' ');
  if (!text.trim()) return null;
  // Arabic block. A single Arabic word in an otherwise English message is not
  // enough, so require Arabic to be a meaningful share of the letters.
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic === 0) return latin > 0 ? 'en' : null;
  return arabic >= latin ? 'ar' : 'en';
}

/** Split a full name when the source only gives us one field. */
export function splitName(fullName: string | null | undefined): { first: string | null; last: string | null } {
  const name = (fullName ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { first: null, last: null };
  const parts = name.split(' ');
  if (parts.length === 1) return { first: parts[0] ?? null, last: null };
  return { first: parts[0] ?? null, last: parts.slice(1).join(' ') };
}

export function joinName(first: string | null | undefined, last: string | null | undefined): string | null {
  const joined = [first, last].filter((p) => p && p.trim()).join(' ').trim();
  return joined || null;
}

/** Trim and collapse whitespace; empty becomes null. */
export function cleanText(value: unknown, maxLength = 500): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/\s+/g, ' ');
  if (!text) return null;
  return text.slice(0, maxLength);
}
