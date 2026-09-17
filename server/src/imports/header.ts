/**
 * Working out where a spreadsheet's data actually starts.
 *
 * The naive rule — "row 1 is the header" — breaks on the two shapes real
 * exports arrive in:
 *
 *   1. A title above the headers. Ads managers and portals write the campaign
 *      or report name in A1 and the real headers underneath.
 *   2. No headers at all. A raw lead export can begin straight into data, so
 *      taking row 1 as the header both loses a lead and names every column
 *      after that lead's answers.
 *
 * Both were found in one real Meta export: a title row, then 1,447 rows of
 * leads with nothing naming the columns.
 *
 * The cost of guessing wrong is asymmetric, which is why the tests below lean
 * the way they do. Mistaking a header for data costs a junk row the agent can
 * see and delete. Mistaking data for a header silently swallows a lead and
 * mislabels every column — so the rules only call a row "data" on evidence a
 * header would never carry: an email address, a phone number, or a row that is
 * mostly numbers.
 */

const EMAIL = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;
/** Seven digits or more in one cell: a phone, an id, a price — never a label. */
const LONG_DIGIT_RUN = /\d[\d\s().+-]{5,}\d/;
const MOSTLY_DIGITS = /^[\d\s.,+-]+$/;

const nonEmpty = (row: string[]) => row.filter((cell) => cell.trim() !== '');

/**
 * A title or spacer line: one filled cell, or none, where the file is wider
 * than that. Two cells could legitimately be a narrow header, so the bar is one.
 */
function isTitleRow(row: string[], width: number): boolean {
  return width >= 3 && nonEmpty(row).length <= 1;
}

/** Does this row carry values no column label ever would? */
export function looksLikeData(row: string[]): boolean {
  const cells = nonEmpty(row).map((cell) => cell.trim());
  if (cells.length === 0) return false;

  if (cells.some((cell) => EMAIL.test(cell))) return true;
  if (cells.some((cell) => LONG_DIGIT_RUN.test(cell))) return true;

  const numeric = cells.filter((cell) => MOSTLY_DIGITS.test(cell)).length;
  return numeric * 2 > cells.length;
}

export type HeaderChoice = {
  headers: string[];
  /** Rows to drop from the front of the file before the data begins. */
  skip: number;
  /** True when the file had no header row and these names were invented. */
  generated: boolean;
};

/**
 * Decide the headers from the first rows of a file.
 *
 * `sample` should be the first handful of rows — ten is plenty. Returns the
 * headers to use and how many rows to discard before the data.
 */
export function chooseHeader(sample: string[][]): HeaderChoice {
  if (sample.length === 0) return { headers: [], skip: 0, generated: false };

  const width = Math.max(...sample.map((row) => nonEmpty(row).length));
  const columns = Math.max(...sample.map((row) => row.length));

  let index = 0;
  while (index < sample.length && isTitleRow(sample[index] as string[], width)) index += 1;

  // Nothing but titles and blanks: treat the file as headerless rather than
  // naming the columns after a campaign.
  if (index >= sample.length) {
    return { headers: generatedNames(columns), skip: index, generated: true };
  }

  const candidate = sample[index] as string[];
  if (looksLikeData(candidate)) {
    // The data starts here, so this row must be kept, not consumed as a header.
    return { headers: generatedNames(columns), skip: index, generated: true };
  }

  return {
    headers: candidate.map((cell) => cell.trim()),
    skip: index + 1,
    generated: false,
  };
}

/**
 * Names for a file that has none. Numbered from 1 because the wizard shows them
 * beside the first values from each column, and "Column 7" next to a list of
 * phone numbers is something a person can act on.
 */
function generatedNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Column ${i + 1}`);
}
