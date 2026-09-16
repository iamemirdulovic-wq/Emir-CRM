import { describe, expect, it } from 'vitest';
import { isSpam, websiteExternalId, websiteFormSchema } from './website.js';

describe('website form intake', () => {
  it('derives a stable external id from the submission', () => {
    const payload = websiteFormSchema.parse({
      phone: '0501234567',
      email: 'sara@example.com',
      form_id: 'beachfront',
      submitted_at: '2026-03-17T10:30:00.000Z',
    });
    expect(websiteExternalId(payload)).toBe(websiteExternalId(payload));
    expect(websiteExternalId(payload)).toMatch(/^web_[0-9a-f]{40}$/);
  });

  it('gives different submissions different ids', () => {
    const base = { form_id: 'f', submitted_at: '2026-03-17T10:30:00.000Z' };
    const a = websiteFormSchema.parse({ ...base, phone: '0501234567' });
    const b = websiteFormSchema.parse({ ...base, phone: '0559876543' });
    expect(websiteExternalId(a)).not.toBe(websiteExternalId(b));
  });

  it('detects a filled honeypot as spam', () => {
    expect(isSpam(websiteFormSchema.parse({ website: 'http://spam.example' }))).toBe(true);
    expect(isSpam(websiteFormSchema.parse({ website: '' }))).toBe(false);
    expect(isSpam(websiteFormSchema.parse({ name: 'Sara' }))).toBe(false);
  });
});
