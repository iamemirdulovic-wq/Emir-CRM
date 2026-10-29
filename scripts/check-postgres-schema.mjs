import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const db = await new PGlite();

// Postgres has no ON UPDATE CURRENT_TIMESTAMP; the converted schema asks for
// this instead, so it has to exist before the first table that uses it.
await db.exec(`
  CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END;
  $$ LANGUAGE plpgsql;
`);

const files = readdirSync('server/migrations-pg').filter((f) => f.endsWith('.sql')).sort();
let failed = 0;
for (const file of files) {
  try {
    await db.exec(readFileSync(`server/migrations-pg/${file}`, 'utf8'));
    console.log(`  ok    ${file}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${file}: ${String(err.message).split('\n')[0]}`);
  }
}

const tables = await db.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
);
const cols = await db.query(
  `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public'`,
);
console.log(`\ntables: ${tables.rows.length}   columns: ${cols.rows[0].n}   failed files: ${failed}`);
if (failed) process.exit(1);

// Dump what Postgres actually built, so it can be diffed against the MySQL source.
const inv = await db.query(
  `SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' ORDER BY table_name, column_name`,
);
const byTable = {};
for (const r of inv.rows) (byTable[r.table_name] ??= []).push(r.column_name);
const { writeFileSync } = await import('node:fs');
if (process.env.INV_OUT) writeFileSync(process.env.INV_OUT, JSON.stringify(byTable, null, 0));
