/**
 * Tasks: the agent's working list.
 *
 * Workflows A and B create call tasks automatically, and agents add their own
 * from Contact 360. This is the shared read/write layer behind both the Tasks
 * screen and the per-contact panel, so "complete" behaves identically wherever
 * it is pressed.
 */
import { execute, getPool, query, queryOne, type Executor, type SqlParam } from '../db/client.js';
import { ownerPredicate } from '../auth/scope.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { newId } from '../lib/ids.js';
import { assertIdentifier } from '../lib/sql.js';
import { TIMEZONE_UTC_OFFSET_HOURS } from '../config/constants.js';

/**
 * "Today" means today in Dubai, not today in UTC.
 *
 * Timestamps are stored and read as UTC (the pool is opened with
 * `timezone: 'Z'`), so a bare `DATE(due_at) = CURDATE()` asks a UTC question.
 * Between 20:00 and midnight UTC — which is the small hours of the next morning
 * in Dubai — that answer is a day behind: an agent opening "Today" at 1am would
 * be shown yesterday afternoon's tasks and none of the ones actually due when
 * the office opens. Shifting both sides of the comparison by the offset asks it
 * in the timezone everyone here actually works in, and matches how the
 * dashboard already buckets its daily counts.
 */
const DUBAI_DAY = `DATE(DATE_ADD(t.due_at, INTERVAL ${TIMEZONE_UTC_OFFSET_HOURS} HOUR))`;
const DUBAI_TODAY = `DATE(DATE_ADD(NOW(3), INTERVAL ${TIMEZONE_UTC_OFFSET_HOURS} HOUR))`;

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
    today: `t.completed_at IS NULL AND ${DUBAI_DAY} = ${DUBAI_TODAY}`,
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
       SUM(CASE WHEN t.completed_at IS NULL AND ${DUBAI_DAY} = ${DUBAI_TODAY} THEN 1 ELSE 0 END) AS today,
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
/** Enough of a task to check the caller may touch it, and to audit what changed. */
type TaskSummary = {
  assigned_user_id: string | null;
  contact_id: string | null;
  title: string;
  due_at: string;
};

async function assertCanActOnTask(
  taskId: string,
  visible: string[] | null,
  exec: Executor,
): Promise<TaskSummary> {
  const task = await queryOne<TaskSummary>(
    'SELECT assigned_user_id, contact_id, title, due_at FROM tasks WHERE id = ?',
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

/* ── Creating and editing ───────────────────────────────────────────────── */

export type TaskType = TaskRow['type'];
export type TaskPriority = TaskRow['priority'];

export type TaskInput = {
  title: string;
  notes?: string | null;
  type?: TaskType;
  priority?: TaskPriority;
  /** ISO instant. The UI sends a local date and time; the browser converts. */
  dueAt: string;
  assignedUserId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
};

/**
 * Who a task may be given to.
 *
 * An agent can only make work for themselves — being able to put a task on a
 * colleague's list is a manager's power, and quietly the more important half of
 * that is that nobody can hide work by assigning it away.
 */
function assertCanAssign(actorId: string, visible: string[] | null, assignee: string | null): void {
  if (!assignee || assignee === actorId) return;
  if (visible === null) return;
  if (!visible.includes(assignee)) {
    throw forbidden('You can only assign a task to yourself or someone on your team');
  }
}

export async function createTask(
  actor: AuditActor,
  input: TaskInput,
  visible: string[] | null,
  exec: Executor = getPool(),
): Promise<string> {
  const actorId = actor.userId;
  if (!actorId) throw forbidden('Only a signed-in user can create a task');

  const assignee = input.assignedUserId ?? actorId;
  assertCanAssign(actorId, visible, assignee);

  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) throw badRequest('That due date is not a real date and time');

  const id = newId();
  await execute(
    `INSERT INTO tasks (id, contact_id, opportunity_id, assigned_user_id, created_by_user_id,
                        type, title, notes, priority, due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.contactId ?? null,
      input.opportunityId ?? null,
      assignee,
      actorId,
      input.type ?? 'other',
      input.title.trim(),
      input.notes?.trim() || null,
      input.priority ?? 'normal',
      dueAt,
    ],
    exec,
  );

  await writeAudit(
    {
      actor,
      action: 'task.created',
      entityType: 'task',
      entityId: id,
      after: { title: input.title, dueAt: dueAt.toISOString(), assignedUserId: assignee, priority: input.priority ?? 'normal' },
    },
    exec,
  );
  return id;
}

export type TaskPatch = Partial<Omit<TaskInput, 'dueAt'>> & { dueAt?: string };

export async function updateTask(
  actor: AuditActor,
  taskId: string,
  patch: TaskPatch,
  visible: string[] | null,
  exec: Executor = getPool(),
): Promise<void> {
  const before = await assertCanActOnTask(taskId, visible, exec);
  const actorId = actor.userId;
  if (!actorId) throw forbidden('Only a signed-in user can edit a task');

  const columns: string[] = [];
  const params: SqlParam[] = [];
  const after: Record<string, unknown> = {};

  const set = (column: string, value: SqlParam, label = column) => {
    columns.push(`${assertIdentifier(column)} = ?`);
    params.push(value);
    after[label] = value instanceof Date ? value.toISOString() : value;
  };

  if (patch.title !== undefined) set('title', patch.title.trim());
  if (patch.notes !== undefined) set('notes', patch.notes?.trim() || null);
  if (patch.type !== undefined) set('type', patch.type);
  if (patch.priority !== undefined) set('priority', patch.priority);
  if (patch.dueAt !== undefined) {
    const dueAt = new Date(patch.dueAt);
    if (Number.isNaN(dueAt.getTime())) throw badRequest('That due date is not a real date and time');
    set('due_at', dueAt);
    /*
     * A deadline that moved deserves a fresh warning. Without this, pushing a
     * task from this morning to next week would leave it marked as already
     * nudged, and next week would pass in silence.
     */
    columns.push('reminder_sent_at = NULL');
  }
  if (patch.assignedUserId !== undefined) {
    assertCanAssign(actorId, visible, patch.assignedUserId);
    set('assigned_user_id', patch.assignedUserId);
    // The new owner has not been warned about it yet, whatever the old one had.
    columns.push('reminder_sent_at = NULL');
  }

  if (columns.length === 0) return;

  await execute(`UPDATE tasks SET ${columns.join(', ')} WHERE id = ?`, [...params, taskId], exec);
  await writeAudit(
    {
      actor,
      action: 'task.updated',
      entityType: 'task',
      entityId: taskId,
      before: { title: before.title, dueAt: before.due_at, assignedUserId: before.assigned_user_id },
      after,
    },
    exec,
  );
}

export async function deleteTask(
  actor: AuditActor,
  taskId: string,
  visible: string[] | null,
  exec: Executor = getPool(),
): Promise<void> {
  const before = await assertCanActOnTask(taskId, visible, exec);
  // Attachments go with it: the foreign key cascades the rows, and the
  // maintenance sweep clears the files whose rows have gone.
  await execute('DELETE FROM tasks WHERE id = ?', [taskId], exec);
  await writeAudit(
    {
      actor,
      action: 'task.deleted',
      entityType: 'task',
      entityId: taskId,
      before: { title: before.title, dueAt: before.due_at, assignedUserId: before.assigned_user_id },
    },
    exec,
  );
}

/* ── The calendar ───────────────────────────────────────────────────────── */

/**
 * Every task falling inside a window, for the month, week or day grid.
 *
 * Bounded rather than paged: a month of one team's tasks is a screenful, and a
 * calendar that silently omitted the tail of a busy day would be worse than
 * useless. The cap exists only so a hand-written range cannot ask for a decade.
 */
export async function tasksInRange(
  viewerId: string,
  visible: string[] | null,
  options: { from: string; to: string; scope: TaskScope },
  exec: Executor = getPool(),
): Promise<TaskRow[]> {
  const from = new Date(options.from);
  const to = new Date(options.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw badRequest('That date range is not valid');
  }
  if (to <= from) throw badRequest('The range must end after it starts');
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days > 62) throw badRequest('A calendar range cannot be longer than two months');

  const ids = options.scope === 'mine' ? [viewerId] : visible;
  const owner = ownerPredicate('t.assigned_user_id', ids);

  return query<TaskRow>(
    `SELECT t.id, t.type, t.title, t.notes, t.priority, t.due_at, t.completed_at,
            t.contact_id, t.opportunity_id, t.assigned_user_id,
            c.full_name, c.phone_e164, c.lead_score,
            o.stage_key, o.project_name,
            u.name AS assignee_name
       FROM tasks t
       LEFT JOIN contacts c ON c.id = t.contact_id
       LEFT JOIN opportunities o ON o.id = t.opportunity_id
       LEFT JOIN users u ON u.id = t.assigned_user_id
      WHERE ${owner.sql} AND t.due_at >= ? AND t.due_at < ?
      ORDER BY t.due_at ASC
      LIMIT 2000`,
    [...owner.params, from, to],
    exec,
  );
}
