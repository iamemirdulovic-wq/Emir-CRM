import { describe, expect, it } from 'vitest';
import { TREAT_AS_NEW_MAX_ROWS, decideTreatAsNew } from './treat-as-new.js';

describe('deciding whether an import starts the five-minute timer', () => {
  it('is off when nobody asked, and says nothing about it', () => {
    expect(decideTreatAsNew(false, 20)).toEqual({ allowed: false, reason: null });
  });

  it('stays off when nobody asked, however small the file', () => {
    expect(decideTreatAsNew(false, 1).allowed).toBe(false);
  });

  it('allows a stand full of names from last night', () => {
    const decision = decideTreatAsNew(true, 20);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain('20 leads');
    expect(decision.reason).toContain('No WhatsApp or email is sent automatically');
  });

  it('refuses a database rather than warning about it', () => {
    const decision = decideTreatAsNew(true, 40_000);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('40,000 rows');
    expect(decision.reason).toContain('200');
  });

  it('allows exactly the limit and refuses one past it', () => {
    expect(decideTreatAsNew(true, TREAT_AS_NEW_MAX_ROWS).allowed).toBe(true);
    expect(decideTreatAsNew(true, TREAT_AS_NEW_MAX_ROWS + 1).allowed).toBe(false);
  });

  it('explains the refusal in words an owner can act on', () => {
    const { reason } = decideTreatAsNew(true, 5_000);
    expect(reason).toMatch(/list or a call campaign/);
  });

  it('takes a different limit when one is given', () => {
    expect(decideTreatAsNew(true, 50, 10).allowed).toBe(false);
    expect(decideTreatAsNew(true, 9, 10).allowed).toBe(true);
  });
});
