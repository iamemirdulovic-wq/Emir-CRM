import { describe, expect, it } from 'vitest';
import { batchTagFor, slugLabel } from './batch.js';

describe('turning a label into a slug', () => {
  it('lowercases and joins words with one dash', () => {
    expect(slugLabel('Import – Expo 2026')).toBe('import-expo-2026');
  });

  it('collapses runs of punctuation rather than leaving dashes', () => {
    expect(slugLabel('Old   database ///  2024')).toBe('old-database-2024');
  });

  it('does not start or end with a dash', () => {
    expect(slugLabel('  -- Referral list -- ')).toBe('referral-list');
  });

  it('falls back to "import" for a label with nothing latin in it', () => {
    expect(slugLabel('قائمة العملاء')).toBe('import');
    expect(slugLabel('')).toBe('import');
  });

  it('keeps the tag short enough to read on a contact', () => {
    const slug = slugLabel('a'.repeat(100));
    expect(slug.length).toBeLessThanOrEqual(28);
  });
});

describe('the tag that names one upload', () => {
  const id = 'a3f2b1c0-1111-2222-3333-444455556666';

  it('reads as label, day and a short id', () => {
    expect(batchTagFor('Expo 2026', id, new Date('2026-10-30T09:00:00Z')))
      .toBe('expo-2026-30oct-a3f2');
  });

  it('separates two uploads of the same list on the same day', () => {
    const when = new Date('2026-10-30T09:00:00Z');
    const first = batchTagFor('Expo 2026', id, when);
    const second = batchTagFor('Expo 2026', 'bbbb1111-2222-3333-4444-555566667777', when);
    expect(first).not.toBe(second);
  });

  it('dates the tag in Dubai time, not UTC', () => {
    /* 21:30 UTC is already the next day in Dubai, and an agent who uploaded
       it at half past one in the morning would not recognise yesterday. */
    expect(batchTagFor('Expo', id, new Date('2026-10-30T21:30:00Z'))).toContain('31oct');
    expect(batchTagFor('Expo', id, new Date('2026-10-30T19:00:00Z'))).toContain('30oct');
  });

  it('handles the turn of the year', () => {
    expect(batchTagFor('List', id, new Date('2026-12-31T20:30:00Z'))).toContain('01jan');
  });

  it('still produces a usable tag for a label it cannot slug', () => {
    expect(batchTagFor('قائمة', id, new Date('2026-10-30T09:00:00Z')))
      .toBe('import-30oct-a3f2');
  });
});
