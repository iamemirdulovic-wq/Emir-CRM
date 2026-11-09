import { describe, expect, it } from 'vitest';
import { HOUSE_RULES } from './welcome-email.js';

/**
 * The welcome email carries somebody's password, so it is worth being sure
 * about what is in it.
 *
 * The rules themselves are Emir's words and the reason this email exists at
 * all — "please use the CRM every single day", the ten o'clock check-in, the
 * five-minute reply, the manager reading every lead, and tell us what is
 * broken. If one of them quietly disappears in an edit, nobody would notice
 * until a new agent had not been told.
 */
describe('what the welcome email asks of people', () => {
  it('keeps all five of the things Emir asks for', () => {
    expect(HOUSE_RULES).toHaveLength(5);
    const all = HOUSE_RULES.map((r) => `${r.title} ${r.detail}`).join(' ').toLowerCase();

    expect(all, 'use it every day').toMatch(/every day/);
    expect(all, 'mark that you are in').toMatch(/mark that you are in|working outside/);
    expect(all, 'five minutes on a new lead').toMatch(/five minutes/);
    expect(all, 'the manager sees every lead').toMatch(/manager/);
    expect(all, 'say what is broken').toMatch(/broken|missing/);
  });

  /* The check-in only works on the office Wi-Fi, and somebody who does not
     know that reads a button that refuses them as a bug. */
  it('explains the Wi-Fi before somebody meets it', () => {
    const arriving = HOUSE_RULES.find((r) => /mark that you are in/i.test(r.title));
    expect(arriving?.detail).toMatch(/office Wi-Fi/i);
    expect(arriving?.detail).toMatch(/Working outside/i);
  });

  /* "After five minutes it goes to somebody else" is the part that changes
     behaviour; "reply quickly" on its own does not. */
  it('says what actually happens after five minutes', () => {
    const lead = HOUSE_RULES.find((r) => /five minutes/i.test(r.detail));
    expect(lead?.detail).toMatch(/back to the pool|somebody else/i);
  });

  it('is written as instructions, not as a wall of text', () => {
    for (const rule of HOUSE_RULES) {
      expect(rule.title.length, `"${rule.title}" is too long for a heading`).toBeLessThan(50);
      expect(rule.detail.length).toBeGreaterThan(30);
    }
  });
});
