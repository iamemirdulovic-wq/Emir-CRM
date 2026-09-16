import { describe, expect, it } from 'vitest';
import { assertPasswordPolicy, detectAlgo, generateTemporaryPassword, hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('hashes and verifies with argon2 by default', async () => {
    const { hash, algo } = await hashPassword('correct horse battery');
    expect(algo).toBe('argon2');
    expect(hash).not.toContain('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('hashes and verifies with bcrypt when asked', async () => {
    const { hash, algo } = await hashPassword('correct horse battery', 'bcrypt');
    expect(algo).toBe('bcrypt');
    expect(hash.startsWith('$2')).toBe(true);
    expect(detectAlgo(hash)).toBe('bcrypt');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('Correct horse battery', hash)).toBe(false);
  });

  it('enforces the 8 character minimum', () => {
    expect(() => assertPasswordPolicy('short')).toThrowError(/at least 8/);
    expect(() => assertPasswordPolicy('12345678')).not.toThrow();
  });

  it('never verifies against an empty hash', async () => {
    expect(await verifyPassword('anything', '')).toBe(false);
    expect(await verifyPassword('', '$2a$12$abcdefghijklmnopqrstuv')).toBe(false);
  });

  it('generates temporary passwords that satisfy the policy', () => {
    for (let i = 0; i < 20; i += 1) {
      const pw = generateTemporaryPassword();
      expect(pw.length).toBeGreaterThanOrEqual(8);
      expect(() => assertPasswordPolicy(pw)).not.toThrow();
    }
  });
});
