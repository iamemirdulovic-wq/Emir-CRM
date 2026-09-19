import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { env } from '../config/env.js';

const ALGO = 'aes-256-gcm';
const PREFIX = 'v1';

function keyBuffer(): Buffer {
  const raw = env().ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is not configured; cannot encrypt or decrypt tokens at rest');
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256)');
  return buf;
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
