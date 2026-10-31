import { describe, expect, it } from 'vitest';
import { isSafePhotoUrl } from './card-html.js';

/**
 * The card is served to anyone with the link and has no session behind it, so
 * what goes into an `src` on it is worth being exact about.
 *
 * It also has to accept the ordinary case. The photo an agent uploads is
 * stored as a path on this server, and the rule here used to demand
 * `https://` — so the upload worked, the file served, and the card showed
 * initials anyway, with nothing to say why.
 */


describe('which photos the card will load', () => {
  it('takes one uploaded here, which is a path and not a URL', () => {
    expect(isSafePhotoUrl('/api/profiles/abc/photo?v=123')).toBe(true);
  });

  it('takes one hosted elsewhere over https', () => {
    expect(isSafePhotoUrl('https://cdn.example.com/a.jpg')).toBe(true);
  });

  it('refuses a protocol-relative URL, which is off-site wearing a path', () => {
    expect(isSafePhotoUrl('//evil.example/a.jpg')).toBe(false);
  });

  it('refuses anything that is not a photo at all', () => {
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAA', 'http://plain.example/a.jpg', '', null, undefined]) {
      expect(isSafePhotoUrl(bad), String(bad)).toBe(false);
    }
  });
});
