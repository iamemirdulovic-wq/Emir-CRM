import { describe, expect, it, beforeAll } from 'vitest';
import { contactFromToken, unsubscribeHeaders, unsubscribeToken, unsubscribeUrl } from './unsubscribe.js';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.APP_URL = 'https://crm.homes.me';
});

const CONTACT = '8f14e45f-ceea-467a-9c3f-1b2c3d4e5f60';

describe('the unsubscribe token', () => {
  it('round-trips back to the contact', () => {
    expect(contactFromToken(unsubscribeToken(CONTACT))).toBe(CONTACT);
  });

  it('is stable, so an old email’s link still works', () => {
    expect(unsubscribeToken(CONTACT)).toBe(unsubscribeToken(CONTACT));
  });

  it('differs per contact, so one link cannot unsubscribe another person', () => {
    expect(unsubscribeToken(CONTACT)).not.toBe(unsubscribeToken('other-contact-id'));
  });

  it('refuses a token whose contact id has been edited', () => {
    const token = unsubscribeToken(CONTACT);
    const tampered = token.replace(CONTACT, 'aaaaaaaa-ceea-467a-9c3f-1b2c3d4e5f60');
    expect(contactFromToken(tampered)).toBeNull();
  });

  it('refuses a token whose signature has been edited', () => {
    const token = unsubscribeToken(CONTACT);
    expect(contactFromToken(`${token}x`)).toBeNull();
  });

  it('refuses a made-up token', () => {
    expect(contactFromToken('just-some-id.AAAAAAAAAAAAAAAA')).toBeNull();
  });

  it('refuses rubbish without throwing', () => {
    expect(contactFromToken('')).toBeNull();
    expect(contactFromToken('.')).toBeNull();
    expect(contactFromToken('nodot')).toBeNull();
    expect(contactFromToken(`${CONTACT}.`)).toBeNull();
  });

  it('is short enough not to wrap in a mail client', () => {
    expect(unsubscribeToken(CONTACT).length).toBeLessThan(60);
  });
});

describe('the link and the headers', () => {
  it('is an absolute URL under the app', () => {
    expect(unsubscribeUrl(CONTACT)).toMatch(/^https:\/\/crm\.homes\.me\/u\//);
  });

  it('does not double the slash when APP_URL has a trailing one', () => {
    process.env.APP_URL = 'https://crm.homes.me/';
    expect(unsubscribeUrl(CONTACT)).not.toContain('me//u/');
    process.env.APP_URL = 'https://crm.homes.me';
  });

  it('offers the one-click headers Gmail and Outlook use', () => {
    const headers = unsubscribeHeaders(CONTACT);
    expect(headers['List-Unsubscribe']).toMatch(/^<https:\/\/crm\.homes\.me\/u\/.+>$/);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});
