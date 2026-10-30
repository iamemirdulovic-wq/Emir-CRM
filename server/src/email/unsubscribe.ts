/**
 * The unsubscribe link.
 *
 * Signed rather than stored. A random token in a table would work, but it
 * means a row per contact, a lookup on every click, and a token that has to be
 * created before the first email can be sent — three things to go wrong in the
 * path whose failure mode is "we kept emailing someone who asked us to stop".
 *
 * So the token is the contact id plus an HMAC of it. Nothing to create, nothing
 * to look up, nothing to expire, and a link that cannot be guessed or altered:
 * changing the id invalidates the signature, and the signing key never leaves
 * the server.
 *
 * It is deliberately not expiring. A client who finds a two-year-old email and
 * presses unsubscribe means it, and an expired link that quietly does nothing
 * is how a complaint becomes a spam report.
 */
import { createHmac } from 'node:crypto';
import { derivedKey, safeEqual } from '../lib/crypto.js';
import { env } from '../config/env.js';

const LABEL = 'email-unsubscribe';
/** Enough to be unforgeable, short enough not to wrap in a mail client. */
const SIGNATURE_LENGTH = 16;

function sign(contactId: string): string {
  return createHmac('sha256', derivedKey(LABEL))
    .update(contactId)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

export function unsubscribeToken(contactId: string): string {
  return `${contactId}.${sign(contactId)}`;
}

/** The contact the token names, or null if it has been tampered with. */
export function contactFromToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const contactId = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!signature) return null;
  return safeEqual(sign(contactId), signature) ? contactId : null;
}

export function unsubscribeUrl(contactId: string): string {
  return `${env().APP_URL.replace(/\/+$/, '')}/u/${unsubscribeToken(contactId)}`;
}

/**
 * The `List-Unsubscribe` headers.
 *
 * Gmail and Outlook show a one-click unsubscribe button when these are
 * present, and that button is the difference between a client pressing it and
 * a client pressing "report spam" — which damages the domain for everyone.
 * The POST form is required by RFC 8058 for the one-click version.
 */
export function unsubscribeHeaders(contactId: string): Record<string, string> {
  const url = `${env().APP_URL.replace(/\/+$/, '')}/u/${unsubscribeToken(contactId)}`;
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
