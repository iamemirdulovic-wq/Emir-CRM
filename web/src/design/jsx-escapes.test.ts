import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A backslash escape inside a JSX attribute is not an escape.
 *
 * This has now bitten twice, both times in text an agent reads every day.
 * `placeholder="Something worth telling the floor…"` renders the six
 * characters `…`, because a JSX attribute's quoted value is not a
 * JavaScript string literal: nothing processes the backslash. The same text
 * one line away inside braces — `{'Adding…'}` — is a real string literal
 * and works, which is exactly why it keeps slipping through. TypeScript is
 * happy, every test passes, and the ugly text only appears on screen.
 *
 * So the rule is the simple one: write the character. A real `…`, `·` or `→`
 * in the source is unambiguous in both positions.
 *
 * Checked by reading the source rather than by rendering, because a render
 * test only catches the strings a test happens to mount.
 */

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Attribute values in a JSX tag: `name="..."` or `name='...'`, which is where
 * the bug lives. A value in braces is a real expression and is left alone.
 */
const ATTRIBUTE = /\s[a-zA-Z-]+=("[^"\n]*"|'[^'\n]*')/g;

/** The escapes that look like they work: …, \x1b, \n, \t and friends. */
const ESCAPE = /\\(u\{?[0-9a-fA-F]|x[0-9a-fA-F]|[nrtv0])/;

describe('JSX attributes', () => {
  it('spell characters out rather than escaping them', () => {
    const bad: string[] = [];
    for (const file of tsxFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      source.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(ATTRIBUTE)) {
          const value = match[1] as string;
          if (!ESCAPE.test(value)) continue;
          bad.push(`${path.relative(SRC, file)}:${index + 1} ${match[0].trim()}`);
        }
      });
    }
    /* Named in the failure, because the fix is to paste the character in and
       the message needs to say which line to paste it into. */
    expect(bad, `write the character itself:\n${bad.join('\n')}`).toEqual([]);
  });

  it('catches the shape this is guarding against', () => {
    // Belt and braces: the regexes above are the whole test, so they get one.
    expect(ESCAPE.test('"floor\\u2026"')).toBe(true);
    expect(ESCAPE.test('"floor…"')).toBe(false);
    expect([...' placeholder="a\\u2026"'.matchAll(ATTRIBUTE)]).toHaveLength(1);
    // A braced value is a real string literal, so it is none of our business.
    expect([...' placeholder={\'a\\u2026\'}'.matchAll(ATTRIBUTE)]).toHaveLength(0);
  });
});
