/**
 * Automations: the workflows, and whether they are switched on.
 *
 * The Automations screen is a control panel over the `workflows` table. Turning
 * one off is a real operational decision — it stops leads being answered — so
 * the change is audited with before and after, like any other data change.
 */
import { execute, getPool, query, queryOne, type Executor } from '../db/client.js';
import { badRequest } from '../lib/errors.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';

export interface AutomationRow {
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  /** Runs started in the last 7 days, by outcome. */
  runs: { running: number; completed: number; cancelled: number; failed: number };
  lastRunAt: string | null;
}

const RECENT_DAYS = 7;

export async function listAutomations(exec: Executor = getPool()): Promise<AutomationRow[]> {
  const workflows = await query<{
    key: string;
    name: string;
    description: string | null;
    is_active: number;
  }>('SELECT `key`, name, description, is_active FROM workflows ORDER BY `key`', [], exec);

  const stats = await query<{
    workflow_key: string;
    status: string;
    n: number;
    last_started: string | null;
  }>(
    `SELECT workflow_key, status, COUNT(*) AS n, MAX(started_at) AS last_started
       FROM workflow_runs
      WHERE started_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)
      GROUP BY workflow_key, status`,
    [RECENT_DAYS],
    exec,
  );

  return workflows.map((workflow) => {
    const rows = stats.filter((row) => row.workflow_key === workflow.key);
    const count = (status: string) => Number(rows.find((row) => row.status === status)?.n ?? 0);
    const last = rows
      .map((row) => row.last_started)
      .filter((value): value is string => Boolean(value))
      .sort()
      .pop();

    return {
      key: workflow.key,
      name: workflow.name,
      description: workflow.description,
      isActive: workflow.is_active === 1,
      runs: {
        running: count('running'),
        completed: count('completed'),
        cancelled: count('cancelled'),
        failed: count('failed'),
      },
      lastRunAt: last ?? null,
    };
  });
}

export async function setAutomationActive(
  actor: AuditActor,
  key: string,
  isActive: boolean,
  exec: Executor = getPool(),
): Promise<void> {
  const before = await queryOne<{ is_active: number; name: string }>(
    'SELECT is_active, name FROM workflows WHERE `key` = ?',
    [key],
    exec,
  );
  if (!before) throw badRequest('That automation does not exist');

  await execute('UPDATE workflows SET is_active = ? WHERE `key` = ?', [isActive ? 1 : 0, key], exec);
  await writeAudit(
    {
      actor,
      action: isActive ? 'automation.enabled' : 'automation.disabled',
      entityType: 'workflow',
      entityId: key,
      before: { isActive: before.is_active === 1 },
      after: { isActive },
    },
    exec,
  );
}
