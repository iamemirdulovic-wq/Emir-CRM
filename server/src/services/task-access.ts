/**
 * May this viewer see this task?
 *
 * Split out from `tasks.ts` because the attachment routes need exactly this
 * check and nothing else: an attachment is only as private as the task it hangs
 * on, so every read, upload and delete asks the same question in the same way.
 */
import { getPool, queryOne, type Executor } from '../db/client.js';
import { notFound } from '../lib/errors.js';

export async function assertCanViewTask(
  taskId: string,
  visible: string[] | null,
  exec: Executor = getPool(),
): Promise<void> {
  const task = await queryOne<{ assigned_user_id: string | null }>(
    'SELECT assigned_user_id FROM tasks WHERE id = ?',
    [taskId],
    exec,
  );
  /*
   * "Not found" rather than "forbidden" for a task belonging to someone else.
   * Telling an agent that a task exists but is not theirs leaks that it exists
   * at all, which is enough to enumerate a colleague's workload one id at a time.
   */
  if (!task) throw notFound('That task does not exist');
  if (visible !== null && (!task.assigned_user_id || !visible.includes(task.assigned_user_id))) {
    throw notFound('That task does not exist');
  }
}
