/**
 * Turning what somebody typed into something SQL can match.
 *
 * A phone number reaches the palette in whatever shape it was read off a
 * screen: "050 123 4567", "+971 50 123 4567", "0501234567", "971501234567",
 * sometimes half of it. The column it has to match is E.164, so the digits are
 * pulled out on their own and matched from the right-hand end — which is the
 * only part that is stable across all those shapes.
 */

/** Just the digits, with Arabic-Indic numerals folded to ASCII. */
export function digitsOf(input: string): string {
  let out = '';
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (char >= '0' && char <= '9') out += char;
    /* ٠١٢٣٤٥٦٧٨٩ — a Dubai client's phone pasted from an Arabic keyboard. */
    else if (code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660);
    /* ۰۱۲۳۴۵۶۷۸۹ — the Persian set, which some Android keyboards produce. */
    else if (code >= 0x06f0 && code <= 0x06f9) out += String(code - 0x06f0);
  }
  return out;
}

/** The fewest digits worth matching a number on. Below this, it is a year. */
export const MIN_PHONE_DIGITS = 6;

/**
 * The `LIKE` pattern for a phone search, or null when the query is not one.
 *
 * Takes the last nine digits, which is the subscriber part of a UAE number
 * once the country code and any leading zero are gone. Matching from the right
 * means a stored "+971501234567" is found by "0501234567", "501234567",
 * "+971 50 123 4567" and "1234567" alike.
 */
export function phoneTail(input: string, maxDigits = 9): string | null {
  const digits = digitsOf(input).replace(/^0+/, '');
  if (digits.length < MIN_PHONE_DIGITS) return null;
  return `%${digits.slice(-maxDigits)}`;
}

/**
 * Does this look like somebody reaching for a number rather than a name?
 *
 * Used to decide whether to add the phone clause at all — one fewer `OR LIKE`
 * on a query that runs on every keystroke.
 */
export function looksLikePhone(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  const digits = digitsOf(trimmed);
  if (digits.length < MIN_PHONE_DIGITS) return false;
  /* Mostly digits, punctuation and spaces. "Flat 302, Marina 2019" is not a
     phone number however many digits it contains. */
  const letters = trimmed.replace(/[^\p{L}]/gu, '').length;
  return letters === 0;
}

/** `%term%`, with the wildcards a person types treated as text. */
export function likeTerm(input: string): string {
  const escaped = input.trim().replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}
