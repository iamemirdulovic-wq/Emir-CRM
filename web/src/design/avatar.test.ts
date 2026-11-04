import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A photo that fails to load must leave the initials, not a broken glyph.
 *
 * `Avatar` draws a person's picture over their coloured initials. When the
 * picture 404s — a deleted upload, a photo moved on the server — `alt=""`
 * is **not** enough: with a size set in CSS, Chrome still paints a small
 * broken-image icon in the corner of the circle, on top of the initials.
 *
 * That is not a guess. It was the first thing shipped here, and breaking one
 * in a real browser is the only reason it was found: the markup read
 * correctly, TypeScript was happy, and every test passed. The fix is an
 * `onError` that drops the image, remembering the url that failed so a later
 * photo still gets its own try.
 *
 * There is no React renderer in this project, so this reads the source. It
 * cannot prove the handler works — the browser did that — but it does stop
 * the handler being quietly deleted, which is the realistic regression.
 */
const UI = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui.tsx'),
  'utf8',
);

/** The body of `export function Avatar(...)`, up to the next export. */
function avatarSource(): string {
  const start = UI.indexOf('export function Avatar(');
  expect(start).toBeGreaterThan(-1);
  const after = UI.indexOf('\nexport ', start + 1);
  return UI.slice(start, after === -1 ? undefined : after);
}

describe('Avatar', () => {
  it('drops a photo that fails to load', () => {
    const source = avatarSource();
    expect(source).toContain('<img');
    expect(source, 'an <img> in Avatar needs an onError that hides it')
      .toMatch(/<img[^>]*onError=/s);
  });

  it('remembers which url failed, not just that one did', () => {
    // A boolean would mean a person whose first photo 404s can never show a
    // second one without a reload.
    const source = avatarSource();
    expect(source).toMatch(/failed !== src/);
    expect(source).toMatch(/setFailed\(src\)/);
  });

  it('keeps the initials rendered underneath the photo', () => {
    // Order matters: the initials are the thing left behind.
    const source = avatarSource();
    const initialsAt = source.indexOf('{initials(name)}');
    const imageAt = source.indexOf('<img');
    expect(initialsAt).toBeGreaterThan(-1);
    expect(initialsAt).toBeLessThan(imageAt);
  });
});
