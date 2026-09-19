import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from './logger.js';

const ALGO = 'aes-256-gcm';
const PREFIX = 'v1';

function parseKey(raw: string, source: string): Buffer {
  const trimmed = raw.trim();
  const buf = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (buf.length !== 32) {
    throw new Error(`${source} must decode to exactly 32 bytes (AES-256); got ${buf.length}`);
  }
  return buf;
}

let fileKey: Buffer | null = null;

/**
 * The key kept on disk, created once if it is not there.
 *
 * ENCRYPTION_KEY in the environment is still the preferred way and always wins.
 * This exists because on managed hosting the owner has no terminal, and an
 * encryption key that can only be set through a control panel is an encryption
 * key that never gets set — which means nothing is encrypted at all, which is
 * strictly worse than this.
 *
 * On disk rather than in the database on purpose. The leak that actually
 * happens is a database dump — a backup copied somewhere careless, a restore
 * onto a laptop — and this file is not in it. Against an attacker who already
 * has the server, a file is no weaker than an environment variable: both are
 * readable to the process and to anyone who owns it.
 *
 * It is never regenerated over an existing file. A new key would not fail
 * loudly, it would quietly make every stored secret undecryptable, so a
 * malformed file is an error the owner has to look at.
 */
function keyFromFile(): Buffer {
  if (fileKey) return fileKey;

  const file = path.resolve(env().KEY_FILE);
  if (existsSync(file)) {
    fileKey = parseKey(readFileSync(file, 'utf8'), `the key file at ${file}`);
    return fileKey;
  }

  const generated = randomBytes(32).toString('hex');
  mkdirSync(path.dirname(file), { recursive: true });
  /*
   * Written to a temporary name and renamed, so a crash half-way cannot leave
   * a truncated key that looks valid on the next boot. 0600: readable by this
   * process and nothing else.
   */
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temp, generated, { mode: 0o600 });
  renameSync(temp, file);

  logger.warn('no ENCRYPTION_KEY was set, so one was created', {
    file,
    note: 'Back this file up. If it is lost, anything encrypted with it — API keys, stored tokens — has to be entered again.',
  });

  fileKey = Buffer.from(generated, 'hex');
  return fileKey;
}

function keyBuffer(): Buffer {
  const raw = env().ENCRYPTION_KEY;
  // The environment wins, unchanged.
  if (raw) return parseKey(raw, 'ENCRYPTION_KEY');
  return keyFromFile();
}

/** Test helper: forget the cached file key so a suite can point at another. */
export function resetKeyFileCache(): void {
  fileKey = null;
}

/**
 * Can anything be encrypted at all?
 *
 * Callers use this to say something useful *before* trying, rather than letting
 * a key of the wrong length surface as a 500 with a message about AES that
 * means nothing to the person who has to fix it.
 */
export function encryptionReady(): boolean {
  try {
    keyBuffer();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt a secret for storage at rest. Output: v1:<iv>:<tag>:<ciphertext> (base64url). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyBuffer(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join(':');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('Malformed encrypted payload');
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv(ALGO, keyBuffer(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

/** Constant-time string comparison that tolerates differing lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Meta / WhatsApp webhook signature: sha256=<hex hmac of the raw body>. */
export function verifyMetaSignature(rawBody: Buffer | string, header: string | undefined, appSecret: string): boolean {
  if (!header) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(expected, header);
}

/** Website form signature: hex HMAC-SHA256 of the raw body, optionally prefixed. */
export function verifyHmacSignature(rawBody: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  const candidate = header.startsWith('sha256=') ? header.slice(7) : header;
  return safeEqual(digest, candidate);
}

/** Meta Conversions API requires SHA-256 of normalized user data. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Opaque, non-reversible token used to look up sessions without storing the raw value. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
