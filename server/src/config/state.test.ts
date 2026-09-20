import { mkdtempSync, mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateState } from './state.js';

/**
 * The bug this is about: `./var` sits *inside* the application folder, and a
 * host that replaces that folder on deploy — Hostinger's own git deployment
 * does — takes the encryption key with it. Every deploy then generated a fresh
 * key, the stored Gemini key could no longer be decrypted, and the owner found
 * Emir AI disconnected again with nothing said about why.
 */
describe('rescuing state from the application folder', () => {
  let work = '';
  let cwd = '';

  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'emir-state-'));
    cwd = process.cwd();
    process.chdir(work);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(work, { recursive: true, force: true });
  });

  const legacyKey = () => path.join(work, 'var', 'emir-crm.key');
  const legacyUploads = () => path.join(work, 'var', 'uploads');

  it('moves an existing key somewhere a deploy will not delete it', () => {
    mkdirSync(path.join(work, 'var'), { recursive: true });
    writeFileSync(legacyKey(), 'a'.repeat(64));
    const destination = path.join(work, 'home', '.emir-crm', 'emir-crm.key');

    const { moved, failed } = migrateState(destination, path.join(work, 'home', '.emir-crm', 'uploads'));

    expect(failed).toEqual([]);
    expect(moved.map((row) => row.what)).toContain('the encryption key');
    expect(readFileSync(destination, 'utf8')).toBe('a'.repeat(64));
    // And it is gone from the folder the deploy replaces.
    expect(existsSync(legacyKey())).toBe(false);
  });

  it('brings the uploaded files with it', () => {
    mkdirSync(legacyUploads(), { recursive: true });
    mkdirSync(path.join(legacyUploads(), 'projects'), { recursive: true });
    writeFileSync(path.join(legacyUploads(), 'projects', 'photo.png'), 'bytes');
    const destination = path.join(work, 'home', '.emir-crm', 'uploads');

    migrateState(path.join(work, 'home', '.emir-crm', 'emir-crm.key'), destination);

    expect(readdirSync(path.join(destination, 'projects'))).toEqual(['photo.png']);
  });

  /*
   * Guessing which of two copies is current is how data gets lost. If the new
   * location is already in use, the old one is left exactly where it is.
   */
  it('never overwrites a key that is already in the new place', () => {
    mkdirSync(path.join(work, 'var'), { recursive: true });
    writeFileSync(legacyKey(), 'old'.padEnd(64, '0'));
    const destination = path.join(work, 'home', '.emir-crm', 'emir-crm.key');
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, 'new'.padEnd(64, '0'));

    const { moved } = migrateState(destination, path.join(work, 'home', '.emir-crm', 'uploads'));

    expect(moved).toEqual([]);
    expect(readFileSync(destination, 'utf8')).toBe('new'.padEnd(64, '0'));
    expect(existsSync(legacyKey())).toBe(true);
  });

  it('moves into an empty directory that is already there', () => {
    mkdirSync(legacyUploads(), { recursive: true });
    writeFileSync(path.join(legacyUploads(), 'a.png'), 'bytes');
    const destination = path.join(work, 'home', '.emir-crm', 'uploads');
    mkdirSync(destination, { recursive: true });

    migrateState(path.join(work, 'home', '.emir-crm', 'emir-crm.key'), destination);

    expect(readdirSync(destination)).toEqual(['a.png']);
  });

  it('does nothing when there is nothing to move', () => {
    const { moved, failed } = migrateState(
      path.join(work, 'home', '.emir-crm', 'emir-crm.key'),
      path.join(work, 'home', '.emir-crm', 'uploads'),
    );

    expect(moved).toEqual([]);
    expect(failed).toEqual([]);
  });

  /* A deployment that already points KEY_FILE at ./var means to keep it
     there, and must not have its own file moved out from under it. */
  it('leaves a deliberately configured path alone', () => {
    mkdirSync(path.join(work, 'var'), { recursive: true });
    writeFileSync(legacyKey(), 'k'.repeat(64));

    const { moved } = migrateState(legacyKey(), legacyUploads());

    expect(moved).toEqual([]);
    expect(existsSync(legacyKey())).toBe(true);
  });
});
