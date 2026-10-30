/**
 * A tag that names one upload.
 *
 * Every imported contact already gets `src:import-<label>`, which is the
 * provenance. It is not enough to find one batch: run the Expo list twice in
 * a week and both uploads carry the same tag, so "the ones from Tuesday" can
 * no longer be told from "the ones from Friday" — and that is exactly the
 * question asked when a batch turns out to be bad.
 *
 * So each upload also gets a tag of its own: the label it was given, the day
 * it ran, and four characters of its id to separate two on the same day.
 * Readable, because an agent sees it on the contact and has to recognise it.
 */

/** Dubai is UTC+4 all year, so the date on the tag is the day it felt like. */
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Lowercase, letters and digits only, words joined by a single dash.
 *
 * Non-Latin labels — an Arabic list name — have nothing left after stripping,
 * so they fall back to "import" rather than producing a tag that is only a
 * date. The tag is an identifier, not a translation.
 */
export function slugLabel(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
    .replace(/-+$/g, '');
  return slug || 'import';
}

/** `expo-2026-30oct-a3f2` */
export function batchTagFor(label: string, importId: string, when: Date = new Date()): string {
  const dubai = new Date(when.getTime() + DUBAI_OFFSET_MS);
  const day = String(dubai.getUTCDate()).padStart(2, '0');
  const month = MONTHS[dubai.getUTCMonth()] ?? 'xxx';
  /* Four characters of the id: enough to separate two uploads of the same
     list on the same day, short enough to read out loud. */
  const suffix = importId.replace(/-/g, '').slice(0, 4) || '0000';
  return `${slugLabel(label)}-${day}${month}-${suffix}`;
}
