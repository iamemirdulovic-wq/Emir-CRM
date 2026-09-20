import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv, setEnvForTesting } from '../config/env.js';
import { purgeStaleDocuments, readDocument, readWholeDocument, storeDocument } from './document-store.js';

/**
 * The limit went to 400 MB at the owner's request. Every byte used to be
 * buffered, so one brochure that size meant 400 MB of a process the whole team
 * shares — and two at once meant the CRM went down for everyone. The file is
 * streamed to disk instead, and these hold that.
 */
describe('holding a document while Emir AI reads it', () => {
  let uploads = '';

  beforeEach(() => {
    uploads = mkdtempSync(path.join(tmpdir(), 'emir-doc-'));
    setEnvForTesting({ ...loadEnv(process.env), UPLOAD_DIR: uploads });
  });

  afterEach(() => {
    setEnvForTesting(null);
    rmSync(uploads, { recursive: true, force: true });
  });

  const scratch = () => path.join(uploads, 'scratch');
  const source = (...parts: string[]) => Readable.from(parts.map((p) => Buffer.from(p)));

  it('writes the body to disk and reports its size', async () => {
    const stored = await storeDocument(source('%PDF-1.7', ' brochure'), 1024);

    expect(stored.bytes).toBe(17);
    expect(readFileSync(stored.filePath, 'utf8')).toBe('%PDF-1.7 brochure');
    // Readable by this process and nothing else.
    expect(readdirSync(scratch())).toHaveLength(1);
  });

  /* The whole point: the bytes are on disk, not in a variable. */
  it('streams the stored bytes back without loading them', async () => {
    const stored = await storeDocument(source('abcdef'), 1024);

    const chunks: Buffer[] = [];
    for await (const chunk of readDocument(stored)) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('abcdef');
  });

  /*
   * Counted as the bytes arrive, not afterwards: a limit checked at the end
   * has already accepted what it was meant to refuse.
   */
  it('refuses a file over the limit and keeps nothing', async () => {
    await expect(storeDocument(source('a'.repeat(200)), 100)).rejects.toThrow(/larger than/);
    expect(readdirSync(scratch())).toEqual([]);
  });

  it('refuses an empty body and keeps nothing', async () => {
    await expect(storeDocument(Readable.from([]), 1024)).rejects.toThrow(/empty/);
    expect(readdirSync(scratch())).toEqual([]);
  });

  it('cleans up after an upload that stopped half way', async () => {
    const broken = new Readable({
      read() {
        this.push(Buffer.from('half a file'));
        this.destroy(new Error('connection lost'));
      },
    });

    await expect(storeDocument(broken, 1024)).rejects.toThrow(/did not finish/);
    expect(readdirSync(scratch())).toEqual([]);
  });

  it('discards on request, and does not mind being asked twice', async () => {
    const stored = await storeDocument(source('bytes'), 1024);

    await stored.discard();
    expect(existsSync(stored.filePath)).toBe(false);
    await expect(stored.discard()).resolves.toBeUndefined();
  });

  /* Loading is only ever for a file small enough to go inline anyway. */
  it('refuses to load a file larger than the caller said it would', async () => {
    const stored = await storeDocument(source('a'.repeat(500)), 1024);

    await expect(readWholeDocument(stored, 100)).rejects.toThrow(/into memory/);
    await expect(readWholeDocument(stored, 1000)).resolves.toHaveLength(500);
  });
});

describe('sweeping up what a crash left behind', () => {
  let uploads = '';

  beforeEach(() => {
    uploads = mkdtempSync(path.join(tmpdir(), 'emir-doc-'));
    setEnvForTesting({ ...loadEnv(process.env), UPLOAD_DIR: uploads });
  });
  afterEach(() => {
    setEnvForTesting(null);
    rmSync(uploads, { recursive: true, force: true });
  });

  /*
   * `discard` runs in a finally, so there should be nothing — but a process
   * killed between the write and the read leaves a file nobody returns for,
   * and at 400 MB each that fills a disk quickly.
   */
  it('removes an old scratch file and leaves a fresh one alone', async () => {
    const fresh = await storeDocument(Readable.from([Buffer.from('new')]), 1024);
    const stale = await storeDocument(Readable.from([Buffer.from('old')]), 1024);

    const hourAgo = Date.now() / 1000 - 3 * 60 * 60;
    utimesSync(stale.filePath, hourAgo, hourAgo);

    expect(await purgeStaleDocuments()).toBe(1);
    expect(existsSync(stale.filePath)).toBe(false);
    expect(existsSync(fresh.filePath)).toBe(true);
  });

  it('does not mind there being no scratch directory at all', async () => {
    expect(await purgeStaleDocuments()).toBe(0);
  });
});
