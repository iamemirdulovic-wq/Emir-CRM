import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { replyTime, strengthOf } from './Profile.js';

/**
 * `design/web/profile.html`, and the rules it enforces before it saves.
 *
 * The audit (`docs/v2/audit-3.md` §27) found the page split across three
 * addresses with none of the design's own checks on the form and no device
 * list at all. These hold the parts that are arithmetic or wording; the
 * layout is held by the picture in `docs/v2/proof/profile.jpg`.
 */

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SOURCE = readFileSync(path.join(HERE, 'Profile.tsx'), 'utf8');
const WORDS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the password meter', () => {
  it('is empty before anything is typed, with the design\'s first hint', () => {
    expect(strengthOf('')).toEqual({ score: 0, hint: 'At least 8. Mix letters and numbers.' });
  });

  it('is one red bar under eight characters', () => {
    expect(strengthOf('abc123')).toEqual({ score: 1, hint: 'Too short.' });
  });

  it('is two at eight, and three only when it is long and mixed', () => {
    expect(strengthOf('abcdefgh').score).toBe(2);
    expect(strengthOf('abcd1234').score).toBe(2);
    expect(strengthOf('abcd123456').score).toBe(3);
    expect(strengthOf('abcd123456').hint).toBe('Strong password.');
  });

  it('does not call a long password of letters alone strong', () => {
    expect(strengthOf('abcdefghijkl').score).toBe(2);
  });
});

describe('the reply time in the hero', () => {
  it('writes the unit apart from the number, as the design\'s markup does', () => {
    expect(replyTime(300)).toEqual({ value: '5', unit: 'min' });
    expect(replyTime(48)).toEqual({ value: '48', unit: 'sec' });
  });

  it('says nothing rather than zero when nobody has been answered yet', () => {
    expect(replyTime(null)).toEqual({ value: '—', unit: '' });
  });
});

describe('the rules the design puts on the form', () => {
  it('refuses a form with red fields in the design\'s own words', () => {
    expect(WORDS).toContain('Not saved yet. Check the red fields.');
    expect(WORDS).toContain('Write your full name.');
    expect(WORDS).toContain('A BRN has 4 to 6 digits.');
    expect(WORDS).toContain('Digits only, at least 9.');
    expect(WORDS).toContain('Choose at least one language.');
  });

  it('keeps the design\'s two password messages apart', () => {
    expect(WORDS).toContain('The new password must be different.');
    expect(WORDS).toContain('The two passwords are not the same.');
  });

  it('asks twice before removing a photo or signing a device out', () => {
    expect(WORDS).toContain('Tap again to remove');
    expect(WORDS).toContain('Tap again to sign out');
    expect(WORDS).toContain('Tap again · sign out');
  });

  it('offers all ten languages the design lists', () => {
    for (const one of [
      'English', 'Arabic', 'Russian', 'Hindi', 'Urdu',
      'Portuguese', 'Serbian', 'Ukrainian', 'Punjabi', 'French',
    ]) {
      expect(WORDS).toContain(`'${one}'`);
    }
  });
});

describe('what the page will not claim', () => {
  it('offers no two-step switch, because there is no second factor', () => {
    /* A switch that reads "On · code from your phone app" would tell an
       owner their account is protected by something that is not built. */
    expect(WORDS).not.toContain('code from your phone app');
    expect(WORDS).not.toContain('New backup codes');
    expect(WORDS).toContain('not switched on for anybody yet');
  });

  it('shows the real devices rather than three drawn ones', () => {
    expect(WORDS).toContain("api.get('/api/auth/sessions')");
    expect(WORDS).not.toContain('iPhone 15');
  });

  it('is the computer page only; a phone keeps its own three screens', () => {
    expect(WORDS).toContain('phone ? <V2Person /> : <MyProfile />');
    expect(WORDS).toContain('phone ? <V2PersonalInfo /> : <MyProfile />');
  });
});
