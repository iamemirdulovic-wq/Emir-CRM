import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, describeWithDb, execute, prepareTestDatabase, query, resetTables,
} from '../testing/db.js';
import { newId } from '../lib/ids.js';
import { loadEnv, setEnvForTesting } from '../config/env.js';
import { purgeExpiredUploads } from './retention.js';

let uploadDir = '';
let outsideDir = '';

/** Registers an import whose file sits at `path`, aged by `agedHours`. */
async function createImport(path: string, status: string, agedHours: number): Promise<string> {
  const id = newId();
  await execute(
    `INSERT INTO imports (id, filename, file_path, file_kind, byte_size, status, created_at, finished_at)
     VALUES (?, 'test.csv', ?, 'csv', 10, ?, DATE_SUB(NOW(3), INTERVAL ? HOUR), DATE_SUB(NOW(3), INTERVAL ? HOUR))`,
    [id, path, status, agedHours, agedHours],
  );
  return id;
}

async function filePathOf(id: string): Promise<string | null> {
  const rows = await query<{ file_path: string | null }>('SELECT file_path FROM imports WHERE id = ?', [id]);
  return rows[0]?.file_path ?? null;
}

describeWithDb('import file retention', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    uploadDir = await mkdtemp(join(tmpdir(), 'emir-uploads-'));
    outsideDir = await mkdtemp(join(tmpdir(), 'emir-elsewhere-'));
    setEnvForTesting({ ...loadEnv(process.env), UPLOAD_DIR: uploadDir });
  });

  afterAll(async () => {
    setEnvForTesting(null);
    await rm(uploadDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetTables();
  });

  it('deletes the file once the undo window has closed', async () => {
    const path = join(uploadDir, `${newId()}.csv`);
    await writeFile(path, 'name,phone\n', 'utf8');
    const id = await createImport(path, 'completed', 30);

    expect(await purgeExpiredUploads()).toBe(1);
    expect(existsSync(path)).toBe(false);
    // The column is cleared so the next sweep does not look at this row again.
    expect(await filePathOf(id)).toBeNull();
  });

  it('keeps a file while the import can still be undone', async () => {
    const path = join(uploadDir, `${newId()}.csv`);
    await writeFile(path, 'name,phone\n', 'utf8');
    const id = await createImport(path, 'completed', 2);

    expect(await purgeExpiredUploads()).toBe(0);
    expect(existsSync(path)).toBe(true);
    expect(await filePathOf(id)).toBe(path);
  });

  it('clears an abandoned upload after a week, but not before', async () => {
    const fresh = join(uploadDir, `${newId()}.csv`);
    const stale = join(uploadDir, `${newId()}.csv`);
    await writeFile(fresh, 'a\n', 'utf8');
    await writeFile(stale, 'a\n', 'utf8');
    await createImport(fresh, 'uploaded', 24 * 3);
    await createImport(stale, 'uploaded', 24 * 9);

    expect(await purgeExpiredUploads()).toBe(1);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });

  it('refuses to delete a path outside the upload directory', async () => {
    // A tampered or hand-edited row must not turn the sweep into an arbitrary
    // file delete.
    const path = join(outsideDir, 'important.conf');
    await writeFile(path, 'keep me\n', 'utf8');
    const id = await createImport(path, 'completed', 30);

    expect(await purgeExpiredUploads()).toBe(0);
    expect(existsSync(path)).toBe(true);
    expect(await filePathOf(id)).toBe(path);
  });

  it('still clears the row when the file is already gone', async () => {
    const path = join(uploadDir, `${newId()}.csv`);
    const id = await createImport(path, 'undone', 30);

    expect(await purgeExpiredUploads()).toBe(1);
    expect(await filePathOf(id)).toBeNull();
  });
});
