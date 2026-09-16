import { describe, expect, it } from 'vitest';
import { buildReplyAddress, normalizeEmail, parseReplyAddress } from './email.js';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Buyer@Example.COM ')).toBe('buyer@example.com');
  });

  it('unwraps angle brackets', () => {
    expect(normalizeEmail('<buyer@example.com>')).toBe('buyer@example.com');
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['', 'nope', 'a@b', 'a b@c.com', null, undefined]) {
      expect(normalizeEmail(bad as string), String(bad)).toBeNull();
    }
  });
});

describe('reply addressing', () => {
  it('round-trips a conversation id', () => {
    const addr = buildReplyAddress('4f9a1b2c-1111-2222-3333-444455556666', 'mail.emircrm.ae');
    expect(parseReplyAddress(addr)).toBe('4f9a1b2c-1111-2222-3333-444455556666');
  });

  it('returns null for a plain address', () => {
    expect(parseReplyAddress('agent@emircrm.ae')).toBeNull();
  });
});
