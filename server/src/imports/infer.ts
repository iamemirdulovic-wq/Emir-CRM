/**
 * Guessing what a column holds from the values in it, for files whose headers
 * cannot help.
 *
 * A raw lead export can arrive with no header row at all — the columns are then
 * named "Column 1" through "Column 9", which is honest and useless. But the
 * values are unambiguous where the names are absent: a column of email
 * addresses is an email column, whatever it is called, and a column of phone
 * numbers is a phone column.
 *
 * Deliberately narrow. Only email, phone and full name are inferred, because
 * those three decide whether an import is possible at all — a lead with neither
 * phone nor email cannot be contacted, so every row would be rejected. Budget,
 * project and the rest stay for the agent to map, where a wrong guess would be
 * quietly wrong rather than obviously so.
 */
import type { ColumnMapping, ImportField } from './mapping.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

/**
 * Seven to fifteen digits once punctuation is stripped: the range a telephone
 * number lives in anywhere in the world. Below seven is an extension or a
 * house number; above fifteen is not a phone, whatever else it is.
 */
function isPhoneish(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  // Letters mean it is prose that happens to contain a number.
  return !/[A-Za-z]{2,}/.test(value.replace(/^p:/i, ''));
}

/**
 * Two to four words, letters only. Loose enough for "bruno moreira" and
 * "Ana Oliveira", tight enough to reject an answer to a question.
 */
function isNameish(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 80) return false;
  if (/\d/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  /*
   * \p{L} rather than \w: `\W` is ASCII-only even under the unicode flag, so
   * a class built from it rejects every Arabic, Cyrillic or Chinese name. This
   * CRM sells to Dubai and Abu Dhabi; a name test that only passes Latin script
   * is not a name test.
   */
  return words.every((word) => /^\p{L}+(['\u2019-]\p{L}+)*$/u.test(word));
}

/** How many of a column's non-empty values satisfy a test, as a fraction. */
function share(values: string[], test: (value: string) => boolean): number {
  const filled = values.filter((value) => value.trim() !== '');
  if (filled.length === 0) return 0;
  return filled.filter((value) => test(value.trim())).length / filled.length;
}

/*
 * Three quarters, not all: real exports carry the odd blank, typo or "n/a", and
 * a column that is 80% email addresses is an email column.
 */
const CONFIDENT = 0.75;

export type Sample = {
  /** Column values from the first rows, in column order. */
  columns: string[][];
};

/**
 * Suggest a mapping from values alone. Returns only the columns it is confident
 * about; everything else is left for the agent.
 *
 * `headers` names the columns so the result keys match the rest of the wizard.
 */
export function inferMappingFromValues(headers: string[], sample: Sample): ColumnMapping {
  const mapping: ColumnMapping = {};
  const scores = headers.map((_, index) => {
    const values = sample.columns[index] ?? [];
    return {
      email: share(values, (v) => EMAIL.test(v)),
      phone: share(values, isPhoneish),
      name: share(values, isNameish),
    };
  });

  /*
   * One column per field, best score wins. A Meta export often carries the same
   * phone three times — raw, prefixed and formatted — and mapping all three to
   * `phone` would have the last one silently overwrite the first.
   */
  const claim = (field: ImportField, pick: (s: (typeof scores)[number]) => number) => {
    let bestIndex = -1;
    let bestScore = CONFIDENT;
    scores.forEach((entry, index) => {
      const header = headers[index];
      if (header === undefined || mapping[header]) return;
      const value = pick(entry);
      if (value > bestScore) {
        bestScore = value;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) {
      const header = headers[bestIndex];
      if (header !== undefined) mapping[header] = field;
    }
  };

  // Email first: it is the least ambiguous, and claiming it stops a column of
  // addresses being mistaken for anything else.
  claim('email', (s) => s.email);
  claim('phone', (s) => s.phone);
  claim('fullName', (s) => s.name);

  return mapping;
}

/** Turn preview rows into per-column values for `inferMappingFromValues`. */
export function columnsFromRows(rows: string[][], width: number): Sample {
  const columns: string[][] = Array.from({ length: width }, () => []);
  for (const row of rows) {
    for (let i = 0; i < width; i++) columns[i]?.push(row[i] ?? '');
  }
  return { columns };
}

/**
 * Combine a mapping matched from column names with one inferred from values.
 *
 * Names win wherever they matched something: an agency's own "Mobile No." is
 * better evidence than a sample of twenty rows. Inference fills the rest.
 *
 * The subtlety worth spelling out: a header matcher returns an entry for every
 * column, `null` where it recognised nothing. Spreading that over the inferred
 * mapping therefore erases it — which is exactly the bug this function exists
 * to prevent.
 */
export function preferNamed(inferred: ColumnMapping, named: ColumnMapping): ColumnMapping {
  const out: ColumnMapping = { ...inferred };

  for (const [header, field] of Object.entries(named)) {
    if (field) out[header] = field;
  }

  // A field a name claimed must not stay claimed by inference elsewhere, or two
  // columns would write to it and the second would silently win.
  const claimedByName = new Set(Object.values(named).filter(Boolean));
  for (const [header, field] of Object.entries(out)) {
    if (field && claimedByName.has(field) && named[header] !== field) out[header] = null;
  }

  return out;
}
