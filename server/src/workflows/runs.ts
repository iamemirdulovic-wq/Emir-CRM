import { execute, queryOne, type Executor, getPool } from '../db/client.js';
import { newId } from '../lib/ids.js';

export type WorkflowKey = 'A_instant_capture' | 'B_no_response_followup' | 'C_inbound_routing';

export interface StartRunInput {
  workflowKey: WorkflowKey;
  contactId: string;
  opportunityId?: string | null;
  context?: Record<string, unknown>;
  /**
   * Set for workflows that must run exactly once per opportunity. The unique
   * index on `singleton_key` turns the INSERT itself into the lock, so two
   * concurrent callers cannot both start a run.
   */
  singletonKey?: string | null;
}

/**
 * The insert both entry points share. Returns null when the singleton key is
 * already taken: DO NOTHING rather than a caught error, because this runs
 * inside the ingestion transaction and an error there would abort all of it.
 */
async function insertRun(input: StartRunInput, exec: Executor): Promise<string | null> {
  const id = newId();
  const written = await execute(
    `INSERT INTO workflow_runs (id, workflow_key, contact_id, opportunity_id, status, context, singleton_key)
     VALUES (?, ?, ?, ?, 'running', ?, ?)
     ON CONFLICT DO NOTHING`,
    [
      id,
      input.workflowKey,
      input.contactId,
      input.opportunityId ?? null,
      input.context ? JSON.stringify(input.context) : null,
      input.singletonKey ?? null,
    ],
    exec,
  );
  return written.affectedRows > 0 ? id : null;
}

export async function startRun(input: StartRunInput, exec: Executor = getPool()): Promise<string> {
  const id = await insertRun(input, exec);
  if (id === null) {
    // Only reachable with a singletonKey, where the caller wants startRunOnce.
    throw new Error(`a workflow run already holds the singleton key ${input.singletonKey}`);
  }
  return id;
}

/**
 * Start a run that may only exist once, identified by `singletonKey`.
 *
 * Returns null when another caller already holds the claim — the expected
 * outcome of a retry, not an error. The uniqueness comes from the index, so
 * this is safe under concurrency in a way a read-then-write check is not.
 */
export async function startRunOnce(
  input: StartRunInput & { singletonKey: string },
  exec: Executor = getPool(),
): Promise<string | null> {
  return insertRun(input, exec);
}

export async function setStep(runId: string, step: string, exec: Executor = getPool()): Promise<void> {
  await execute('UPDATE workflow_runs SET current_step = ? WHERE id = ?', [step, runId], exec);
}

export async function completeRun(runId: string, exec: Executor = getPool()): Promise<void> {
  await execute(
    `UPDATE workflow_runs SET status = 'completed', finished_at = now() WHERE id = ? AND status = 'running'`,
    [runId],
    exec,
  );
}

export async function failRun(runId: string, reason: string, exec: Executor = getPool()): Promise<void> {
  await execute(
    `UPDATE workflow_runs SET status = 'failed', finished_at = now(), cancel_reason = ? WHERE id = ? AND status = 'running'`,
    [reason.slice(0, 160), runId],
    exec,
  );
}

export async function cancelRuns(
  input: { contactId: string; workflowKey?: WorkflowKey; reason: string },
  exec: Executor = getPool(),
): Promise<number> {
  const params: string[] = [input.reason.slice(0, 160), input.contactId];
  let clause = '';
  if (input.workflowKey) {
    clause = ' AND workflow_key = ?';
    params.push(input.workflowKey);
  }
  const result = await execute(
    `UPDATE workflow_runs SET status = 'cancelled', finished_at = now(), cancel_reason = ?
      WHERE contact_id = ? AND status = 'running'${clause}`,
    params,
    exec,
  );
  return result.affectedRows;
}

export async function findRunningRun(
  contactId: string,
  workflowKey: WorkflowKey,
  exec: Executor = getPool(),
): Promise<{ id: string; current_step: string | null } | null> {
  return queryOne<{ id: string; current_step: string | null }>(
    `SELECT id, current_step FROM workflow_runs
      WHERE contact_id = ? AND workflow_key = ? AND status = 'running'
      ORDER BY started_at DESC LIMIT 1`,
    [contactId, workflowKey],
    exec,
  );
}
