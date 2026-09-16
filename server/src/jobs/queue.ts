import { execute, isDuplicateKeyError, query, type Executor, getPool } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import type { JobRecord, JobType } from './types.js';

export type EnqueueOptions = {
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  /**
   * Makes the enqueue idempotent. A second attempt with the same key is a
   * no-op, which is what stops a replayed webhook from scheduling the same
   * follow-up twice.
   */
  dedupeKey?: string;
  workflowRunId?: string | null;
  contactId?: string | null;
};

export type EnqueueResult = { id: string | null; enqueued: boolean };

/** Add a job. Returns `enqueued: false` when a dedupe key already claimed it. */
export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
  exec: Executor = getPool(),
): Promise<EnqueueResult> {
  const id = newId();
  try {
    await execute(
      `INSERT INTO jobs (id, type, payload, status, priority, run_at, max_attempts, dedupe_key, workflow_run_id, contact_id)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      [
        id,
        type,
        JSON.stringify(payload),
        opts.priority ?? 5,
        opts.runAt ?? new Date(),
        opts.maxAttempts ?? 5,
        opts.dedupeKey ?? null,
        opts.workflowRunId ?? null,
        opts.contactId ?? null,
      ],
      exec,
    );
    return { id, enqueued: true };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      logger.debug('job already queued, skipping', { type, dedupeKey: opts.dedupeKey });
      return { id: null, enqueued: false };
    }
    throw err;
  }
}

/**
 * Claim up to `batchSize` due jobs for this worker.
 *
 * SKIP LOCKED lets several workers share the table without blocking each other,
 * and the UPDATE … WHERE status = 'pending' re-check means a job can only ever
 * be claimed once.
 */
export async function claimJobs(workerId: string, batchSize: number): Promise<JobRecord[]> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const candidates = await query<{ id: string }>(
      `SELECT id FROM jobs
        WHERE status = 'pending' AND run_at <= NOW(3)
        ORDER BY priority ASC, run_at ASC
        LIMIT ${Number(batchSize) || 10}
        FOR UPDATE SKIP LOCKED`,
      [],
      conn,
    );
    if (candidates.length === 0) {
      await conn.commit();
      return [];
    }
    const ids = candidates.map((c) => c.id);
    await execute(
      `UPDATE jobs SET status = 'running', locked_by = ?, locked_at = NOW(3), attempts = attempts + 1
        WHERE id IN (${ids.map(() => '?').join(',')}) AND status = 'pending'`,
      [workerId, ...ids],
      conn,
    );
    const rows = await query<{
      id: string;
      type: JobType;
      payload: unknown;
      attempts: number;
      max_attempts: number;
      run_at: Date;
      workflow_run_id: string | null;
      contact_id: string | null;
    }>(
      `SELECT id, type, payload, attempts, max_attempts, run_at, workflow_run_id, contact_id
         FROM jobs WHERE id IN (${ids.map(() => '?').join(',')}) AND locked_by = ? AND status = 'running'`,
      [...ids, workerId],
      conn,
    );
    await conn.commit();
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      payload: parsePayload(row.payload),
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      runAt: row.run_at,
      workflowRunId: row.workflow_run_id,
      contactId: row.contact_id,
    }));
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function completeJob(id: string, result?: unknown, exec: Executor = getPool()): Promise<void> {
  await execute(
    `UPDATE jobs SET status = 'done', finished_at = NOW(3), locked_by = NULL, last_error = NULL, result = ?
      WHERE id = ?`,
    [result === undefined ? null : JSON.stringify(result), id],
    exec,
  );
}

/** Retry with exponential backoff until max_attempts, then park as failed. */
export async function failJob(id: string, error: unknown, exec: Executor = getPool()): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await execute(
    `UPDATE jobs
        SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
            run_at = CASE WHEN attempts >= max_attempts THEN run_at
                          ELSE DATE_ADD(NOW(3), INTERVAL LEAST(POW(2, attempts) * 30, 3600) SECOND) END,
            finished_at = CASE WHEN attempts >= max_attempts THEN NOW(3) ELSE NULL END,
            locked_by = NULL,
            last_error = ?
      WHERE id = ?`,
    [message.slice(0, 2000), id],
    exec,
  );
}

/** Cancel pending jobs — how Workflow B is stopped when a lead replies. */
export async function cancelJobs(
  filter: { contactId: string; types?: JobType[]; reason?: string },
  exec: Executor = getPool(),
): Promise<number> {
  const params: Array<string> = [filter.contactId];
  let typeClause = '';
  if (filter.types?.length) {
    typeClause = ` AND type IN (${filter.types.map(() => '?').join(',')})`;
    params.push(...filter.types);
  }
  const result = await execute(
    `UPDATE jobs SET status = 'cancelled', finished_at = NOW(3), last_error = ?
      WHERE contact_id = ? AND status = 'pending'${typeClause}`,
    [filter.reason ?? 'cancelled', ...params],
    exec,
  );
  return result.affectedRows;
}

/** Release jobs whose worker died mid-flight. */
export async function reclaimStaleJobs(staleAfterSeconds = 300, exec: Executor = getPool()): Promise<number> {
  const result = await execute(
    `UPDATE jobs SET status = 'pending', locked_by = NULL
      WHERE status = 'running' AND locked_at < DATE_SUB(NOW(3), INTERVAL ? SECOND)`,
    [staleAfterSeconds],
    exec,
  );
  return result.affectedRows;
}
