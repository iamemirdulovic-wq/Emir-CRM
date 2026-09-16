import { describe, expect, it } from 'vitest';
import { parsePhone, toE164, toWaId } from './phone.js';

describe('parsePhone', () => {
  it('parses UAE local formats into E.164', () => {
    for (const input of ['050 123 4567', '0501234567', '+971 50 123 4567', '971501234567', '00971501234567']) {
      expect(toE164(input), input).toBe('+971501234567');
    }
  });

  it('produces a wa_id without the leading plus', () => {
    expect(toWaId('+971501234567')).toBe('971501234567');
  });

  it('keeps international numbers in their own country', () => {
    const india = parsePhone('+91 98765 43210');
    expect(india.e164).toBe('+919876543210');
    expect(india.country).toBe('IN');

    const uk = parsePhone('+44 7400 123456');
    expect(uk.e164).toBe('+447400123456');
    expect(uk.country).toBe('GB');
  });

  it('parses bare digits delivered by Meta webhooks', () => {
    expect(toE164('971501234567')).toBe('+971501234567');
  });

  it('rejects junk without throwing', () => {
    for (const input of ['', '   ', 'not a phone', '123', null, undefined]) {
      const parsed = parsePhone(input as string);
      expect(parsed.isValid, String(input)).toBe(false);
      expect(parsed.e164).toBeNull();
    }
  });

  it('flags UAE mobile numbers as mobile', () => {
    expect(parsePhone('+971501234567').isMobile).toBe(true);
  });

  it('honours an explicit region', () => {
    expect(toE164('07911123456', 'GB')).toBe('+447911123456');
  });
});
