/**
 * A streaming CSV reader.
 *
 * Written by hand rather than pulled in, because the requirement is narrow and
 * specific: files of a hundred thousand rows and more must never be held in
 * memory at once. This reads a character at a time off a stream and yields one
 * row as soon as it is complete, so peak memory is one row plus one chunk.
 *
 * It implements RFC 4180 as spreadsheets actually write it:
 *  - fields separated by a delimiter, rows by CR, LF or CRLF;
 *  - a field may be quoted, in which case it may contain the delimiter,
 *    newlines, and doubled quotes ("") meaning one literal quote;
 *  - a UTF-8 byte-order mark at the start is discarded, because Excel writes
 *    one and it would otherwise become part of the first column's name.
 */
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

const BOM = '﻿';

/** Delimiters worth guessing between. Excel in some locales writes semicolons. */
const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'] as const;

/**
 * Picks the delimiter from the first line: the candidate that splits it into
 * the most fields wins, and a comma wins a tie.
 */
export function sniffDelimiter(firstLine: string): string {
  let best = ',';
  let bestCount = 0;
  for (const candidate of CANDIDATE_DELIMITERS) {
    const count = splitSimple(firstLine, candidate).length;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Splits a single line, respecting quotes. Used only for sniffing. */
function splitSimple(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i] as string;
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') inQuotes = false;
      else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === delimiter) {
      out.push(field);
      field = '';
    } else field += char;
  }
  out.push(field);
  return out;
}

/**
 * Yields each row as an array of strings. `delimiter` is sniffed from the first
 * line when it is not given.
 */
export async function* parseCsvStream(
  input: Readable,
  options: { delimiter?: string } = {},
): AsyncGenerator<string[]> {
  input.setEncoding('utf8');

  let delimiter = options.delimiter ?? null;
  let pending = '';
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let startOfFile = true;
  /** A CR may be the first half of a CRLF, so the LF that follows is skipped. */
  let lastWasCr = false;

  for await (const chunk of input) {
    pending += chunk as string;

    if (startOfFile) {
      if (pending.startsWith(BOM)) pending = pending.slice(BOM.length);
      startOfFile = false;
    }

    // Sniffing needs a whole line, so hold off until one has arrived. A file
    // with no newline at all is sniffed from everything we have at the end.
    if (delimiter === null) {
      const newline = pending.search(/\r|\n/);
      if (newline === -1) continue;
      delimiter = sniffDelimiter(pending.slice(0, newline));
    }

    let consumed = 0;
    for (let i = 0; i < pending.length; i++) {
      const char = pending[i] as string;

      if (inQuotes) {
        if (char === '"') {
          if (i + 1 >= pending.length) break; // need the next character to decide
          if (pending[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += char;
        consumed = i + 1;
        continue;
      }

      if (char === '"' && field === '') {
        inQuotes = true;
      } else if (char === delimiter) {
        row.push(field);
        field = '';
      } else if (char === '\n' || char === '\r') {
        // Swallow the LF of a CRLF rather than emitting an empty row.
        if (char === '\n' && lastWasCr) {
          lastWasCr = false;
          consumed = i + 1;
          continue;
        }
        lastWasCr = char === '\r';
        row.push(field);
        field = '';
        yield row;
        row = [];
      } else {
        field += char;
        lastWasCr = false;
      }
      consumed = i + 1;
    }

    pending = pending.slice(consumed);
  }

  // Whatever is left after the last chunk. A trailing newline leaves nothing,
  // and an unterminated final row is still a row.
  if (delimiter === null && pending) delimiter = sniffDelimiter(pending);
  for (const char of pending) {
    if (inQuotes && char === '"') inQuotes = false;
    else if (char === '"' && field === '') inQuotes = true;
    else if (!inQuotes && char === delimiter) {
      row.push(field);
      field = '';
    } else if (!inQuotes && (char === '\n' || char === '\r')) {
      // handled below
    } else field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    yield row;
  }
}

export function parseCsvFile(path: string, options: { delimiter?: string } = {}): AsyncGenerator<string[]> {
  return parseCsvStream(createReadStream(path), options);
}

/** Quotes a value for a CSV we write — the failed-rows download. */
export function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /["\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsvRow(values: unknown[]): string {
  return `${values.map(csvEscape).join(',')}\r\n`;
}
