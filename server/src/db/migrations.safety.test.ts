import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The guard that lets the live database be migrated on every deploy.
 *
 * Seven agents work in this CRM every day and a push deploys straight to it,
 * so a migration runs against real data with no one watching. Additive changes
 * — a new table, a new nullable column, a new index — cannot lose anything.
 * Everything below can, and is refused here rather than discovered afterwards.
 *
 * This is also what makes a failed backup survivable: the backup is the second
 * line, not the first.
 */

const DIR = join(import.meta.dirname, '..', '..', 'migrations');

/** Statements that can destroy data that already exists. */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\bDROP\s+TABLE\b/i, why: 'drops a table and everything in it' },
  { pattern: /\bDROP\s+DATABASE\b/i, why: 'drops the whole database' },
  { pattern: /\bTRUNCATE\b/i, why: 'empties a table' },
  { pattern: /\bDROP\s+COLUMN\b/i, why: 'drops a column and its values' },
  { pattern: /\bRENAME\s+(TABLE|COLUMN)\b/i, why: 'renames, which breaks the running code mid-deploy' },
  { pattern: /\bALTER\s+TABLE\s+\S+\s+(MODIFY|CHANGE)\b/i, why: 'changes a column type, which can truncate values' },
  /* A DELETE without a WHERE is a TRUNCATE wearing a different hat. */
  { pattern: /\bDELETE\s+FROM\s+[`\w.]+\s*;/i, why: 'deletes every row in a table' },
];

/** Comments and string literals are prose, not statements. */
function statementsOnly(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

const files = readdirSync(DIR).filter((name) => name.endsWith('.sql')).sort();

describe('every migration is safe to run on the live database', () => {
  it('finds the migrations', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    describe(file, () => {
      const sql = statementsOnly(readFileSync(join(DIR, file), 'utf8'));

      for (const { pattern, why } of FORBIDDEN) {
        it(`does not ${why}`, () => {
          const hit = sql.match(pattern);
          expect(
            hit,
            `${file} contains "${hit?.[0]}", which ${why}. Migrations here are additive only: `
              + 'add a new nullable column and backfill it, or add a new table, and leave the old one in place.',
          ).toBeNull();
        });
      }

      /*
       * A new column on a table that already has rows must either be nullable
       * or carry a default, or the migration fails on the live database the
       * moment it runs — on a box where failing to migrate means refusing to
       * start.
       */
      it('adds no column that existing rows cannot satisfy', () => {
        const added = sql.matchAll(/\bADD\s+COLUMN\s+([`\w]+)\s+([^,;]+)/gi);
        for (const match of added) {
          const name = match[1] ?? '';
          const definition = match[2] ?? '';
          const notNull = /\bNOT\s+NULL\b/i.test(definition);
          const hasDefault = /\bDEFAULT\b/i.test(definition);
          const generated = /\b(AUTO_INCREMENT|GENERATED|AS\s*\()/i.test(definition);
          expect(
            !notNull || hasDefault || generated,
            `${file} adds ${name} as NOT NULL with no DEFAULT. Existing rows have no value for it, `
              + 'so this fails against real data. Make it nullable, or give it a default.',
          ).toBe(true);
        }
      });
    });
  }
});
