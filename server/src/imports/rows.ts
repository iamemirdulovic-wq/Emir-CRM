/**
 * Reading rows out of an uploaded file, whatever shape it arrived in.
 *
 * Both readers stream. A hundred-thousand-row file is normal for an old agency
 * database, and the whole point of the chunked import job is that nothing ever
 * holds all of it at once.
 */
import { createReadStream } from 'node:fs';
import ExcelJS from 'exceljs';
import { parseCsvFile, parseCsvStream } from './csv.js';
import { chooseHeader } from './header.js';
import { logger } from '../lib/logger.js';

export type FileKind = 'csv' | 'xlsx' | 'paste';

/** Header row plus every data row, as arrays of strings. */
export interface RowSource {
  headers: string[];
  rows: AsyncGenerator<string[]>;
  /**
   * True when the file had no header row and the columns were named by
   * position. The wizard says so, because "Column 7" is only meaningful next to
   * the values underneath it.
   */
  generatedHeaders?: boolean;
}

/** Excel gives back dates, numbers, formulas and rich text; the CRM wants text. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const cell = value as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: unknown };
    if (Array.isArray(cell.richText)) return cell.richText.map((part) => part.text).join('');
    if (cell.text !== undefined) return String(cell.text);
    // A formula cell carries its computed result; the formula itself is noise.
    if (cell.result !== undefined) return String(cell.result);
    if (cell.hyperlink !== undefined) return String(cell.hyperlink);
    return '';
  }
  return String(value);
}

async function* xlsxRows(path: string): AsyncGenerator<string[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    // Shared strings and styles have to be held to resolve cells, but rows are
    // released as soon as they are yielded.
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
    entries: 'emit',
  });

  for await (const worksheet of reader) {
    for await (const row of worksheet) {
      const values = row.values as unknown[];
      // ExcelJS pads index 0; a fully empty row is a spacer, not data.
      const cells = values.slice(1).map(cellText);
      if (cells.some((cell) => cell.trim() !== '')) yield cells;
    }
    // Only the first sheet. A second sheet in a lead export is notes or a
    // pivot, never more leads, and importing it silently would be worse.
    break;
  }
}

/**
 * How many rows to look at before deciding where the header is. Ten is far more
 * than any title block, and small enough to buffer for a file of any size.
 */
const HEADER_SAMPLE = 10;

/**
 * Work out the headers, then yield the data.
 *
 * Buffered rather than read one row at a time, because "is this a header?"
 * cannot be answered from that row alone — a title is only a title because the
 * rows beneath it are wider, and a headerless file is only recognisable by its
 * first row already carrying an email or a phone number.
 */
async function withHeaders(rows: AsyncGenerator<string[]>): Promise<RowSource> {
  const sample: string[][] = [];
  for (let i = 0; i < HEADER_SAMPLE; i++) {
    const next = await rows.next();
    if (next.done) break;
    sample.push(next.value);
  }
  if (sample.length === 0) return { headers: [], rows: emptyRows() };

  const choice = chooseHeader(sample);
  if (choice.generated) {
    logger.info('the file has no header row; naming the columns by position', {
      columns: choice.headers.length,
      skippedTitleRows: choice.skip,
    });
  }

  // The sample rows we did not consume as a header are data, and have to be
  // handed back before the rest of the file.
  const remaining = sample.slice(choice.skip);
  async function* all(): AsyncGenerator<string[]> {
    for (const row of remaining) yield row;
    yield* rows;
  }

  return { headers: choice.headers, rows: all(), generatedHeaders: choice.generated };
}

async function* emptyRows(): AsyncGenerator<string[]> {
  // Nothing to yield; the generator exists so callers can treat every source
  // the same way.
}

export async function readRows(path: string, kind: FileKind): Promise<RowSource> {
  if (kind === 'xlsx') return withHeaders(xlsxRows(path));
  return withHeaders(parseCsvFile(path));
}

/** Paste-from-sheet arrives as tab-separated text in the request body. */
export async function readPasted(text: string): Promise<RowSource> {
  const { Readable } = await import('node:stream');
  return withHeaders(parseCsvStream(Readable.from([text]), { delimiter: '\t' }));
}

/** The first `limit` rows, for the wizard's preview. Stops reading there. */
export async function previewRows(
  path: string,
  kind: FileKind,
  limit = 20,
): Promise<{ headers: string[]; rows: string[][]; generatedHeaders: boolean }> {
  const source = await readRows(path, kind);
  const rows: string[][] = [];
  for await (const row of source.rows) {
    rows.push(row);
    if (rows.length >= limit) break;
  }
  await source.rows.return?.(undefined as never);
  return { headers: source.headers, rows, generatedHeaders: source.generatedHeaders ?? false };
}

/** Counts data rows without keeping any. Used to size the progress bar. */
export async function countRows(path: string, kind: FileKind): Promise<number> {
  const source = await readRows(path, kind);
  let count = 0;
  for await (const _row of source.rows) count++;
  return count;
}

/** True when the file looks like something we can read at all. */
export function kindFromFilename(filename: string): FileKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) return 'csv';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return 'xlsx';
  return null;
}

/** Used by the upload route to reject a file before it is written to disk. */
export function looksLikeSpreadsheet(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const stream = createReadStream(path, { start: 0, end: 3 });
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk as Buffer));
    stream.on('error', () => resolve(false));
    // Every .xlsx is a zip, so it starts "PK".
    stream.on('end', () => resolve(Buffer.concat(chunks).subarray(0, 2).toString() === 'PK'));
  });
}
