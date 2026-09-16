import bcrypt from 'bcryptjs';
import { badRequest } from '../lib/errors.js';

/** Cost 12 per the master prompt. */
export const BCRYPT_COST = 12;
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordAlgo = 'bcrypt' | 'argon2';

/**
 * argon2 is a native module. It is the preferred algorithm, but we fall back to
 * bcrypt when the binding is unavailable (some shared hosts cannot build it).
 */
let argon2Module: typeof import('argon2') | null | undefined;

async function loadArgon2(): Promise<typeof import('argon2') | null> {
  if (argon2Module !== undefined) return argon2Module;
  try {
    argon2Module = await import('argon2');
  } catch {
    argon2Module = null;
  }
  return argon2Module;
}

export function assertPasswordPolicy(password: string): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  // bcrypt silently truncates beyond 72 bytes; reject rather than mislead.
  if (Buffer.byteLength(password, 'utf8') > 200) {
    throw badRequest('Password must be at most 200 bytes');
  }
}

export async function hashPassword(
  password: string,
  preferred: PasswordAlgo = 'argon2',
): Promise<{ hash: string; algo: PasswordAlgo }> {
  assertPasswordPolicy(password);
  if (preferred === 'argon2') {
    const argon2 = await loadArgon2();
    if (argon2) {
      const hash = await argon2.hash(password, { type: argon2.argon2id });
      return { hash, algo: 'argon2' };
    }
  }
  return { hash: await bcrypt.hash(password, BCRYPT_COST), algo: 'bcrypt' };
}

/** Verify against whichever algorithm produced the stored hash. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!password || !storedHash) return false;
  if (storedHash.startsWith('$argon2')) {
    const argon2 = await loadArgon2();
    if (!argon2) return false;
    try {
      return await argon2.verify(storedHash, password);
    } catch {
      return false;
    }
  }
  try {
    return await bcrypt.compare(password, storedHash);
  } catch {
    return false;
  }
}

export function detectAlgo(hash: string): PasswordAlgo {
  return hash.startsWith('$argon2') ? 'argon2' : 'bcrypt';
}

/** A readable temporary password for an admin to hand over. */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = Buffer.from(
    Array.from({ length: 14 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''),
  );
  return `${bytes.toString('utf8')}!7`;
}
