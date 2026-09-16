import { randomBytes, randomUUID } from 'node:crypto';

/** Primary keys are UUID v4 strings stored as CHAR(36). */
export function newId(): string {
  return randomUUID();
}

/** URL-safe opaque token (session ids, tracking slugs). */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
