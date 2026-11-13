import { execute, query, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { notify } from '../messaging/notify.js';
import { attendanceSettings } from '../attendance/settings.js';
import { dubaiDate } from '../attendance/attendance.js';
import type { SessionUser } from '../auth/sessions.js';

/**
 * Asking for days off, and answering.
 *
 * Two rules the design is firm about and both are about not arguing later:
 *
 *  - **Working days are counted when the request is made, and kept.** If the
 *    office later changes which day it is shut, a decision somebody already
 *    took does not quietly become a different number of days.
 *  - **A refusal needs a reason.** "No" with nothing after it is the thing an
 *    agent cannot act on, and it is what makes people stop asking and simply
 *    not turn up.
 */

export const LEAVE_KINDS = ['annual', 'sick', 'unpaid', 'emergency', 'other'] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

export interface LeaveRequest {
  id: string;
  userId: string;
  userName?: string;
  kind: LeaveKind;
  fromDate: string;
  toDate: string;
  workingDays: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'refused' | 'cancelled';
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

const row = (r: Record<string, unknown>): LeaveRequest => ({
  id: String(r.id),
  userId: String(r.user_id),
  ...(r.user_name ? { userName: String(r.user_name) } : {}),
  kind: r.kind as LeaveKind,
  fromDate: String(r.from_date).slice(0, 10),
  toDate: String(r.to_date).slice(0, 10),
  workingDays: Number(r.working_days),
  reason: (r.reason as string | null) ?? null,
  status: r.status as LeaveRequest['status'],
  decisionNote: (r.decision_note as string | null) ?? null,
  decidedAt: (r.decided_at as Date | null) ?? null,
  createdAt: r.created_at as Date,
});

const SELECT = `
  SELECT l.id, l.user_id, u.name AS user_name, l.kind, l.from_date, l.to_date,
         l.working_days, l.reason, l.status, l.decision_note, l.decided_at, l.created_at
    FROM leave_requests l
    JOIN users u ON u.id = l.user_id`;

/**
 * How many working days a range covers.
 *
 * Counted against the days the office is shut, which an owner sets. A request
 * for Friday to Sunday where the office closes on Sunday is two days off, not
 * three, and an agent who has to argue that is one who stops filing requests.
 */
export async function workingDaysBetween(from: string, to: string): Promise<number> {
  const settings = await attendanceSettings();
  const shut = new Set(settings.closedDays);
  let days = 0;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let at = start; at <= end; at += 86_400_000) {
    if (!shut.has(new Date(at).getUTCDay())) days += 1;
  }
  return days;
}

export async function askForLeave(
  actor: AuditActor,
  user: SessionUser,
  input: { kind: LeaveKind; fromDate: string; toDate: string; reason?: string | null },
): Promise<LeaveRequest> {
  const today = dubaiDate();
  if (input.fromDate < today) throw badRequest('Leave cannot start in the past.');
  if (input.toDate < input.fromDate) throw badRequest('The last day is before the first one.');

  const workingDays = await workingDaysBetween(input.fromDate, input.toDate);
  if (workingDays === 0) {
    throw badRequest('Those days are already days off — there is nothing to ask for.');
  }

  const id = newId();
  await execute(
    `INSERT INTO leave_requests
       (id, user_id, kind, from_date, to_date, working_days, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, user.id, input.kind, input.fromDate, input.toDate, workingDays, input.reason ?? null],
  );

  /* Everybody who can answer it hears about it. A request nobody sees is the
     same as no request, and the agent has already made their plans. */
  const owners = await query<{ id: string }>(
    "SELECT id FROM users WHERE is_active = 1 AND role IN ('owner','admin')",
  );
  for (const owner of owners) {
    await notify({
      userId: owner.id,
      type: 'mention',
      title: `${user.name} is asking for ${workingDays} ${workingDays === 1 ? 'day' : 'days'} off`,
      body: `${input.fromDate} to ${input.toDate}${input.reason ? ` · ${input.reason}` : ''}`,
      link: '/v2/attendance',
    }).catch(() => undefined);
  }

  await writeAudit({
    actor, action: 'leave.asked', entityType: 'leave_request', entityId: id,
    after: { ...input, workingDays },
  });

  const made = await queryOne<Record<string, unknown>>(`${SELECT} WHERE l.id = ?`, [id]);
  return row(made as Record<string, unknown>);
}

export async function myLeave(userId: string): Promise<LeaveRequest[]> {
  const rows = await query<Record<string, unknown>>(
    `${SELECT} WHERE l.user_id = ? ORDER BY l.from_date DESC LIMIT 60`, [userId],
  );
  return rows.map(row);
}

export async function allLeave(): Promise<LeaveRequest[]> {
  const rows = await query<Record<string, unknown>>(
    `${SELECT} ORDER BY l.status = 'pending' DESC, l.from_date DESC LIMIT 120`,
  );
  return rows.map(row);
}

export async function answerLeave(
  actor: AuditActor,
  user: SessionUser,
  id: string,
  input: { status: 'approved' | 'refused'; note?: string | null },
): Promise<LeaveRequest> {
  if (input.status === 'refused' && !input.note?.trim()) {
    throw badRequest('A refusal needs a reason — that is what the agent acts on.');
  }

  const before = await queryOne<Record<string, unknown>>(`${SELECT} WHERE l.id = ?`, [id]);
  if (!before) throw notFound('That request is no longer there.');
  if (before.status === 'cancelled') throw badRequest('That request was cancelled.');

  await execute(
    `UPDATE leave_requests
        SET status = ?, decided_by = ?, decided_at = NOW(3), decision_note = ?
      WHERE id = ?`,
    [input.status, user.id, input.note ?? null, id],
  );

  await notify({
    userId: String(before.user_id),
    type: 'mention',
    title: input.status === 'approved' ? 'Your leave is approved' : 'Your leave was not approved',
    body: input.note ?? null,
    link: '/v2/attendance',
    priority: 'high',
  }).catch(() => undefined);

  await writeAudit({
    actor, action: `leave.${input.status}`, entityType: 'leave_request', entityId: id,
    before: { status: before.status }, after: input,
  });

  const after = await queryOne<Record<string, unknown>>(`${SELECT} WHERE l.id = ?`, [id]);
  return row(after as Record<string, unknown>);
}

/** Taking it back. Only your own, and only while nobody has answered. */
export async function cancelLeave(
  actor: AuditActor,
  user: SessionUser,
  id: string,
): Promise<{ cancelled: true }> {
  const before = await queryOne<{ user_id: string; status: string }>(
    'SELECT user_id, status FROM leave_requests WHERE id = ?', [id],
  );
  if (!before) throw notFound('That request is no longer there.');
  if (before.user_id !== user.id) throw forbidden('That is somebody else’s request.');
  if (before.status !== 'pending') throw badRequest('That request has already been answered.');

  await execute("UPDATE leave_requests SET status = 'cancelled' WHERE id = ?", [id]);
  await writeAudit({
    actor, action: 'leave.cancelled', entityType: 'leave_request', entityId: id,
  });
  return { cancelled: true };
}

/**
 * What this person has actually taken this year.
 *
 * Not "14 days left": there is no allowance anywhere in this database, and a
 * number on a screen that nobody set is a number somebody will plan a holiday
 * around. Days taken is true, and the allowance becomes a Settings field the
 * day Emir says what it is.
 */
export async function leaveTakenThisYear(userId: string): Promise<Record<string, number>> {
  const rows = await query<{ kind: string; days: number }>(
    `SELECT kind, SUM(working_days) AS days
       FROM leave_requests
      WHERE user_id = ? AND status = 'approved'
        AND YEAR(from_date) = YEAR(CONVERT_TZ(NOW(3), '+00:00', '+04:00'))
      GROUP BY kind`,
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.kind, Number(r.days)]));
}
