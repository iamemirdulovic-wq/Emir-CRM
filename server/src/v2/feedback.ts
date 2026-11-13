/**
 * "Report a bug or an idea", and what the owner did about it.
 *
 * `design/web/feedback.html` is the agent's side — one box, one tap — and
 * `design/web/feedback-inbox.html` is the owner's list of what came in.
 *
 * Two things here are deliberate:
 *
 *  - **The screen the agent was on is captured, not asked for.** It is the
 *    first question anybody would ask back, and an agent who has to answer it
 *    before they can report a bug usually does not report the bug.
 *  - **"It stops me working" sorts to the top and stays there.** An agent who
 *    cannot do their job today is a different problem from an idea for next
 *    month, and a single list sorted by date buries the first under the
 *    second.
 *
 * Everyone may report. Only an owner or admin reads the inbox and replies.
 */
import { z } from 'zod';
import { getPool, query, queryOne, execute, type Executor, type SqlParam } from '../db/client.js';
import { notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';

export const FEEDBACK_KINDS = ['bug', 'idea', 'question'] as const;
export const FEEDBACK_STATES = ['new', 'planned', 'fixed', 'declined'] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATES)[number];

export interface Ticket {
  id: string;
  kind: FeedbackKind;
  body: string;
  screen: string | null;
  status: FeedbackStatus;
  blocking: boolean;
  reply: string | null;
  repliedBy: string | null;
  repliedAt: string | null;
  fromName: string | null;
  fromId: string;
  createdAt: string;
}

const COLUMNS = `f.id, f.kind, f.body, f.screen, f.status, f.blocking, f.reply,
  f.replied_at AS repliedAt, f.user_id AS fromId, f.created_at AS createdAt,
  u.name AS fromName, r.name AS repliedBy`;

const JOINS = `FROM feedback_tickets f
  JOIN users u ON u.id = f.user_id
  LEFT JOIN users r ON r.id = f.replied_by`;

function shape(row: Record<string, unknown>): Ticket {
  return {
    ...(row as unknown as Ticket),
    blocking: Number(row.blocking) === 1,
  };
}

export const sendSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  body: z.string().min(4).max(4000),
  /* The path, captured by the screen rather than typed by the person. */
  screen: z.string().max(160).nullable().optional(),
  blocking: z.boolean().optional(),
});

export async function sendFeedback(
  userId: string,
  input: z.infer<typeof sendSchema>,
  exec: Executor = getPool(),
): Promise<Ticket> {
  const id = newId();
  await execute(
    `INSERT INTO feedback_tickets (id, user_id, kind, body, screen, blocking)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, input.kind, input.body.trim(), input.screen?.slice(0, 160) ?? null, input.blocking ? 1 : 0],
    exec,
  );
  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${COLUMNS} ${JOINS} WHERE f.id = ?`, [id], exec,
  );
  return shape(row as Record<string, unknown>);
}

/** What one person has sent, so they can see it was not swallowed. */
export async function myFeedback(
  userId: string,
  exec: Executor = getPool(),
): Promise<Ticket[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT ${COLUMNS} ${JOINS} WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 50`,
    [userId],
    exec,
  );
  return rows.map(shape);
}

export interface Inbox {
  items: Ticket[];
  counts: Record<FeedbackStatus | 'blocking', number>;
}

export async function feedbackInbox(
  filter: FeedbackStatus | 'all' | 'blocking' = 'all',
  exec: Executor = getPool(),
): Promise<Inbox> {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (filter === 'blocking') where.push('f.blocking = 1');
  else if (filter !== 'all') { where.push('f.status = ?'); params.push(filter); }

  const rows = await query<Record<string, unknown>>(
    `SELECT ${COLUMNS} ${JOINS}
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      /* Blocking first whatever its date: somebody who cannot work today
         comes before an idea from last week. */
      ORDER BY f.blocking DESC, f.created_at DESC
      LIMIT 200`,
    params,
    exec,
  );

  const counted = await queryOne<Record<string, number>>(
    `SELECT ${FEEDBACK_STATES.map((one) => `SUM(status = '${one}') AS \`${one}\``).join(', ')},
            SUM(blocking = 1 AND status = 'new') AS blocking
       FROM feedback_tickets`,
    [],
    exec,
  );

  return {
    items: rows.map(shape),
    counts: Object.fromEntries(
      [...FEEDBACK_STATES, 'blocking'].map((key) => [key, Number(counted?.[key] ?? 0)]),
    ) as Record<FeedbackStatus | 'blocking', number>,
  };
}

export const answerSchema = z.object({
  status: z.enum(FEEDBACK_STATES).optional(),
  reply: z.string().max(4000).nullable().optional(),
});

export async function answerFeedback(
  actor: AuditActor & { id: string },
  id: string,
  input: z.infer<typeof answerSchema>,
  exec: Executor = getPool(),
): Promise<Ticket> {
  const before = await queryOne<{ status: string }>(
    'SELECT status FROM feedback_tickets WHERE id = ?', [id], exec,
  );
  if (!before) throw notFound('That report does not exist.');

  const sets: string[] = [];
  const params: SqlParam[] = [];
  if (input.status) { sets.push('status = ?'); params.push(input.status); }
  if (input.reply !== undefined) {
    sets.push('reply = ?', 'replied_by = ?', 'replied_at = NOW(3)');
    params.push(input.reply?.trim() || null, actor.id);
  }

  if (sets.length > 0) {
    await execute(`UPDATE feedback_tickets SET ${sets.join(', ')} WHERE id = ?`, [...params, id], exec);
    await writeAudit({
      actor, action: 'feedback.answered', entityType: 'feedback', entityId: id,
      before: { status: before.status },
      after: { status: input.status ?? before.status, replied: input.reply !== undefined },
    }, exec);
  }

  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${COLUMNS} ${JOINS} WHERE f.id = ?`, [id], exec,
  );
  return shape(row as Record<string, unknown>);
}
