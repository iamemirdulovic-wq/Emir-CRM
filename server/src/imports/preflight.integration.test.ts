import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, describeWithDb, execute, prepareTestDatabase, query, resetTables,
} from '../testing/db.js';
import { newId } from '../lib/ids.js';
import { defaultSettings, type ImportSettings } from './normalize.js';
import { suggestMapping } from './mapping.js';
import { runChunk, stageRows } from './run.js';
import { preflight } from './preflight.js';

/**
 * The split shown before an import runs.
 *
 * One rule matters more than all the others here: **the preflight's answer
 * and the import's answer are the same answer.** The screen says "208 new
 * leads" and somebody presses Import on the strength of it; if the run then
 * creates 191, the number was a lie. So the test does not check the counts
 * against hand-written expectations alone — it runs the import afterwards and
 * compares.
 */
let workDir = '';

async function anImport(csv: string, over: Partial<ImportSettings> = {}): Promise<string> {
  const importId = newId();
  const path = join(workDir, `${importId}.csv`);
  await writeFile(path, csv, 'utf8');
  const headers = (csv.split('\n')[0] ?? '').split(',').map((header) => header.trim());
  await execute(
    `INSERT INTO imports (id, filename, file_path, file_kind, byte_size, status, headers, mapping, settings)
     VALUES (?, 'test.csv', ?, 'csv', ?, 'uploaded', ?, ?, ?)`,
    [
      importId, path, Buffer.byteLength(csv),
      JSON.stringify(headers),
      JSON.stringify(suggestMapping(headers)),
      JSON.stringify({ ...defaultSettings(), sourceLabel: 'Test import', ...over }),
    ],
  );
  await stageRows(importId);
  return importId;
}

async function runAll(importId: string): Promise<void> {
  for (let guard = 0; guard < 50; guard++) {
    if ((await runChunk(importId)).done) return;
  }
  throw new Error('import did not finish');
}

describeWithDb('import preflight', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    workDir = await mkdtemp(join(tmpdir(), 'emir-preflight-'));
  });
  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
    await closeTestDatabase();
  });
  beforeEach(async () => { await resetTables(); });

  it('splits a file into new, duplicate and bad without writing anything', async () => {
    const importId = await anImport([
      'Full Name,Mobile No.',
      'Sara Ahmed,0501234567',
      'Omar Haddad,0559876543',
      /* The same person again, later in the same file. */
      'Sara A.,0501234567',
      /* No phone at all. */
      'Hamad R.,',
      /* Not a number anybody can ring. */
      'Julia Stein,0550',
      /*
       * A phone and no name. This one IS a lead: somebody who can be rung is
       * contactable, and the CRM would rather hold a number with no name than
       * throw the number away. Counted as new, not bad.
       */
      ',0521112222',
    ].join('\n'));

    const before = await query('SELECT id FROM contacts');
    const got = await preflight(importId);

    expect(got.total).toBe(6);
    expect(got.fresh).toBe(3);
    expect(got.duplicates).toBe(1);
    expect(got.invalid).toBe(2);

    /* Nothing was written. That is the whole promise of the screen it feeds:
       "Nothing is in the CRM yet." */
    expect(await query('SELECT id FROM contacts')).toHaveLength(before.length);
    const touched = await query(
      "SELECT id FROM import_rows WHERE import_id = ? AND status <> 'pending'", [importId],
    );
    expect(touched).toHaveLength(0);

    /* The reasons are there to be read, not just counted. */
    expect(got.invalidReasons.reduce((sum, one) => sum + one.n, 0)).toBe(2);
    expect(got.invalidRows.length).toBe(2);
    for (const row of got.invalidRows) expect(row.detail).toBeTruthy();
  });

  it('predicts exactly what the import then does', async () => {
    /* Somebody already in the CRM, put there by an earlier import. */
    const first = await anImport([
      'Full Name,Mobile No.',
      'Marco Bellini,0501110000',
      'Lina Rahimi,0502220000',
    ].join('\n'));
    await runAll(first);

    /*
     * "Skip them" — which is what the screen's first chip is set to, and the
     * only strategy under which a duplicate stays exactly as it is, with its
     * agent. Under the default, `fill_empty`, the same row is counted as
     * updated instead; the preflight calls it a duplicate either way, because
     * what it is answering is "will this row become a new lead", and the
     * answer is no in both cases.
     */
    const second = await anImport([
      'Full Name,Mobile No.',
      'Marco Bellini,0501110000',
      'Dave Patel,0503330000',
      'Nadia Haddad,0504440000',
      'Hamad R.,',
    ].join('\n'), { duplicateStrategy: 'skip' });

    const predicted = await preflight(second);
    expect(predicted.fresh).toBe(2);
    expect(predicted.duplicates).toBe(1);
    expect(predicted.invalid).toBe(1);

    await runAll(second);
    const after = await query<{ created_count: number; skipped_count: number }>(
      'SELECT created_count, skipped_count FROM imports WHERE id = ?', [second],
    );
    const run = after[0]!;
    expect(Number(run.created_count)).toBe(predicted.fresh);
    /* `imports.skipped_count` is duplicates and bad rows added together — the
       run has folded the two since it was written. The split the Done screen
       shows comes from the rows themselves, which is where it survives. */
    expect(Number(run.skipped_count)).toBe(predicted.duplicates + predicted.invalid);

    const byStatus = await query<{ status: string; n: number }>(
      'SELECT status, COUNT(*) AS n FROM import_rows WHERE import_id = ? GROUP BY status',
      [second],
    );
    const count = (status: string) => Number(byStatus.find((row) => row.status === status)?.n ?? 0);
    expect(count('created')).toBe(predicted.fresh);
    expect(count('skipped')).toBe(predicted.duplicates);
    expect(count('invalid')).toBe(predicted.invalid);
  });

  it('says who holds each duplicate now', async () => {
    const first = await anImport([
      'Full Name,Mobile No.',
      'Marco Bellini,0501110000',
    ].join('\n'));
    await runAll(first);

    const second = await anImport([
      'Full Name,Mobile No.',
      'Marco Bellini,0501110000',
    ].join('\n'));
    const got = await preflight(second);

    expect(got.duplicates).toBe(1);
    expect(got.duplicateRows).toHaveLength(1);
    /* Unassigned, so it is waiting in Incoming — which is what decides
       whether skipping it is the right call. */
    expect(got.duplicateRows[0]?.detail).toBe('in Incoming');
    expect(got.duplicateRows[0]?.name).toBe('Marco Bellini');
  });

  it('counts a file of nothing but bad rows without falling over', async () => {
    const importId = await anImport(['Full Name,Mobile No.', ',', ',', ','].join('\n'));
    const got = await preflight(importId);
    expect(got.total).toBe(3);
    expect(got.fresh).toBe(0);
    expect(got.invalid).toBe(3);
    expect(got.duplicateRows).toHaveLength(0);
  });
});
