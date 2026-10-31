import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMPANY_SETTING } from './company.js';

/**
 * Everything that prints the company name reads the record the owner edits.
 *
 * The Company screen stores one `app_settings` row per field —
 * `COMPANY_LEGAL_NAME`, `COMPANY_TRADING_NAME` and so on. Two places were
 * still reading an older shape: a single row called `company` holding JSON,
 * and picking `.name` out of it. Nothing has written that row since the screen
 * was built, so the **business card** and the **signature on every client
 * email** silently ignored whatever the owner typed and printed a hard-coded
 * name instead.
 *
 * Nothing failed. No error, no empty value, no log line — just the wrong
 * company name on the two things that go to clients. The only way that gets
 * caught is a check that looks.
 */

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The dead shape. A row keyed `company`, read straight out of app_settings. */
const DEAD_LOOKUP = /app_settings\s+WHERE\s+`?key`?\s*=\s*'company'/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

describe('the company name comes from the company record', () => {
  it('nothing reads the dead `company` settings row', () => {
    const guilty = sourceFiles(SRC)
      .filter((file) => DEAD_LOOKUP.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file));

    expect(
      guilty,
      `these read an app_settings row called 'company', which nothing writes. `
        + `Settings → Company stores one row per field — use companyDetails() `
        + `from config/company.ts: ${guilty.join(', ')}`,
    ).toEqual([]);
  });

  it('every field the screen saves has a setting name of its own', () => {
    const names = Object.values(COMPANY_SETTING);
    expect(new Set(names).size, 'two fields sharing a key would overwrite each other').toBe(names.length);
    for (const name of names) expect(name).toMatch(/^COMPANY_[A-Z_]+$/);
  });
});
