/**
 * Telling someone something, and writing it down.
 *
 * Push on its own is fire-and-forget: it reaches the phone or it does not, and
 * either way nothing survives. An agent whose phone was face-down, or who
 * never allowed notifications, had no way to discover that a lead was given to
 * them at 11:40 — it existed for a second and then did not.
 *
 * So every notification is recorded first and pushed second. The record is
 * what the bell reads, and it is also the thing that lets a push failure be a
 * nuisance rather than a lost lead.
 */
import { randomUUID } from 'node:crypto';
import { execute, query, queryOne, type Executor, getPool } from '../db/client.js';
import { logger, errorContext } from '../lib/logger.js';
import { pushToUser, type PushMessage } from './push.js';

export type NotificationType =
  | 'lead_assigned'
  | 'sla_reminder'
  | 'lead_bounced'
  | 'new_incoming'
  | 'enquiry_again'
  | 'followup_due'
  | 'mention'
  | 'deal_won'
  | 'suspicious_activity'
  | 'flagged_login'
  /* A colleague said thank you on the Team Wall. */
  | 'kudos'
  | 'badge_earned';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  /** A path inside the CRM. Never a full URL — the domain has moved once. */
  link?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  priority?: 'normal' | 'high';
}

/**
 * Record it, then push it.
 *
 * The write happens first on purpose. If the push fails — no token, FCM down,
 * the agent never granted permission — the notification is still there in the
 * bell when they next open the CRM, which is the whole point of having a bell.
 */
export async function notify(input: NotifyInput, exec: Executor = getPool()): Promise<string> {
  const id = randomUUID();
  const priority = input.priority ?? 'normal';

  await execute(
    `INSERT INTO notifications (id, user_id, type, title, body, link, contact_id, opportunity_id, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.type,
      input.title.slice(0, 160),
      input.body?.slice(0, 500) ?? null,
      input.link ?? null,
      input.contactId ?? null,
      input.opportunityId ?? null,
      priority,
    ],
    exec,
  );

  const message: PushMessage = {
    title: input.title,
    body: input.body ?? '',
    link: input.link ?? '/dashboard',
    priority,
  };

  const sent = await pushToUser(input.userId, message).catch((err: unknown) => {
    logger.warn('could not push a notification', errorContext(err));
    return 0;
  });

  if (sent > 0) {
    await execute('UPDATE notifications SET sent_push_at = NOW(3) WHERE id = ?', [id], exec)
      .catch(() => undefined);
  }

  return id;
}

/** The same thing to several people — managers, owners — in one call. */
export async function notifyMany(
  userIds: string[],
  input: Omit<NotifyInput, 'userId'>,
  exec: Executor = getPool(),
): Promise<number> {
  let sent = 0;
  for (const userId of userIds) {
    await notify({ ...input, userId }, exec).then(() => { sent += 1; }).catch((err: unknown) =>
      logger.warn('could not notify a user', errorContext(err)));
  }
  return sent;
}

export async function notifyManagers(
  input: Omit<NotifyInput, 'userId'>,
  exec: Executor = getPool(),
): Promise<number> {
  const managers = await query<{ id: string }>(
    `SELECT id FROM users WHERE is_active = 1 AND role IN ('manager','admin','owner')`,
    [],
    exec,
  );
  return notifyMany(managers.map((m) => m.id), input, exec);
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  contact_id: string | null;
  priority: 'normal' | 'high';
  read_at: Date | null;
  created_at: Date;
}

/** This person's bell, newest first. Theirs only — there is no "all" here. */
export async function listNotifications(
  userId: string,
  limit = 50,
): Promise<{ items: NotificationRow[]; unread: number }> {
  const items = await query<NotificationRow>(
    `SELECT id, type, title, body, link, contact_id, priority, read_at, created_at
       FROM notifications WHERE user_id = ?
      ORDER BY created_at DESC LIMIT ?`,
    [userId, Math.min(limit, 200)],
  );
  const unread = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [userId],
  );
  return { items, unread: Number(unread?.n ?? 0) };
}

/**
 * Mark one, or all of them, read.
 *
 * Scoped to the user in the statement rather than checked first: a missing
 * `AND user_id = ?` here would let anyone clear anyone's bell, and a check in
 * front of the query is one refactor away from being dropped.
 */
export async function markRead(userId: string, id: string | null): Promise<number> {
  const result = id
    ? await execute(
      'UPDATE notifications SET read_at = NOW(3) WHERE id = ? AND user_id = ? AND read_at IS NULL',
      [id, userId],
    )
    : await execute(
      'UPDATE notifications SET read_at = NOW(3) WHERE user_id = ? AND read_at IS NULL',
      [userId],
    );
  return result.affectedRows;
}
