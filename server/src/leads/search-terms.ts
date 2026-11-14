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

/**
 * The fewest digits worth matching a number on. Below this, it is a year.
 *
 * Five, because five is what an agent reads off a missed-call screen before
 * ringing back. It was six, and six is the reason "99693" — the middle of a
 * lead already in the CRM — found nothing and offered to create the client a
 * second time.
 */
export const MIN_PHONE_DIGITS = 5;

/**
 * The `LIKE` pattern for a phone search, or null when the query is not one.
 *
 * Takes the last nine digits, which is the subscriber part of a UAE number
 * once the country code and any leading zero are gone. Matching from the right
 * means a stored "+971501234567" is found by "0501234567", "501234567",
 * "+971 50 123 4567" and "1234567" alike.
 *
 * On its own it is not enough — see `phonePatterns`.
 */
export function phoneTail(input: string, maxDigits = 9): string | null {
  const digits = digitsOf(input).replace(/^0+/, '');
  if (digits.length < MIN_PHONE_DIGITS) return null;
  return `%${digits.slice(-maxDigits)}`;
}

/**
 * The `LIKE` pattern that finds those digits *anywhere* in the number.
 *
 * `phone_e164` holds "+919969342716" — a plus and then digits, no spaces — so
 * a run of digits read off a screen is a substring of it wherever it came
 * from in the number.
 */
export function phoneAnywhere(input: string): string | null {
  const digits = digitsOf(input).replace(/^0+/, '');
  if (digits.length < MIN_PHONE_DIGITS) return null;
  return `%${digits}%`;
}

/**
 * Every pattern a phone search has to try, or none when it is not one.
 *
 * Two, and each catches what the other misses:
 *
 *  - **Anywhere** is what a person actually types. They read five or six
 *    digits off a missed call and want the lead those digits are *inside* of.
 *    A right-hand-end match cannot answer that: "99693" sits in the middle of
 *    +919969342716, so matching from the end found nothing and the agent was
 *    offered a new contact for a client we already had.
 *  - **The tail** is still needed for a number typed with a country code and
 *    then a national zero — "+971 0 50 123 4567" — which no run of its digits
 *    is a substring of the stored "+971501234567".
 *
 * When the query is nine digits or fewer the tail match is a subset of the
 * anywhere match, so only one pattern comes back and the query stays short.
 */
export function phonePatterns(input: string, maxDigits = 9): string[] {
  const anywhere = phoneAnywhere(input);
  if (!anywhere) return [];
  const digits = digitsOf(input).replace(/^0+/, '');
  if (digits.length <= maxDigits) return [anywhere];
  const tail = phoneTail(input, maxDigits);
  return tail ? [anywhere, tail] : [anywhere];
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
