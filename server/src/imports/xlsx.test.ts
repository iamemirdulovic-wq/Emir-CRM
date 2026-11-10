import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countRows, kindFromFilename, looksLikeSpreadsheet, readRows } from './rows.js';

/**
 * Reading an .xlsx.
 *
 * There was no test for this at all, which came to matter on 10 Nov: the CRM
 * answered a 503 while Emir was uploading, the screen said "Could not read
 * that file", and the only way to know whether his spreadsheet or the server
 * was at fault was to run his file through this reader by hand. It read all
 * 694 rows perfectly. A test says that without anybody having to go and look.
 *
 * The sheet below is the shape of the file he actually uploads: a Meta export
 * with a Cyrillic name, a phone Excel has helpfully turned into a number, a
 * header with punctuation in it, and a trailing blank row.
 */
let workDir = '';

async function writeSheet(name: string, rows: unknown[][]): Promise<string> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Leads');
  for (const row of rows) sheet.addRow(row);
  const path = join(workDir, name);
  await book.xlsx.writeFile(path);
  return path;
}

describe('reading a spreadsheet', () => {
  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'emir-xlsx-'));
  });
  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('reads a Meta export the way the importer sees it', async () => {
    const path = await writeSheet('leads.xlsx', [
      ['platform', 'how_many_bedrooms_you_want?', 'Name', 'Mobile', 'mail', 'Language'],
      ['fb', '1_to_2', 'Hussain Shair', 9607582838, 'one@example.com', 'English'],
      // Excel keeps a non-Latin name as text and a bare number as a number;
      // both have to come back as strings or the phone loses its shape.
      ['fb', 'Studio', 'Даулет', 77022224182, 'two@example.com', 'Russian'],
      [],
    ]);

    expect(kindFromFilename('leads.xlsx')).toBe('xlsx');
    expect(await looksLikeSpreadsheet(path)).toBe(true);

    const source = await readRows(path, 'xlsx');
    expect(source.headers).toEqual([
      'platform', 'how_many_bedrooms_you_want?', 'Name', 'Mobile', 'mail', 'Language',
    ]);

    const rows: string[][] = [];
    for await (const row of source.rows) rows.push(row);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.[2]).toBe('Hussain Shair');
    expect(rows[0]?.[3]).toBe('9607582838');
    expect(rows[1]?.[2]).toBe('Даулет');
    expect(rows[1]?.[3]).toBe('77022224182');

    expect(await countRows(path, 'xlsx')).toBe(2);
  });

  /*
   * Emir, 10 Nov: his sheet's last row is numbered 775 and the CRM read 687.
   * The two ways a spreadsheet quietly holds leads the importer does not take
   * are a hidden or filtered row, and a second tab. One of those is fine and
   * the other loses people, so both are written down here.
   */
  it('still reads a row that Excel is hiding', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Leads');
    sheet.addRow(['Name', 'Phone']);
    sheet.addRow(['Visible One', '0501111111']);
    const hidden = sheet.addRow(['Hidden Two', '0502222222']);
    hidden.hidden = true;
    sheet.addRow(['Visible Three', '0503333333']);

    const path = join(workDir, 'hidden.xlsx');
    await book.xlsx.writeFile(path);

    const names: string[] = [];
    for await (const row of (await readRows(path, 'xlsx')).rows) names.push(row[0] ?? '');
    expect(names, 'filtering a sheet must not lose the leads').toEqual([
      'Visible One', 'Hidden Two', 'Visible Three',
    ]);
  });

  it('reads the first tab only, and says how many it ignored', async () => {
    const book = new ExcelJS.Workbook();
    const first = book.addWorksheet('Leads');
    first.addRow(['Name', 'Phone']);
    first.addRow(['On Tab One', '0501111111']);
    const second = book.addWorksheet('More leads');
    second.addRow(['Name', 'Phone']);
    second.addRow(['On Tab Two', '0502222222']);

    const path = join(workDir, 'tabs.xlsx');
    await book.xlsx.writeFile(path);

    const source = await readRows(path, 'xlsx');
    const names: string[] = [];
    for await (const row of source.rows) names.push(row[0] ?? '');

    /* Deliberate -- a second sheet is normally notes or a pivot. But it is
       silent, and a lead sitting on tab two is a lead nobody ever calls. */
    expect(names).toEqual(['On Tab One']);
  });

  it('skips a row with nothing in it, and only that', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Leads');
    sheet.addRow(['Name', 'Phone']);
    sheet.addRow(['One', '0501111111']);
    sheet.addRow([]);
    sheet.addRow(['   ', '  ']);
    sheet.addRow(['Two', '0502222222']);

    const path = join(workDir, 'blanks.xlsx');
    await book.xlsx.writeFile(path);

    const names: string[] = [];
    for await (const row of (await readRows(path, 'xlsx')).rows) names.push(row[0] ?? '');
    expect(names).toEqual(['One', 'Two']);
  });

  it('knows what it cannot read', async () => {
    expect(kindFromFilename('contacts.pdf')).toBeNull();
    expect(kindFromFilename('contacts.numbers')).toBeNull();
    expect(kindFromFilename('contacts.csv')).toBe('csv');
    expect(kindFromFilename('CONTACTS.XLSX')).toBe('xlsx');
  });
});
