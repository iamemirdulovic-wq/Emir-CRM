import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env, setEnvForTesting } from '../config/env.js';
import { decryptSecret, encryptSecret, encryptionReady, resetKeyFileCache } from './crypto.js';

/**
 * The key on disk.
 *
 * This exists so an owner on managed hosting, with no terminal, still gets
 * their secrets encrypted. The tests that matter most are the ones about *not*
 * losing it: a key that is silently replaced makes every stored secret
 * undecryptable, and nobody finds out until they need one.
 */
describe('the encryption key when none is configured', () => {
  let dir = '';
  let keyFile = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'emir-key-'));
    keyFile = join(dir, 'nested', 'emir-crm.key');
    resetKeyFileCache();
    setEnvForTesting({ ...env(), ENCRYPTION_KEY: undefined, KEY_FILE: keyFile });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetKeyFileCache();
    setEnvForTesting(null);
  });

  it('creates a key on first use, making the directory if needed', () => {
    expect(encryptionReady()).toBe(true);
    const contents = readFileSync(keyFile, 'utf8');
    expect(contents).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes it readable only by this process', () => {
    encryptSecret('x');
    // 0600 — owner read/write, nothing for anyone else.
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
  });

  it('round-trips a secret with it', () => {
    const cipher = encryptSecret('AQ.some-api-key');
    expect(cipher).not.toContain('some-api-key');
    expect(decryptSecret(cipher)).toBe('AQ.some-api-key');
  });

  /*
   * The important one. Regenerating over an existing file would not fail — it
   * would quietly make every stored secret undecryptable, and the owner would
   * find out the next time the AI stopped working.
   */
  it('reuses the same key rather than making a new one', () => {
    const cipher = encryptSecret('remember me');
    const first = readFileSync(keyFile, 'utf8');

    resetKeyFileCache(); // as if the process restarted
    expect(decryptSecret(cipher)).toBe('remember me');
    expect(readFileSync(keyFile, 'utf8')).toBe(first);
  });

  it('refuses a corrupt key file instead of replacing it', () => {
    encryptSecret('x');
    writeFileSync(keyFile, 'this is not a key');
    resetKeyFileCache();

    expect(() => encryptSecret('y')).toThrow(/32 bytes/);
    // And it left the file alone, so a backup can still be put back.
    expect(readFileSync(keyFile, 'utf8')).toBe('this is not a key');
  });

  it('lets ENCRYPTION_KEY win when it is set', () => {
    const fromEnv = 'a'.repeat(64);
    setEnvForTesting({ ...env(), ENCRYPTION_KEY: fromEnv, KEY_FILE: keyFile });
    resetKeyFileCache();

    const cipher = encryptSecret('hello');
    expect(decryptSecret(cipher)).toBe('hello');
    // The file was never needed, so it was never made.
    expect(() => readFileSync(keyFile, 'utf8')).toThrow();
  });

  it('still reports a bad ENCRYPTION_KEY rather than quietly falling back', () => {
    setEnvForTesting({ ...env(), ENCRYPTION_KEY: 'too-short', KEY_FILE: keyFile });
    resetKeyFileCache();
    expect(encryptionReady()).toBe(false);
  });
});
