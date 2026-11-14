/**
 * A name that is really a note somebody typed in the import file.
 *
 * The leads came out of spreadsheets, and a spreadsheet's name column holds
 * whatever the last person to open it typed. So the CRM has leads called
 * "Looks fake – verify", "Prüfen", "check" and "TECHNICAL ANALYSIS." — every
 * one of them an instruction to a colleague, sitting where a person's name
 * should be. Emir found them on his phone on 14 Nov (§G).
 *
 * Two jobs, one rule, so the two can never disagree:
 *
 *  1. **The dialler's opener** must not greet a note. "Hi Looks fake, this is
 *     Rocky from homes.me" is the kind of thing that ends a call in the first
 *     second. `firstNameFor` returns null and the opener leaves the name out.
 *  2. **The owner's list** on the import screen shows him which leads carry
 *     one, so he can fix them himself. `importNoteIn` names the reason, and
 *     the screen prints it, because a list that says only "these look wrong"
 *     is a list nobody trusts.
 *
 * This is **not** `server/src/imports/names.ts`. That one runs at import time
 * and rejects values that are not names at all — answers to form questions,
 * sentences, keyboard mash. It is why most rubbish never reaches a contact.
 * "Looks fake – verify" walks straight past it: three plain words, no digits,
 * no punctuation it looks for. This module asks the narrower question that
 * one cannot: *is this name a note about the lead rather than the lead?*
 *
 * It errs the same way, and for the same reason: a real name wrongly dropped
 * costs a friendlier opener, while a note wrongly spoken costs the call. So
 * every rule here is one that can be written down and tested, and nothing is
 * decided on a hunch about how a name "feels".
 */

/**
 * Words that are a note in any list, in the languages these files arrive in.
 *
 * Matched as whole words, never as a fragment: "check" must not catch
 * "Chekhov", "fake" must not catch an Indian "Fakeer", and "test" must not
 * catch the Italian surname "Testa". Diacritics are folded first, so the
 * German "Prüfen" is matched by `prufen` — and only by that, never by the
 * surname "Prüfer", which folds to `prufer`.
 *
 * The list is meant to grow when Emir finds another one. Adding a word here
 * is the whole change — the list screen and the dialler both read it, and
 * `note-names-sql.test.ts` makes sure the server's query is widened with it.
 */
export const NOTE_WORDS: readonly string[] = [
  // English, as typed in a spreadsheet's name column
  'fake', 'verify', 'verified', 'unverified', 'check', 'checked', 'recheck',
  'invalid', 'duplicate', 'dupe', 'unknown', 'spam', 'junk', 'test', 'testing',
  'dummy', 'tbc', 'tba', 'unsure', 'suspicious',
  // German — Emir's own example was "Prüfen"
  'prufen', 'pruefen', 'gepruft', 'nachprufen', 'falsch',
];

/**
 * Notes that are only a note when the words are together.
 *
 * "Looks" on its own is a surname, and so is "Call". Matched against the
 * whole folded name with punctuation turned into single spaces, so "Looks
 * fake – verify" and "Looks-Fake" both read the same.
 */
export const NOTE_PHRASES: readonly string[] = [
  'looks fake', 'look fake', 'looks wrong', 'no name', 'not a name',
  'wrong number', 'bad number', 'do not call', 'to check', 'needs check',
  'check number', 'check this', 'needs review', 'to review',
];

/** What a sentence ends with and a name does not. */
export const SENTENCE_ENDS: readonly string[] = ['.', '!', '?', ':'];

/**
 * The words that sit at the end of a real name and are allowed a full stop.
 *
 * Without these, "Mohammed Ali Jr." reads as a sentence by the rule below.
 */
const NAME_SUFFIXES = new Set(['jr', 'jnr', 'snr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'esq']);

/**
 * Titles. What follows one is a surname, not a first name — "Mr Khan" is not
 * somebody you greet as Khan, which is the whole reason a title is written.
 */
const HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'mister', 'dr', 'doctor', 'prof', 'professor',
  'eng', 'engr', 'sir', 'madam', 'mme', 'herr', 'frau', 'hr',
]);

/**
 * Particles that join the parts of a name and are nobody's first name.
 *
 * "Al Mansoori" starts with one; so do "van der Berg" and "de Souza". They
 * are skipped when looking for something to say out loud, and a name made of
 * nothing but these has no first name in it at all.
 */
const PARTICLES = new Set([
  'al', 'el', 'bin', 'ibn', 'bint', 'abu', 'umm', 'van', 'von', 'der', 'den',
  'de', 'da', 'do', 'dos', 'du', 'di', 'del', 'della', 'la', 'le', 'ter',
]);

/** Lowercase, with the accents taken off, so one spelling matches many. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** The words in a name: runs of letters or digits, folded. */
function words(value: string): string[] {
  return fold(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The same, but keeping the original spelling and case. */
function rawWords(value: string): string[] {
  return value.split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
}

/** How many letters are in it, ignoring digits, spaces and punctuation. */
function letterCount(value: string): number {
  return (value.match(/\p{L}/gu) ?? []).length;
}

/**
 * Title case: one capital at the front of each part and nothing shouted after
 * it. Each part, because "Hans-Jürgen" and "O'Brien" are one word with two.
 *
 * A script with no capitals — Arabic, Hindi — is never shouting, so it passes
 * this test rather than failing it.
 */
function isTitleCase(word: string): boolean {
  return (word.match(/\p{L}+/gu) ?? []).every(
    (part) => part.slice(1) === part.slice(1).toLowerCase(),
  );
}

/**
 * A line that reads as a sentence rather than a name.
 *
 * Emir's own example is "TECHNICAL ANALYSIS." — two words, shouted, with a
 * full stop on the end. Three conditions together, because each on its own
 * catches real names:
 *
 *  - it ends in `.`, `!`, `?` or `:` — a name does not, except after an
 *    initial ("Ahmed K.") or a suffix ("Ali Jr."), both allowed for here;
 *  - it is more than one word;
 *  - it is not written in title case — "Ahmed Khan." is a real name with a
 *    stray full stop typed after it, and that is a typo, not a note.
 */
function readsAsSentence(value: string): boolean {
  const trimmed = value.trim();
  if (!SENTENCE_ENDS.includes(trimmed.slice(-1))) return false;
  const parts = words(trimmed);
  if (parts.length < 2) return false;
  const last = parts[parts.length - 1] as string;
  if (last.length < 3 || NAME_SUFFIXES.has(last)) return false;
  return !rawWords(trimmed).every(isTitleCase);
}

/**
 * Why this name is a note, in the words the screen prints — or null when it
 * is a name as far as anything here can tell.
 *
 * The reason is the point. "Has the word “verify”" is something Emir can
 * check against his own file in a second; "flagged" is not.
 */
export function importNoteIn(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;

  if (letterCount(trimmed) === 0) return 'No letters in it';

  const spaced = ` ${words(trimmed).join(' ')} `;
  for (const phrase of NOTE_PHRASES) {
    if (spaced.includes(` ${phrase} `)) return `Has “${phrase}” in it`;
  }

  const parts = words(trimmed);
  const at = parts.findIndex((word) => NOTE_WORDS.includes(word));
  if (at >= 0) {
    /* Quote the word as it is written in the name, not as this file folds it:
       "Prüfen" is what Emir will find in his file, `prufen` is not. The two
       lists split on the same boundaries, so the index lines up; if some
       spelling ever makes it not, the folded word is still true. */
    const raw = rawWords(trimmed);
    const word = raw.length === parts.length ? raw[at] as string : parts[at] as string;
    return `Has the word “${word}” in it`;
  }

  if (readsAsSentence(trimmed)) return 'Reads as a sentence, not a name';

  return null;
}

/** The same question, when only the answer matters. */
export function looksLikeImportNote(value: string | null | undefined): boolean {
  return importNoteIn(value) !== null;
}

/**
 * What to call this person out loud, or null when there is nothing to say.
 *
 * Null for a note, for an empty name, and for a name that holds no first
 * name — initials, a title and a surname, particles on their own. The caller
 * then leaves the name out of the sentence altogether rather than putting
 * something plausible in it.
 *
 * A SHOUTED name comes back written normally, because this is a line an agent
 * reads aloud to a stranger, not the record. Nothing else about it changes.
 */
export function firstNameFor(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed || looksLikeImportNote(trimmed)) return null;

  let parts = rawWords(trimmed);
  /*
   * A title with one word after it is a surname — "Mr Khan" is nobody's
   * first name, which is the whole reason the title was written. A title
   * with a full name after it is just a polite spreadsheet.
   */
  while (parts.length > 0 && HONORIFICS.has(fold(parts[0] as string).replace(/[.'’-]/g, ''))) {
    if (parts.length <= 2) return null;
    parts = parts.slice(1);
  }

  for (const part of parts) {
    /*
     * A particle is never the name itself. "Al Mansoori" therefore answers
     * "Mansoori": nothing in the record says whether that is a given name or
     * a family one, and a greeting is better than none.
     */
    if (PARTICLES.has(fold(part))) continue;
    /* An initial is not a name; two letters is the shortest real one ("Li"). */
    if (letterCount(part) < 2) continue;
    return tidy(part);
  }
  return null;
}

/** "AHMED" → "Ahmed"; "Ahmed", "أحمد" and "McGrath" are left exactly as they are. */
function tidy(word: string): string {
  if (letterCount(word) < 3) return word;
  if (word !== word.toUpperCase() || word === word.toLowerCase()) return word;
  return word.replace(/\p{L}+/gu, (part) => part.charAt(0) + part.slice(1).toLowerCase());
}

/**
 * What a SQL query has to look for to find every candidate.
 *
 * The decision above cannot be made in SQL — it folds accents, splits words
 * and looks at capitals. So the server casts a wider net with `LIKE` and this
 * module makes the real decision on what comes back. Wider is safe; narrower
 * would silently miss leads, which is why `note-names-sql.test.ts` checks the
 * server's query still carries every term below.
 *
 * `%` on both sides of a word, because the note is often inside something
 * longer ("Ahmed - check number"). The folded spelling is enough: the column
 * is `utf8mb4_unicode_ci`, which ignores accents when it compares, so
 * `%prufen%` finds "Prüfen".
 *
 * One rule is deliberately not here: a name with no letters at all. The
 * importer already refuses those (`notAName`), and asking SQL for "no
 * letters" drags every Arabic and Russian name into the net.
 */
export const LIKE_TERMS: readonly string[] = [
  ...NOTE_WORDS.map((word) => `%${word}%`),
  ...NOTE_PHRASES.map((phrase) => `%${phrase}%`),
  ...SENTENCE_ENDS.map((mark) => `%${mark}`),
];
