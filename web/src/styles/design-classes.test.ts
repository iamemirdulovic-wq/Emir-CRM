import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every `d-` class a v2 screen uses is one the design actually defines.
 *
 * `d-` is the prefix the port script puts on the owner's own class names, so
 * `d-card` comes from `design/web/ui.css` and `d-tb-grid` from one page's
 * `<style>` block. A `d-` class that is in no stylesheet is a name somebody
 * invented while porting a screen — it styles nothing, and it looks right in
 * the code while the screen renders unstyled.
 *
 * This has already happened twice: `d-cal-grid` and `d-cal-dows` on the
 * calendar, where the real design builds the month as one seven-column grid
 * with the day names as cells in it. Both looked fine in review and both drew
 * nothing. A screenshot catches it; so does this, in a tenth of a second.
 *
 * If this fails, the fix is never to add the class to the generated files —
 * they are generated. Either use the name the design really uses, or add a
 * rule of your own to `v2-shell.css` with a `v2-` prefix.
 */

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(HERE, '..');

/** Every class defined in the two generated stylesheets. */
function defined(): Set<string> {
  const names = new Set<string>();
  for (const file of ['v2-ui.css', 'v2-home.css']) {
    const css = readFileSync(path.join(HERE, file), 'utf8');
    for (const match of css.matchAll(/\.(d-[a-z0-9-]+)/g)) names.add(match[1] as string);
  }
  return names;
}

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

describe('the design classes the screens use', () => {
  const known = defined();

  it('finds the generated stylesheets', () => {
    /* If the port script has not run, every class below would "fail" for the
       wrong reason, so the sheets are checked first. */
    expect(known.size).toBeGreaterThan(200);
  });

  it('are all defined in the ported design stylesheets', () => {
    const missing: string[] = [];

    for (const file of tsxFiles(path.join(SRC, 'v2'))) {
      const source = readFileSync(file, 'utf8');
      /* Only inside className strings and template literals: a `d-` in a
         comment or a URL is not a class. */
      for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const value = match[1] ?? match[2] ?? '';
        for (const name of value.split(/[\s`${}?:'"]+/)) {
          if (!name.startsWith('d-') || known.has(name)) continue;
          /* `d-` or `d-stage-` immediately before an interpolation is a
             prefix, not a name: the rest of it arrives at runtime. */
          if (name.endsWith('-')) continue;
          missing.push(`${path.relative(SRC, file)}: .${name}`);
        }
      }
      /* Class names built in a list or a ternary, e.g. 'd-chip-opt d-on'. */
      for (const match of source.matchAll(/'((?:d-[a-z0-9-]+\s*)+)'/g)) {
        for (const name of (match[1] as string).trim().split(/\s+/)) {
          if (known.has(name)) continue;
          missing.push(`${path.relative(SRC, file)}: .${name}`);
        }
      }
    }

    expect(
      [...new Set(missing)].sort(),
      'These `d-` classes are in no design stylesheet, so they style nothing.\n'
      + 'Use the name the design really uses, or add your own rule to\n'
      + 'v2-shell.css with a `v2-` prefix:\n',
    ).toEqual([]);
  });
});
