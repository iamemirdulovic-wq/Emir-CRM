import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRUNCATE_ORDER } from './db.js';

/**
 * Every table is either emptied between tests or deliberately not.
 *
 * `TRUNCATE_ORDER` is a hand-written list, and a hand-written list of 86 tables
 * stops being complete. When it does, the damage is the one the comment at the
 * top of that list already warns about twice: a test leaves a row behind, and
 * the failure lands on whichever test happens to run next.
 *
 * That is not hypothetical. Step 17 added one table and four tests in a file it
 * had nothing to do with went red — the first test to set the CRM up claimed it
 * for the whole file. Checking the list caught 27 more tables that had been
 * added since it was last maintained: notes, notifications, the wall, badges,
 * email campaigns, preferences, AI usage.
 *
 * So the list is checked against the migrations rather than trusted. A new
 * table has to be put in one of the two lists below, which is a decision rather
 * than an oversight.
 */

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'migrations');

/**
 * Tables that must survive a reset, each for a stated reason. Short on purpose:
 * the check is worth little if anything inconvenient can be added here.
 */
const KEPT = new Map([
  ['migrations', 'the ledger of what has been applied — truncating it would re-run every migration'],
  ['pipelines', 'seeded once by prepareTestDatabase; every test needs the default pipeline'],
  ['pipeline_stages', 'seeded with it — a test with no stages cannot move a lead anywhere'],
]);

function tablesInMigrations(): string[] {
  const sql = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'));

  const found = new Set<string>();
  for (const file of sql) {
    for (const match of file.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?`?([a-z_]+)`?/gi)) {
      found.add((match[1] as string).toLowerCase());
    }
  }
  return [...found].sort();
}

describe('the test reset covers the whole schema', () => {
  it('empties every table that is not deliberately kept', () => {
    const cleared = new Set(TRUNCATE_ORDER);
    const forgotten = tablesInMigrations().filter((t) => !cleared.has(t) && !KEPT.has(t));
    expect(
      forgotten,
      `these tables are never emptied between tests, so a row left in one reaches `
        + `the next test: ${forgotten.join(', ')}. Add each to TRUNCATE_ORDER in `
        + `testing/db.ts, or to KEPT here with the reason it must survive.`,
    ).toEqual([]);
  });

  it('does not try to empty a table that no migration creates', () => {
    const real = new Set(tablesInMigrations());
    const ghosts = TRUNCATE_ORDER.filter((t) => !real.has(t));
    expect(ghosts, `TRUNCATE_ORDER names tables that do not exist: ${ghosts.join(', ')}`).toEqual([]);
  });

  it('names each table once', () => {
    const seen = new Set<string>();
    const twice = TRUNCATE_ORDER.filter((t) => !seen.add(t));
    expect(twice, `listed twice: ${twice.join(', ')}`).toEqual([]);
  });

  it('keeps nothing without a reason', () => {
    for (const [table, reason] of KEPT) expect(reason.length, table).toBeGreaterThan(20);
  });
});
