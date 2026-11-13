/**
 * Plans in the diary, and what came of them.
 *
 * A "plan" is one row of `meetings`: a meeting, a site visit, a call, a
 * follow-up or a team event. Until now the only two things the server could do
 * with one were create it and stamp a bare result on it, which is why the
 * calendar could not change a plan, could not delete one, and threw away
 * everything the "How did it go?" panel asks for.
 *
 * Everything here follows `design/web/calendar.html`:
 *
 *  - A plan for a meeting, a site visit or a call belongs to a lead. A plan
 *    in the diary with no lead is a plan nobody can follow up.
 *  - A plan cannot be put in the past, and the refusal names the field that is
 *    wrong — the day or the time — because "that is not valid" tells an agent
 *    standing in a sales centre nothing.
 *  - "Moved it" moves the plan. It does not record a result: the plan is still
 *    to be done, at a different hour.
 *  - "They booked" moves the lead to Won, and will not save without the
 *    booking form or the receipt, because the owner checks that file before the
 *    deal counts.
 *
 * The pure half (the past check, the clash check, the span of an all-day plan)
 * is exported on its own so it can be tested without a database — it is the
 * half that is easy to get quietly wrong.
 */
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { execute, getPool, query, queryOne, withRetryingTransaction, type Executor } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { logger, errorContext } from '../lib/logger.js';
import { TIMEZONE_UTC_OFFSET_HOURS } from '../config/constants.js';
import { env } from '../config/env.js';
import { IMAGE_TYPES, extensionFor, insideUploadDir, isInlineSafe, uploadDir } from '../lib/uploads.js';
import { moveStage } from '../services/opportunities.js';
import type { Role } from '../auth/rbac.js';

export const PLAN_KINDS = ['meeting', 'site_visit', 'call', 'follow_up', 'team'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const PLAN_RESULTS = ['showed', 'no_show', 'rescheduled', 'booked', 'cancelled'] as const;
export type PlanResult = (typeof PLAN_RESULTS)[number];

export const ASKED_BY = ['client', 'me', 'developer'] as const;
export type AskedBy = (typeof ASKED_BY)[number];

/**
 * The three kinds that cannot exist without a lead.
 *
 * The design's own form also requires one for a Follow-up; Emir's brief for
 * this change named three, so a follow-up may still be made without one. See
 * `docs/decisions-to-confirm.md`.
 */
export const LEAD_REQUIRED: readonly PlanKind[] = ['meeting', 'site_visit', 'call'];

/** A plan that runs over several days runs over at most five of them. */
export const MAX_SPAN_DAYS = 5;

export function needsLead(kind: PlanKind): boolean {
  return LEAD_REQUIRED.includes(kind);
}

/* ── the pure half ─────────────────────────────────────────────────────── */

/** Which field an agent has to go back and change, and what to say about it. */
export type FieldProblem = { field: 'day' | 'time'; message: string };

/** Dubai wall-clock, as the Date's UTC fields. Dubai is +04:00 all year. */
function dubai(at: Date): Date {
  return new Date(at.getTime() + TIMEZONE_UTC_OFFSET_HOURS * 3_600_000);
}

function dubaiDayKey(at: Date): string {
  const d = dubai(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function dubaiClock(at: Date): string {
  const d = dubai(at);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * A minute of slack, so a save that left the browser at 15:59:59.8 is not
 * refused by a server whose clock is a second ahead. Anything older than that
 * is a real mistake, and saying which field is wrong is the whole point.
 */
const SKEW_MS = 60_000;

/**
 * Is this plan in the past, and if so which field says so?
 *
 * The day and the time are two different mistakes and they get two different
 * sentences, word for word as `design/web/calendar.html` writes them.
 */
export function pastProblem(startsAt: Date, now: Date = new Date()): FieldProblem | null {
  if (Number.isNaN(startsAt.getTime())) {
    return { field: 'day', message: 'Choose a day.' };
  }
  if (dubaiDayKey(startsAt) < dubaiDayKey(now)) {
    return { field: 'day', message: 'This day is in the past. Pick today or later.' };
  }
  if (startsAt.getTime() < now.getTime() - SKEW_MS) {
    return { field: 'time', message: `This time has passed. It is ${dubaiClock(now)} now.` };
  }
  return null;
}

/**
 * How many Dubai days an all-day plan covers.
 *
 * `ends_at` on an all-day plan is the **exclusive** end — midnight after the
 * last day — so that the calendar's own `starts_at < to AND ends_at > from`
 * window returns it on every day it covers. One place says so; the calendar
 * and the month band both read it from here.
 */
export function spanDays(startsAt: Date, endsAt: Date): number {
  const ms = endsAt.getTime() - startsAt.getTime();
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

/* ── reading one plan ──────────────────────────────────────────────────── */

export type PlanRow = {
  id: string;
  user_id: string;
  opportunity_id: string | null;
  contact_id: string | null;
  kind: PlanKind;
  title: string | null;
  starts_at: string;
  ends_at: string;
  all_day: number;
  place: string | null;
  result: PlanResult | null;
  receipt_path: string | null;
  receipt_name: string | null;
  receipt_type: string | null;
  receipt_bytes: number | null;
};

const PLAN_COLUMNS = `id, user_id, opportunity_id, contact_id, kind, title, starts_at, ends_at,
                      all_day, place, result, receipt_path, receipt_name, receipt_type, receipt_bytes`;

/**
 * The plan, if this user may touch it.
 *
 * An agent may only act on their own; a manager and above may act on anyone's,
 * which is the same fence the result endpoint has always used.
 */
export async function planFor(
  user: { id: string; role: Role },
  id: string,
  exec: Executor = getPool(),
): Promise<PlanRow> {
  const plan = await queryOne<PlanRow>(
    `SELECT ${PLAN_COLUMNS} FROM meetings WHERE id = ? AND deleted_at IS NULL`,
    [id],
    exec,
  );
  if (!plan) throw notFound('That plan is no longer there.');
  if (plan.user_id !== user.id && user.role === 'agent') {
    throw forbidden('That is somebody else’s plan.');
  }
  return plan;
}

/* ── making one ────────────────────────────────────────────────────────── */

export type NewPlan = {
  opportunityId?: string | null;
  contactId?: string | null;
  kind: PlanKind;
  title?: string | null;
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  place?: string | null;
  reminderMinutes?: number | null;
};

export async function createPlan(
  actor: AuditActor,
  user: { id: string; role: Role },
  input: NewPlan,
  now: Date = new Date(),
): Promise<string> {
  const starts = new Date(input.startsAt);
  const ends = new Date(input.endsAt);
  assertWindow(starts, ends, Boolean(input.allDay), now);

  if (needsLead(input.kind) && !input.opportunityId) {
    throw badRequest('Choose a lead from the list.', { field: 'lead' });
  }

  const id = newId();
  await execute(
    `INSERT INTO meetings
       (id, opportunity_id, contact_id, user_id, kind, title, starts_at, ends_at,
        all_day, place, reminder_minutes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.opportunityId ?? null, input.contactId ?? null, user.id, input.kind,
      input.title ?? null, starts, ends, input.allDay ? 1 : 0,
      input.place ?? null, input.reminderMinutes ?? null, user.id,
    ],
  );
  await writeAudit({
    actor, action: 'meeting.added', entityType: 'meeting', entityId: id, after: input,
  });
  return id;
}

/** Shared by create and by "Change day or time", so they cannot disagree. */
function assertWindow(starts: Date, ends: Date, allDay: boolean, now: Date): void {
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
    throw badRequest('Choose a day.', { field: 'day' });
  }
  if (ends.getTime() <= starts.getTime()) {
    throw badRequest('It has to finish after it starts.', { field: 'time' });
  }
  const problem = pastProblem(starts, now);
  if (problem) throw badRequest(problem.message, { field: problem.field });
  if (allDay && spanDays(starts, ends) > MAX_SPAN_DAYS) {
    throw badRequest(`A plan can run over at most ${MAX_SPAN_DAYS} days.`, { field: 'day' });
  }
}

/* ── changing the day or the time ──────────────────────────────────────── */

/**
 * "Change day or time", and the same move behind the "Moved it" result.
 *
 * The reminder moves with it, which is what `reminder_sent_at` being cleared
 * means elsewhere in the CRM; `meetings` has no such column, so there is
 * nothing to clear — the reminder is computed from `starts_at`.
 */
export async function movePlan(
  actor: AuditActor,
  user: { id: string; role: Role },
  id: string,
  to: { startsAt: string; endsAt: string },
  now: Date = new Date(),
  exec: Executor = getPool(),
): Promise<void> {
  const plan = await planFor(user, id, exec);
  const starts = new Date(to.startsAt);
  const ends = new Date(to.endsAt);
  assertWindow(starts, ends, plan.all_day === 1, now);

  await execute(
    'UPDATE meetings SET starts_at = ?, ends_at = ? WHERE id = ?',
    [starts, ends, id],
    exec,
  );
  await writeAudit({
    actor,
    action: 'meeting.moved',
    entityType: 'meeting',
    entityId: id,
    before: { startsAt: plan.starts_at, endsAt: plan.ends_at },
    after: { startsAt: starts.toISOString(), endsAt: ends.toISOString() },
  }, exec);
}

/* ── taking one out of the diary ───────────────────────────────────────── */

/**
 * Delete a plan.
 *
 * Soft, because the lead's history should still say a viewing was planned and
 * then dropped — `meetings.deleted_at` has existed since 0036 and nothing has
 * ever written to it. The screen asks twice before it gets here.
 */
export async function deletePlan(
  actor: AuditActor,
  user: { id: string; role: Role },
  id: string,
): Promise<void> {
  const plan = await planFor(user, id);
  await execute('UPDATE meetings SET deleted_at = NOW(3) WHERE id = ? AND deleted_at IS NULL', [id]);
  await writeAudit({
    actor,
    action: 'meeting.deleted',
    entityType: 'meeting',
    entityId: id,
    before: {
      kind: plan.kind, title: plan.title, startsAt: plan.starts_at, opportunityId: plan.opportunity_id,
    },
  });
}

/* ── how it went ───────────────────────────────────────────────────────── */

export type NextPlan = {
  kind: PlanKind;
  title?: string | null;
  startsAt: string;
  endsAt: string;
  place?: string | null;
};

export type ResultInput = {
  result: PlanResult;
  note?: string | null;
  interest?: 'hot' | 'warm' | 'cold' | null;
  /** Who asked: "Moved it" and "Cancelled" both need an answer. */
  by?: AskedBy | null;
  /** Where "Moved it" moves it to. */
  movedTo?: { startsAt: string; endsAt: string } | null;
  /** The next thing in the diary. Required after "They came". */
  next?: NextPlan | null;
  /** What they booked. Required after "They booked". */
  booked?: { project?: string | null; unit: string; priceAed: number; paidAed: number } | null;
};

export type ResultSaved = {
  saved: true;
  /** The plan the next step created, if there is one. */
  nextPlanId: string | null;
  /** Whether the lead really moved to Won. False when there is no lead. */
  leadMoved: boolean;
  /** Why it did not move, in words an agent can act on. */
  leadNote: string | null;
};

/**
 * Save what happened, and do the thing the answer implies.
 *
 * Each of the five answers asks for something different, and each of those
 * somethings is checked here rather than only in the browser — a result that
 * threw half of itself away is exactly the fault this replaces.
 */
export async function savePlanResult(
  actor: AuditActor,
  user: { id: string; role: Role },
  id: string,
  input: ResultInput,
  now: Date = new Date(),
): Promise<ResultSaved> {
  const plan = await planFor(user, id);

  if (input.result === 'showed') {
    if (!input.interest) throw badRequest('Choose Hot, Warm or Cold.', { field: 'interest' });
    if (!input.next) throw badRequest('Choose the next step.', { field: 'next' });
  }
  if (input.result === 'rescheduled') {
    if (!input.movedTo) throw badRequest('Choose the new day and time.', { field: 'movedTo' });
    if (!input.by) throw badRequest('Choose who asked.', { field: 'by' });
  }
  if (input.result === 'cancelled' && !input.by) {
    throw badRequest('Choose who cancelled.', { field: 'by' });
  }
  if (input.result === 'booked') {
    const booked = input.booked;
    if (!booked || !booked.unit.trim()) throw badRequest('Write the unit.', { field: 'unit' });
    if (!(booked.priceAed > 0)) throw badRequest('Write the price.', { field: 'price' });
    if (booked.paidAed > booked.priceAed) {
      throw badRequest('Paid now cannot be more than the price.', { field: 'paid' });
    }
    if (!plan.receipt_path) {
      throw badRequest('Upload the booking form or the receipt.', { field: 'receipt' });
    }
  }

  /* The next step and the new time are both plans in the diary, so they obey
     the same past rule as anything else put there by hand. */
  if (input.next) assertWindow(new Date(input.next.startsAt), new Date(input.next.endsAt), false, now);
  if (input.movedTo) {
    assertWindow(new Date(input.movedTo.startsAt), new Date(input.movedTo.endsAt), plan.all_day === 1, now);
  }

  let nextPlanId: string | null = null;

  await withRetryingTransaction(async (tx) => {
    if (input.result === 'rescheduled' && input.movedTo) {
      /*
       * A moved plan is not a finished plan. The design moves it and leaves it
       * open — the meeting still has to happen, at a different hour — so the
       * result column stays NULL and only "who asked" and the audit entry
       * record that it was ever moved.
       */
      await execute(
        `UPDATE meetings
            SET starts_at = ?, ends_at = ?, result = NULL, result_note = ?,
                result_by = ?, result_at = NULL
          WHERE id = ?`,
        [
          new Date(input.movedTo.startsAt), new Date(input.movedTo.endsAt),
          input.note ?? null, input.by ?? null, id,
        ],
        tx,
      );
    } else {
      await execute(
        `UPDATE meetings
            SET result = ?, result_note = ?, interest = ?, result_by = ?, result_at = NOW(3),
                booked_project = ?, booked_unit = ?, booked_price_aed = ?, booked_paid_aed = ?
          WHERE id = ?`,
        [
          input.result, input.note ?? null, input.interest ?? null, input.by ?? null,
          input.booked?.project?.trim() || null,
          input.booked?.unit.trim() ?? null,
          input.booked?.priceAed ?? null,
          input.booked?.paidAed ?? null,
          id,
        ],
        tx,
      );
    }

    if (input.next) {
      nextPlanId = newId();
      await execute(
        `INSERT INTO meetings
           (id, opportunity_id, contact_id, user_id, kind, title, starts_at, ends_at, place, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nextPlanId, plan.opportunity_id, plan.contact_id, plan.user_id, input.next.kind,
          input.next.title ?? null, new Date(input.next.startsAt), new Date(input.next.endsAt),
          input.next.place ?? null, user.id,
        ],
        tx,
      );
    }
  });

  await writeAudit({
    actor,
    action: input.result === 'rescheduled' ? 'meeting.moved' : 'meeting.result',
    entityType: 'meeting',
    entityId: id,
    before: { result: plan.result, startsAt: plan.starts_at },
    after: { ...input, nextPlanId },
  });

  /*
   * "They booked" is the one answer that changes something outside the diary.
   * It is done after the result is safely stored, and a lead that cannot be
   * moved — it belongs to someone else, or it is already closed — does not
   * throw the agent's answer away. They are told instead.
   */
  let leadMoved = false;
  let leadNote: string | null = null;
  if (input.result === 'booked') {
    if (!plan.opportunity_id) {
      leadNote = 'This plan has no lead, so nothing moved to Won.';
    } else {
      try {
        await moveStage({
          opportunityId: plan.opportunity_id,
          to: 'won',
          subStatus: 'reserved',
          actor: { ...actor, role: actor.role ?? user.role },
          actingUserId: actor.userId,
        });
        leadMoved = true;
      } catch (err) {
        leadNote = err instanceof Error ? err.message : 'The lead did not move to Won.';
        logger.warn('booked meeting did not move the lead', {
          meetingId: id, opportunityId: plan.opportunity_id, ...errorContext(err),
        });
      }
    }
  }

  return { saved: true, nextPlanId, leadMoved, leadNote };
}

/* ── the booking form or the receipt ───────────────────────────────────── */

/** Photos, because it is a phone in a sales centre, and PDF for a real form. */
export const RECEIPT_TYPES = Object.keys(IMAGE_TYPES);

export type Receipt = {
  name: string;
  contentType: string;
  bytes: number;
};

function receiptDir(): string {
  return uploadDir('meetings');
}

export async function saveReceipt(
  actor: AuditActor,
  user: { id: string; role: Role },
  id: string,
  file: { filename: string; contentType: string; body: Buffer },
): Promise<Receipt> {
  const plan = await planFor(user, id);

  const extension = extensionFor(file.contentType, IMAGE_TYPES);
  if (!extension) {
    throw badRequest(
      `${file.contentType || 'That file'} cannot be attached. Photos (JPEG, PNG, WebP, GIF) and PDF only.`,
    );
  }
  const limit = env().MAX_ATTACHMENT_MB * 1024 * 1024;
  if (file.body.length === 0) throw badRequest('That file is empty.');
  if (file.body.length > limit) {
    throw badRequest(`That file is larger than the ${env().MAX_ATTACHMENT_MB} MB limit.`);
  }

  const dir = receiptDir();
  await mkdir(dir, { recursive: true });
  /* Named after the row, never after what the uploader called it. */
  const storagePath = path.join(dir, `${id}${extension}`);
  await writeFile(storagePath, file.body);

  const name = file.filename.slice(0, 255);
  await execute(
    `UPDATE meetings
        SET receipt_name = ?, receipt_type = ?, receipt_bytes = ?, receipt_path = ?, receipt_at = NOW(3)
      WHERE id = ?`,
    [name, file.contentType, file.body.length, storagePath, id],
  );

  /* A second upload replaces the first, and the first file goes with it. */
  if (plan.receipt_path && plan.receipt_path !== storagePath && insideUploadDir(plan.receipt_path)) {
    await unlink(plan.receipt_path).catch(() => undefined);
  }

  await writeAudit({
    actor,
    action: 'meeting.receipt_added',
    entityType: 'meeting',
    entityId: id,
    after: { filename: name, bytes: file.body.length },
  });

  return { name, contentType: file.contentType, bytes: file.body.length };
}

/** The stored file, for serving back. Authenticated and fenced through the plan. */
export async function openReceipt(
  user: { id: string; role: Role },
  id: string,
): Promise<{ stream: Readable; name: string; contentType: string; bytes: number; inline: boolean }> {
  const plan = await planFor(user, id);
  if (!plan.receipt_path) throw notFound('There is no booking form on this plan.');
  if (!insideUploadDir(plan.receipt_path)) throw notFound('That file is no longer there.');
  return {
    stream: createReadStream(plan.receipt_path),
    name: plan.receipt_name ?? 'booking-form',
    contentType: plan.receipt_type ?? 'application/octet-stream',
    bytes: Number(plan.receipt_bytes ?? 0),
    inline: isInlineSafe(plan.receipt_type ?? '', IMAGE_TYPES),
  };
}

/* ── what else is in that day, for the clash warning ───────────────────── */

export type Neighbour = {
  id: string;
  title: string | null;
  kind: PlanKind;
  startsAt: string;
  endsAt: string;
};

/**
 * Everything already in one person's day.
 *
 * The clash warning is drawn in the browser from the window it already has,
 * so this exists for the server's own checks and for tests: it is the same
 * question, asked where nobody can argue with the answer.
 */
export async function planClash(
  userId: string,
  window: { startsAt: Date; endsAt: Date },
  skipId: string | null = null,
): Promise<Neighbour | null> {
  const rows = await query<Neighbour>(
    `SELECT id, title, kind, starts_at AS startsAt, ends_at AS endsAt
       FROM meetings
      WHERE user_id = ? AND deleted_at IS NULL AND all_day = 0 AND result IS NULL
        AND starts_at < ? AND ends_at > ?
        AND (? IS NULL OR id <> ?)
      ORDER BY starts_at ASC
      LIMIT 1`,
    [userId, window.endsAt, window.startsAt, skipId, skipId],
  );
  return rows[0] ?? null;
}
