import { execute, queryOne, type Executor, getPool } from '../db/client.js';
import { newId } from '../lib/ids.js';

export type WorkflowKey = 'A_instant_capture' | 'B_no_response_followup' | 'C_inbound_routing';

export async function startRun(
  input: { workflowKey: WorkflowKey; contactId: string; opportunityId?: string | null; context?: Record<string, unknown> },
  exec: Executor = getPool(),
): Promise<string> {
  const id = newId();
  await execute(
    `INSERT INTO workflow_runs (id, workflow_key, contact_id, opportunity_id, status, context)
     VALUES (?, ?, ?, ?, 'running', ?)`,
    [id, input.workflowKey, input.contactId, input.opportunityId ?? null, input.context ? JSON.stringify(input.context) : null],
    exec,
  );
  return id;
}

export async function setStep(runId: string, step: string, exec: Executor = getPool()): Promise<void> {
  await execute('UPDATE workflow_runs SET current_step = ? WHERE id = ?', [step, runId], exec);
}

export async function completeRun(runId: string, exec: Executor = getPool()): Promise<void> {
  await execute(
    `UPDATE workflow_runs SET status = 'completed', finished_at = NOW(3) WHERE id = ? AND status = 'running'`,
    [runId],
    exec,
  );
}

export async function failRun(runId: string, reason: string, exec: Executor = getPool()): Promise<void> {
  await execute(
    `UPDATE workflow_runs SET status = 'failed', finished_at = NOW(3), cancel_reason = ? WHERE id = ? AND status = 'running'`,
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
    `UPDATE workflow_runs SET status = 'cancelled', finished_at = NOW(3), cancel_reason = ?
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
