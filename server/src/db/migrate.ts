import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { env } from '../config/env.js';
import { logger, errorContext } from '../lib/logger.js';
import { isEntrypoint } from '../lib/entrypoint.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations-pg');

const TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       VARCHAR(191)   NOT NULL PRIMARY KEY,
  applied_at timestamptz(3) NOT NULL DEFAULT now()
);`;

/**
 * Migrations get their own single connection rather than the pool: a file is a
 * batch of statements sent in one go, and the pool is shared with live traffic.
 */
async function migrationClient(database?: string): Promise<Client> {
  const cfg = env();
  const client = cfg.DATABASE_URL
    ? new Client({ connectionString: cfg.DATABASE_URL })
    : new Client({
      host: cfg.DB_HOST,
      port: cfg.DB_PORT,
      user: cfg.DB_USER,
      password: cfg.DB_PASSWORD,
      database: database ?? cfg.DB_NAME,
    });
  await client.connect();
  return client;
}

export async function listMigrationFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith('.sql')).sort();
}

export type MigrateResult = { applied: string[]; skipped: string[] };

export async function runMigrations(): Promise<MigrateResult> {
  const conn = await migrationClient();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await conn.query(TRACKING_TABLE);
    const { rows } = await conn.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));

    for (const file of await listMigrationFiles()) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      logger.info('applying migration', { file });
      /*
       * Unlike MySQL, Postgres rolls DDL back. A file that fails halfway
       * leaves nothing behind, so a half-created table can never be mistaken
       * for a finished migration — the single worst failure mode here.
       */
      await conn.query('BEGIN');
      try {
        await conn.query(sql);
        await conn.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await conn.query('COMMIT');
      } catch (err) {
        await conn.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
      applied.push(file);
    }
    return { applied, skipped };
  } finally {
    await conn.end();
  }
}

/**
 * Create the database if it is missing — for local development. On a hosted
 * Postgres (Neon) the database is created for you and the role usually may
 * not create more, so a refusal here is not an error.
 */
export async function ensureDatabase(): Promise<void> {
  const cfg = env();
  if (cfg.DATABASE_URL) return;
  // CREATE DATABASE cannot run from inside the database being created, so this
  // connects to the always-present `postgres` database to ask.
  const conn = await migrationClient('postgres');
  try {
    const { rows } = await conn.query('SELECT 1 FROM pg_database WHERE datname = $1', [cfg.DB_NAME]);
    if (rows.length > 0) return;
    // The name comes from our own config, never from a request; Postgres has
    // no parameter form for an identifier.
    await conn.query(`CREATE DATABASE "${cfg.DB_NAME.replace(/"/g, '""')}"`);
    logger.info('created database', { database: cfg.DB_NAME });
  } catch (err) {
    logger.warn('could not create the database; assuming it already exists', errorContext(err));
  } finally {
    await conn.end();
  }
}

const invokedDirectly = isEntrypoint(import.meta.url);
if (invokedDirectly) {
  ensureDatabase()
    .then(runMigrations)
    .then(({ applied, skipped }) => {
      logger.info('migrations complete', { applied: applied.length, alreadyApplied: skipped.length });
      if (applied.length) logger.info('newly applied', { files: applied });
      process.exit(0);
    })
    .catch((err) => {
      logger.error('migration failed', errorContext(err));
      process.exit(1);
    });
}
