/**
 * Print a VAPID key pair for Web Push.
 *
 * Web Push needs a key pair that identifies this server to the browser's push
 * service. There is nothing secret about generating one — the secret is only
 * in keeping the private half out of the repository, which is why this prints
 * the pair for someone to paste into the host's environment variables rather
 * than writing a file anyone could commit.
 *
 * Generate once. Regenerating invalidates every phone that has already
 * subscribed, and they would each have to allow notifications again.
 *
 *   node scripts/make-vapid-keys.mjs
 */
import { generateKeyPairSync } from 'node:crypto';

/*
 * P-256, which is the only curve the Web Push spec allows. The public key goes
 * out in its uncompressed point form and the private key as its raw 32 bytes,
 * both base64url — that is the shape every push library expects.
 */
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(36, 68);

const b64url = (buffer) => buffer.toString('base64url');

console.log('');
console.log('Copy these two lines into hPanel → Node.js → Environment variables:');
console.log('');
console.log(`VAPID_PUBLIC_KEY=${b64url(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${b64url(priv)}`);
console.log('');
console.log('And add one more, so push services can reach you about problems:');
console.log('');
console.log('VAPID_SUBJECT=mailto:crm@homes.me');
console.log('');
console.log('Keep the private key off any chat, screenshot or repository.');
console.log('');
