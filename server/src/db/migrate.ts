import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger, errorContext } from '../lib/logger.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

const TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       VARCHAR(191) NOT NULL PRIMARY KEY,
  applied_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`;

/**
 * A dedicated connection with multipleStatements enabled. The pool deliberately
 * does not allow multi-statement queries, so migrations get their own.
 */
async function migrationConnection(database?: string): Promise<mysql.Connection> {
  const cfg = env();
  if (cfg.DATABASE_URL) {
    return mysql.createConnection({ uri: cfg.DATABASE_URL, multipleStatements: true });
  }
  return mysql.createConnection({
    host: cfg.DB_HOST,
    port: cfg.DB_PORT,
    user: cfg.DB_USER,
    password: cfg.DB_PASSWORD,
    database: database ?? cfg.DB_NAME,
    multipleStatements: true,
    charset: 'utf8mb4_unicode_ci',
  });
}

export async function listMigrationFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith('.sql')).sort();
}

export type MigrateResult = { applied: string[]; skipped: string[] };

export async function runMigrations(): Promise<MigrateResult> {
  const conn = await migrationConnection();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await conn.query(TRACKING_TABLE);
    const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name as string));

    for (const file of await listMigrationFiles()) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      logger.info('applying migration', { file });
      // DDL is not transactional in MySQL, so a failure leaves the file
      // unrecorded and the operator re-runs after fixing it forward.
      await conn.query(sql);
      await conn.execute('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      applied.push(file);
    }
    return { applied, skipped };
  } finally {
    await conn.end();
  }
}

/** Create the database if it is missing — convenience for local development. */
export async function ensureDatabase(): Promise<void> {
  const cfg = env();
  if (cfg.DATABASE_URL) return;
  const conn = await mysql.createConnection({
    host: cfg.DB_HOST,
    port: cfg.DB_PORT,
    user: cfg.DB_USER,
    password: cfg.DB_PASSWORD,
    multipleStatements: true,
  });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${cfg.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await conn.end();
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('migrate.ts');
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
