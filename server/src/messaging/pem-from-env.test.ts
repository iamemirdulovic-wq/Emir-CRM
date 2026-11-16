import { generateKeyPairSync, createSign } from 'node:crypto';
import { expect, it } from 'vitest';
import { pemFromEnv } from './push.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const signs = (key: string) => {
  try {
    createSign('RSA-SHA256').update('x').sign(key, 'base64url');
    return true;
  } catch {
    return false;
  }
};

it('signs with the key however the hosting panel mangled it', () => {
  /* Three shapes a one-line environment field hands back. The third logged
     "FCM_PRIVATE_KEY cannot be used to sign" on every send for a day. */
  expect(signs(pemFromEnv(pem))).toBe(true);
  expect(signs(pemFromEnv(pem.replace(/\n/g, '\\n')))).toBe(true);
  expect(signs(pemFromEnv(pem.replace(/\n/g, '')))).toBe(true);
  expect(signs(pemFromEnv(pem.replace(/\n/g, ' ')))).toBe(true);
});
