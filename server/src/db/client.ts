import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let pool: mysql.Pool | null = null;

function poolConfig(): mysql.PoolOptions {
  const cfg = env();
  const base: mysql.PoolOptions = {
    waitForConnections: true,
    connectionLimit: cfg.DB_POOL_SIZE,
    queueLimit: 0,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: false,
    namedPlaceholders: false,
  };
  if (cfg.DATABASE_URL) return { ...base, uri: cfg.DATABASE_URL };
  return {
    ...base,
    host: cfg.DB_HOST,
    port: cfg.DB_PORT,
    user: cfg.DB_USER,
    password: cfg.DB_PASSWORD,
    database: cfg.DB_NAME,
  };
}

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool(poolConfig());
    logger.info('mysql pool created', { database: env().DB_NAME, poolSize: env().DB_POOL_SIZE });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export type Row = mysql.RowDataPacket;
export type Executor = mysql.Pool | mysql.PoolConnection;
/** Anything mysql2 can bind to a `?` placeholder. */
export type SqlParam = string | number | boolean | Date | Buffer | null | undefined;

/** SELECT returning many rows. */
export async function query<T = Row>(sql: string, params: SqlParam[] = [], exec: Executor = getPool()): Promise<T[]> {
  const [rows] = await exec.query<mysql.RowDataPacket[]>(sql, params);
  return rows as T[];
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
): Promise<mysql.ResultSetHeader> {
  const [result] = await exec.query<mysql.ResultSetHeader>(sql, params);
  return result;
}

/**
 * Run `fn` inside a transaction. Identity resolution and lead assignment both
 * depend on this plus `SELECT … FOR UPDATE`.
 */
export async function withTransaction<T>(fn: (tx: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* the connection is already gone; nothing to roll back */
    }
    throw err;
  } finally {
    conn.release();
  }
}

/** MySQL duplicate-key error — the signal that another worker won a race. */
export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ER_DUP_ENTRY';
}

/** MySQL deadlock / lock-wait timeout — safe to retry the whole transaction. */
export function isRetryableLockError(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
  return code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT';
}

/** Retry a transaction body on deadlock, with a short backoff. */
export async function withRetryingTransaction<T>(
  fn: (tx: mysql.PoolConnection) => Promise<T>,
  attempts = 3,
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
