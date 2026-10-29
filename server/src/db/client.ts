import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { toPositional } from './sql-dialect.js';

/*
 * node-postgres hands back `bigint` and `COUNT(*)` as strings, because a
 * 64-bit integer does not always fit a JavaScript number. Nothing in this
 * system counts past 2^53 — the largest numbers here are counts of leads and
 * amounts in AED — and MySQL returned them as numbers, so comparisons like
 * `row.n > 0` are written throughout expecting one. Left as strings they would
 * not throw; they would quietly compare as text, and "10" < "9".
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

let pool: pg.Pool | null = null;

function poolConfig(): pg.PoolConfig {
  const cfg = env();
  const base: pg.PoolConfig = {
    max: cfg.DB_POOL_SIZE,
    // Neon closes an idle connection itself; releasing first avoids handing a
    // dead one to the next query.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };
  if (cfg.DATABASE_URL) return { ...base, connectionString: cfg.DATABASE_URL };
  return {
    ...base,
    host: cfg.DB_HOST,
    port: cfg.DB_PORT,
    user: cfg.DB_USER,
    password: cfg.DB_PASSWORD,
    database: cfg.DB_NAME,
  };
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool(poolConfig());
    /*
     * A pooled connection can fail while idle — Neon suspending, a network
     * blip. Without a listener node-postgres raises it as an uncaught error
     * and takes the process down, which on a lead webhook means losing the
     * lead rather than retrying it.
     */
    pool.on('error', (err) => logger.warn('idle database connection failed', { error: err.message }));
    /*
     * Every timestamp in the schema is timestamptz and every comparison is
     * meant in UTC, with the Dubai offset applied explicitly where a local day
     * is wanted. The session timezone still decides what `::date`, `date_trunc`
     * and `to_char` return, so it is pinned rather than inherited from whatever
     * the host happens to be set to. node-postgres runs a client's queries in
     * order, so this one lands before any of ours.
     */
    pool.on('connect', (client) => {
      client.query("SET TIME ZONE 'UTC'").catch((err: Error) =>
        logger.warn('could not pin the session timezone to UTC', { error: err.message }));
    });
    logger.info('postgres pool created', { database: env().DB_NAME, poolSize: env().DB_POOL_SIZE });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export type Row = Record<string, unknown>;
/** A connection inside a transaction, as `withTransaction` hands it to its body. */
export type Tx = pg.PoolClient;
export type Executor = pg.Pool | Tx;
/** Anything that can be bound to a placeholder. */
export type SqlParam = string | number | boolean | Date | Buffer | null | undefined;

/** What callers read off a write. `insertId` has no use here: the only
 *  auto-numbered column in the schema is never read back. */
export type WriteResult = { affectedRows: number };

/** SELECT returning many rows. */
export async function query<T = Row>(sql: string, params: SqlParam[] = [], exec: Executor = getPool()): Promise<T[]> {
  const result = await exec.query(toPositional(sql), params as unknown[]);
  return result.rows as T[];
}

/** SELECT returning at most one row. */
export async function queryOne<T = Row>(
  sql: string,
  params: SqlParam[] = [],
  exec: Executor = getPool(),
): Promise<T | null> {
  const rows = await query<T>(sql, params, exec);
  return rows[0] ?? null;
}

/** INSERT / UPDATE / DELETE. */
export async function execute(
  sql: string,
  params: SqlParam[] = [],
  exec: Executor = getPool(),
): Promise<WriteResult> {
  const result = await exec.query(toPositional(sql), params as unknown[]);
  return { affectedRows: result.rowCount ?? 0 };
}

/**
 * Run `fn` inside a transaction. Identity resolution and lead assignment both
 * depend on this plus `SELECT … FOR UPDATE`.
 */
export async function withTransaction<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const conn = await getPool().connect();
  try {
    /*
     * READ COMMITTED, which is Postgres's default and is stated anyway so the
     * requirement is visible rather than inherited. It is load-bearing for
     * lead ingestion in the same two ways it was under MySQL:
     *
     *  1. Current reads. A stricter level keeps the snapshot taken at the
     *     transaction's first read, so a webhook that lost the race to create
     *     a contact would still not see the winner's opportunity and would
     *     open a second one for the same inquiry.
     *  2. Fewer conflicts. Twenty copies of one lead inserting against the
     *     same unique key serialise rather than aborting each other.
     *
     * Nothing here depends on repeating a read within a transaction;
     * correctness comes from unique keys and `SELECT … FOR UPDATE`.
     */
    await conn.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const result = await fn(conn);
    await conn.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await conn.query('ROLLBACK');
    } catch {
      /* the connection is already gone; nothing to roll back */
    }
    throw err;
  } finally {
    conn.release();
  }
}

let savepointCounter = 0;

/**
 * Run `fn` inside a savepoint, so a failure in it does not poison the
 * surrounding transaction.
 *
 * This is the one real behavioural difference between the two databases.
 * MySQL let a transaction carry on after a failed statement, so code could
 * try an insert, catch the duplicate-key error and take another path. In
 * Postgres the first error aborts the whole transaction: every statement
 * after it fails with "current transaction is aborted" until a rollback. A
 * savepoint is the supported way to attempt something that may fail and
 * then continue — the rollback goes back to the savepoint, not to the start.
 *
 * Where the attempt is an INSERT, `ON CONFLICT DO NOTHING` is better still:
 * it raises nothing at all. Reach for this only when there is no such form,
 * as with an UPDATE that may collide with a unique key.
 */
export async function withSavepoint<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  savepointCounter += 1;
  const name = `emir_sp_${savepointCounter}`;
  await tx.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await tx.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (err) {
    await tx.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw err;
  }
}

/** The code Postgres reports, where it has one. */
function sqlState(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
}

/** Unique-violation — the signal that another worker won a race. */
export function isDuplicateKeyError(err: unknown): boolean {
  return sqlState(err) === '23505';
}

/**
 * Deadlock, serialisation failure or a lock that could not be taken — all of
 * which mean "someone else got there first", and all of which are safe to
 * retry because the transaction left nothing behind.
 */
export function isRetryableLockError(err: unknown): boolean {
  const code = sqlState(err);
  return code === '40P01' || code === '40001' || code === '55P03';
}

/** Retry a transaction body on deadlock, with a short backoff. */
export async function withRetryingTransaction<T>(
  fn: (tx: pg.PoolClient) => Promise<T>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await withTransaction(fn);
    } catch (err) {
      lastError = err;
      if (!isRetryableLockError(err) || attempt === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt * attempt));
    }
  }
  throw lastError;
}
