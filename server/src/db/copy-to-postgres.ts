/**
 * Copy the live MySQL database into Postgres (Neon).
 *
 * This runs on the server that already has the MySQL database — it reads from
 * MySQL and writes to Neon over the internet. It never writes to MySQL, and it
 * refuses to touch a Postgres database that already holds rows unless told to
 * replace them, because the one unrecoverable mistake here is overwriting a
 * copy that was already live.
 *
 *   npm run copy-to-postgres -- --check     count the rows, copy nothing
 *   npm run copy-to-postgres                copy into an empty Postgres
 *   npm run copy-to-postgres -- --replace   empty the Postgres tables first
 *
 * Order matters: a child row cannot be inserted before its parent exists, so
 * the tables are sorted by their foreign keys rather than by name. A cycle
 * between two tables would make that impossible, so one is reported rather
 * than guessed at.
 */
import mysql from 'mysql2/promise';
import { Client } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/** Rows per INSERT. Large enough to be quick, small enough to stay well under
 *  Postgres's 65,535 parameter ceiling even on the widest table here. */
const BATCH = 500;

type Column = { name: string; type: string; isGenerated: boolean };

/**
 * The slice of a Postgres client these two functions need. Narrow on purpose:
 * it lets the ordering — the part that breaks the copy halfway through if it
 * is wrong — be tested against the real schema without a server.
 */
export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };

export async function postgresTables(pg: Queryable): Promise<Map<string, Column[]>> {
  const { rows } = await pg.query(
    `SELECT table_name, column_name, data_type, is_identity
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  );
  const tables = new Map<string, Column[]>();
  for (const raw of rows) {
    const row = raw as { table_name: string; column_name: string; data_type: string; is_identity: string };
    const list = tables.get(row.table_name) ?? [];
    list.push({ name: row.column_name, type: row.data_type, isGenerated: row.is_identity === 'YES' });
    tables.set(row.table_name, list);
  }
  tables.delete('schema_migrations');
  return tables;
}

/**
 * Sort tables so every parent is written before its children.
 * A self-reference (users.manager_id -> users) is ignored: those rows are
 * inserted together and the constraint is checked at the end of the statement.
 */
export async function parentsFirst(pg: Queryable, tables: string[]): Promise<string[]> {
  const { rows } = await pg.query(
    `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
       FROM pg_constraint c WHERE c.contype = 'f'`,
  );
  const needs = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const raw of rows) {
    const { child, parent } = raw as { child: string; parent: string };
    if (child === parent) continue;
    if (needs.has(child) && needs.has(parent)) needs.get(child)!.add(parent);
  }

  const done: string[] = [];
  const placed = new Set<string>();
  while (placed.size < tables.length) {
    const ready = tables.filter((t) => !placed.has(t) && [...needs.get(t)!].every((p) => placed.has(p)));
    if (ready.length === 0) {
      const stuck = tables.filter((t) => !placed.has(t));
      throw new Error(`these tables reference each other in a loop, so no safe order exists: ${stuck.join(', ')}`);
    }
    for (const t of ready) { done.push(t); placed.add(t); }
  }
  return done;
}

/** mysql2 hands back parsed objects for JSON columns; jsonb wants text. */
function forPostgres(value: unknown, column: Column): unknown {
  if (value === null || value === undefined) return null;
  if (column.type === 'jsonb' || column.type === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  // mysql2 returns BIT(1)/TINYINT as a Buffer on some server versions.
  if (Buffer.isBuffer(value) && column.type !== 'bytea') return value[0] ?? 0;
  return value;
}

async function copyTable(
  my: mysql.Connection,
  pg: Client,
  table: string,
  columns: Column[],
): Promise<number> {
  const names = columns.map((c) => c.name);
  const quoted = names.map((n) => `"${n}"`).join(', ');
  // An identity column will not accept an explicit value without being told.
  const overriding = columns.some((c) => c.isGenerated) ? ' OVERRIDING SYSTEM VALUE' : '';

  const [rows] = await my.query<mysql.RowDataPacket[]>(
    `SELECT ${names.map((n) => `\`${n}\``).join(', ')} FROM \`${table}\``,
  );

  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const slots = columns.map((col) => {
        params.push(forPostgres(row[col.name], col));
        return `$${params.length}`;
      });
      return `(${slots.join(', ')})`;
    });
    await pg.query(
      `INSERT INTO "${table}" (${quoted})${overriding} VALUES ${tuples.join(', ')}`,
      params,
    );
    written += chunk.length;
  }

  // An identity sequence left at 1 would collide on the next insert.
  const identity = columns.find((c) => c.isGenerated);
  if (identity && written > 0) {
    await pg.query(
      `SELECT setval(pg_get_serial_sequence($1, $2),
                     COALESCE((SELECT MAX("${identity.name}") FROM "${table}"), 1))`,
      [table, identity.name],
    );
  }
  return written;
}

export async function copyToPostgres(opts: { check?: boolean; replace?: boolean } = {}): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — paste the Neon connection string into it first.');

  const cfg = env();
  const my = await mysql.createConnection({
    host: cfg.DB_HOST, port: cfg.DB_PORT, user: cfg.DB_USER,
    password: cfg.DB_PASSWORD, database: cfg.DB_NAME,
    // Dates must arrive as strings, not as JS Dates in the server's timezone:
    // the timezone conversion is exactly where an hour goes missing.
    dateStrings: true,
  });
  const pg = new Client({ connectionString: url });
  await pg.connect();

  try {
    const tables = await postgresTables(pg);
    if (tables.size === 0) {
      throw new Error('That Postgres database has no tables. Apply server/migrations-pg first.');
    }
    const order = await parentsFirst(pg, [...tables.keys()]);

    // Count both sides before touching anything.
    const counts: Array<{ table: string; mysql: number; postgres: number }> = [];
    for (const table of order) {
      const [[mine]] = await my.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${table}\``);
      const { rows: [theirs] } = await pg.query<{ n: string }>(`SELECT COUNT(*) AS n FROM "${table}"`);
      counts.push({ table, mysql: Number(mine?.n ?? 0), postgres: Number(theirs?.n ?? 0) });
    }

    const occupied = counts.filter((c) => c.postgres > 0);
    if (opts.check) {
      for (const c of counts.filter((c) => c.mysql || c.postgres)) {
        logger.info('row counts', { table: c.table, mysql: c.mysql, postgres: c.postgres });
      }
      const total = counts.reduce((sum, c) => sum + c.mysql, 0);
      logger.info('nothing was copied; this was a check', { tables: counts.length, rowsInMysql: total });
      return;
    }

    if (occupied.length > 0 && !opts.replace) {
      throw new Error(
        `Postgres already holds rows in ${occupied.length} table(s), starting with `
        + `${occupied[0]!.table}. Copying now would double them. Re-run with --replace to empty `
        + 'them first, having checked that nothing live depends on what is there.',
      );
    }

    if (opts.replace) {
      // One statement, so the foreign keys never see a half-empty database.
      await pg.query(`TRUNCATE ${order.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
      logger.warn('emptied the Postgres tables before copying', { tables: order.length });
    }

    let copied = 0;
    for (const table of order) {
      const written = await copyTable(my, pg, table, tables.get(table)!);
      copied += written;
      if (written > 0) logger.info('copied', { table, rows: written });
    }

    // Prove it, rather than trust it.
    const wrong: string[] = [];
    for (const { table, mysql: expected } of counts) {
      const { rows: [got] } = await pg.query<{ n: string }>(`SELECT COUNT(*) AS n FROM "${table}"`);
      if (Number(got?.n ?? 0) !== expected) wrong.push(`${table}: MySQL ${expected}, Postgres ${got?.n}`);
    }
    if (wrong.length > 0) {
      throw new Error(`the copy finished but the counts do not match:\n  ${wrong.join('\n  ')}`);
    }

    logger.info('copy complete and verified', { tables: order.length, rows: copied });
  } finally {
    await pg.end().catch(() => undefined);
    await my.end().catch(() => undefined);
  }
}

const isEntry = process.argv[1]?.endsWith('copy-to-postgres.ts')
  || process.argv[1]?.endsWith('copy-to-postgres.js');
if (isEntry) {
  copyToPostgres({
    check: process.argv.includes('--check'),
    replace: process.argv.includes('--replace'),
  })
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error('copy failed', { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
}
