/**
 * Tasks: the agent's working list.
 *
 * Workflows A and B create call tasks automatically, and agents add their own
 * from Contact 360. This is the shared read/write layer behind both the Tasks
 * screen and the per-contact panel, so "complete" behaves identically wherever
 * it is pressed.
 */
import { execute, getPool, query, queryOne, type Executor } from '../db/client.js';
import { ownerPredicate } from '../auth/scope.js';
import { badRequest } from '../lib/errors.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';

export type TaskScope = 'mine' | 'team' | 'all';
export type TaskFilter = 'open' | 'overdue' | 'today' | 'done';

export interface TaskRow {
  id: string;
  type: 'call' | 'whatsapp' | 'email' | 'meeting' | 'other';
  title: string;
  notes: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  due_at: string;
  completed_at: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  full_name: string | null;
  phone_e164: string | null;
  lead_score: number | null;
  stage_key: string | null;
  project_name: string | null;
  assigned_user_id: string | null;
  assignee_name: string | null;
}

export interface TaskCounts {
  overdue: number;
  today: number;
  open: number;
  done: number;
}

/**
 * `visible` is the viewer's scope from `visibleUserIds`: null means no
 * restriction. `scope` narrows further, so a manager can ask for just their own.
 */
export async function listTasks(
  viewerId: string,
  visible: string[] | null,
  options: { scope: TaskScope; filter: TaskFilter; limit?: number },
  exec: Executor = getPool(),
): Promise<{ items: TaskRow[]; counts: TaskCounts }> {
  // "mine" always means this user, whatever their role allows them to see.
  const ids = options.scope === 'mine' ? [viewerId] : visible;
  const owner = ownerPredicate('t.assigned_user_id', ids);

  const WHERE: Record<TaskFilter, string> = {
    open: 't.completed_at IS NULL',
    overdue: 't.completed_at IS NULL AND t.due_at < NOW(3)',
    today: 't.completed_at IS NULL AND DATE(t.due_at) = CURDATE()',
    done: 't.completed_at IS NOT NULL',
  };

  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);

  const items = await query<TaskRow>(
    `SELECT t.id, t.type, t.title, t.notes, t.priority, t.due_at, t.completed_at,
            t.contact_id, t.opportunity_id, t.assigned_user_id,
            c.full_name, c.phone_e164, c.lead_score,
            o.stage_key, o.project_name,
            u.name AS assignee_name
       FROM tasks t
       LEFT JOIN contacts c ON c.id = t.contact_id
       LEFT JOIN opportunities o ON o.id = t.opportunity_id
       LEFT JOIN users u ON u.id = t.assigned_user_id
      WHERE ${owner.sql} AND ${WHERE[options.filter]}
      ORDER BY ${options.filter === 'done' ? 't.completed_at DESC' : 't.due_at ASC'}
      LIMIT ${limit}`,
    owner.params,
    exec,
  );

  const counts = await queryOne<TaskCounts>(
    `SELECT
       SUM(CASE WHEN t.completed_at IS NULL AND t.due_at < NOW(3) THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN t.completed_at IS NULL AND DATE(t.due_at) = CURDATE() THEN 1 ELSE 0 END) AS today,
       SUM(CASE WHEN t.completed_at IS NULL THEN 1 ELSE 0 END) AS open,
       SUM(CASE WHEN t.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done
     FROM tasks t WHERE ${owner.sql}`,
    owner.params,
    exec,
  );

  return {
    items,
    counts: {
      overdue: Number(counts?.overdue ?? 0),
      today: Number(counts?.today ?? 0),
      open: Number(counts?.open ?? 0),
      done: Number(counts?.done ?? 0),
    },
  };
}

/** True when the viewer may act on this task. */
async function assertCanActOnTask(
  taskId: string,
  visible: string[] | null,
  exec: Executor,
): Promise<{ assigned_user_id: string | null; contact_id: string | null }> {
  const task = await queryOne<{ assigned_user_id: string | null; contact_id: string | null }>(
    'SELECT assigned_user_id, contact_id FROM tasks WHERE id = ?',
    [taskId],
    exec,
  );
  if (!task) throw badRequest('Task not found');
  // An unassigned task is nobody's to close quietly; only an unrestricted
  // viewer (owner, admin) may act on one.
  if (visible !== null && (!task.assigned_user_id || !visible.includes(task.assigned_user_id))) {
    throw badRequest('That task belongs to someone else');
  }
  return task;
}

export async function completeTask(
  actor: AuditActor,
  taskId: string,
  visible: string[] | null,
  exec: Executor = getPool(),
): Promise<void> {
  const task = await assertCanActOnTask(taskId, visible, exec);
  // The IS NULL guard makes a double-tap on a phone a no-op rather than a
  // second audit entry with a different closer.
  await execute(
    'UPDATE tasks SET completed_at = NOW(3), completed_by_user_id = ? WHERE id = ? AND completed_at IS NULL',
    [actor.userId, taskId],
    exec,
  );
  await writeAudit(
    { actor, action: 'task.completed', entityType: 'task', entityId: taskId, after: { contactId: task.contact_id } },
    exec,
  );
}

export async function reopenTask(
  actor: AuditActor,
  taskId: string,
  visible: string[] | null,
  exec: Executor = getPool(),
): Promise<void> {
  await assertCanActOnTask(taskId, visible, exec);
  await execute(
    'UPDATE tasks SET completed_at = NULL, completed_by_user_id = NULL WHERE id = ?',
    [taskId],
    exec,
  );
  await writeAudit({ actor, action: 'task.reopened', entityType: 'task', entityId: taskId }, exec);
}
