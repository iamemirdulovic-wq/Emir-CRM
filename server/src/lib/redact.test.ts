import { describe, expect, it } from 'vitest';
import { maskEmail, maskPhone, redact, scrubText } from './redact.js';

describe('redact', () => {
  it('removes anything that looks like a secret', () => {
    const out = redact({
      password: 'hunter2',
      accessToken: 'EAAG...',
      'x-hub-signature-256': 'sha256=abc',
      apiKey: 'k',
      keep: 'visible',
    }) as Record<string, unknown>;
    expect(out.password).toBe('[redacted]');
    expect(out.accessToken).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
    expect(out.keep).toBe('visible');
  });

  it('masks contact details under a recognised key', () => {
    const out = redact({ phone: '+971501234567', email: 'buyer@example.ae' }) as Record<string, unknown>;
    expect(out.phone).toBe('+971***67');
    expect(out.email).toBe('b***@example.ae');
  });

  it('caps long arrays so a bulk operation cannot log a whole list', () => {
    const out = redact({ phones: Array.from({ length: 50 }, (_, i) => i) }) as { phones: unknown[] };
    expect(out.phones).toHaveLength(21);
    expect(out.phones[20]).toBe('[+30 more]');
  });

  it('masks a number quoted inside a database error message', () => {
    // What MySQL actually says when the unique phone index rejects a row.
    const message = "Duplicate entry '+971501234567' for key 'contacts.uq_contact_phone'";
    const out = redact({ error: message }) as { error: string };
    expect(out.error).toBe("Duplicate entry '+971***67' for key 'contacts.uq_contact_phone'");
    expect(out.error).not.toContain('501234567');
  });

  it('masks a wa_id, which is stored without a leading plus', () => {
    const message = "Duplicate entry '971501234567' for key 'contacts.uq_contacts_wa_id'";
    expect(redact({ error: message })).toEqual({
      error: "Duplicate entry '971***67' for key 'contacts.uq_contacts_wa_id'",
    });
  });

  it('leaves an unquoted long number alone, so timestamps stay readable', () => {
    expect(scrubText('finished at 1758098765432 after 12345678 rows')).toBe(
      'finished at 1758098765432 after 12345678 rows',
    );
  });

  it('masks an address quoted inside free text', () => {
    expect(scrubText('bounced for buyer.one@example.ae')).toBe('bounced for b***@example.ae');
  });

  it('leaves ordinary text and ids alone', () => {
    const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    expect(scrubText(`opportunity ${id} moved to engaged_qualified`)).toBe(
      `opportunity ${id} moved to engaged_qualified`,
    );
  });

  it('masks short values completely', () => {
    expect(maskPhone('123')).toBe('***');
    expect(maskEmail('not-an-address')).toBe('***');
  });
});
