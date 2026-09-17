/**
 * The deadline nudge: an email to whoever owns a task, shortly before it is due.
 *
 * Swept rather than scheduled. A job queued at creation time would be wrong the
 * moment somebody moved the deadline, and there would be no way to catch up on
 * a task whose moment passed while the worker was down. A sweep asks the only
 * question that matters — what is due soon and unwarned — and answers it
 * correctly however the data got that way.
 *
 * `reminder_sent_at` is what makes it safe to run every few minutes: the row is
 * claimed before the email is attempted, so a slow SMTP server cannot cause a
 * second sweep to send the same nudge again.
 */
import { env } from '../config/env.js';
import { execute, getPool, query, type Executor } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { formatInDubai } from '../lib/time.js';
import { sendInternalEmail } from '../messaging/email/internal.js';

type DueTask = {
  id: string;
  title: string;
  notes: string | null;
  priority: string;
  due_at: string;
  assignee_name: string | null;
  assignee_email: string | null;
  contact_id: string | null;
  full_name: string | null;
  phone_e164: string | null;
};

export type SweepResult = { found: number; sent: number; skipped: number };

/**
 * Warn about everything due inside the window that nobody has been warned about.
 *
 * Tasks already past their deadline are included: a worker that was down for an
 * hour should still say something, late, rather than stay silent because the
 * moment has passed.
 */
export async function sweepTaskReminders(
  now: Date = new Date(),
  exec: Executor = getPool(),
): Promise<SweepResult> {
  const minutes = env().TASK_REMINDER_MINUTES;
  const until = new Date(now.getTime() + minutes * 60_000);

  /*
   * Bounded so one sweep cannot try to send a thousand emails in a batch and
   * time out; whatever is left is picked up by the next run a few minutes later.
   */
  const due = await query<DueTask>(
    `SELECT t.id, t.title, t.notes, t.priority, t.due_at,
            u.name AS assignee_name, u.email AS assignee_email,
            t.contact_id, c.full_name, c.phone_e164
       FROM tasks t
       JOIN users u ON u.id = t.assigned_user_id
       LEFT JOIN contacts c ON c.id = t.contact_id
      WHERE t.completed_at IS NULL
        AND t.reminder_sent_at IS NULL
        AND t.due_at <= ?
        AND u.is_active = 1
      ORDER BY t.due_at ASC
      LIMIT 100`,
    [until],
    exec,
  );

  let sent = 0;
  let skipped = 0;

  for (const task of due) {
    /*
     * Claimed before sending, not after. The other order would let a sweep that
     * overlaps a slow send email the same person twice, and a duplicate nudge
     * is how people learn to ignore them.
     */
    const claim = await execute(
      'UPDATE tasks SET reminder_sent_at = NOW(3) WHERE id = ? AND reminder_sent_at IS NULL',
      [task.id],
      exec,
    );
    if (claim.affectedRows === 0) continue;

    if (!task.assignee_email) {
      skipped += 1;
      continue;
    }

    const result = await sendInternalEmail(buildReminder(task, now));
    if (result.sent) sent += 1;
    else skipped += 1;
  }

  if (due.length > 0) logger.info('task reminders swept', { found: due.length, sent, skipped });
  return { found: due.length, sent, skipped };
}

/** The email itself. Plain enough to read on a phone at a glance. */
export function buildReminder(task: DueTask, now: Date): { to: string; subject: string; text: string } {
  const due = new Date(task.due_at);
  const late = due.getTime() < now.getTime();
  const when = formatInDubai(due);

  const lines = [
    `Hello ${task.assignee_name ?? 'there'},`,
    '',
    late ? `This task was due at ${when} and is still open:` : `This task is due at ${when}:`,
    '',
    `  ${task.title}`,
  ];

  if (task.full_name) {
    lines.push(`  Lead: ${task.full_name}${task.phone_e164 ? ` · ${task.phone_e164}` : ''}`);
  }
  if (task.notes) lines.push(`  Notes: ${task.notes}`);

  lines.push(
    '',
    `Open it here: ${env().APP_URL}/tasks`,
    '',
    'Emir CRM',
  );

  return {
    to: task.assignee_email as string,
    // "Overdue" rather than "due soon" when it already is: a subject line that
    // says the wrong thing is worse than no subject line.
    subject: `${late ? 'Overdue' : 'Due soon'}: ${task.title}`,
    text: lines.join('\n'),
  };
}
