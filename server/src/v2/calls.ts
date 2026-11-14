import { execute, query, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { runLeadAction } from '../leads/actions.js';
import { saveCallResult, savedWords, type NoAnswerState } from './call-results.js';
import { visibleUserIds, ownerPredicate } from '../auth/scope.js';
import type { SessionUser } from '../auth/sessions.js';
import { TABS } from '../leads/tabs.js';
import { DAY_END, DAY_START } from './dubai.js';

/**
 * Calling, one lead at a time.
 *
 * Two things are recorded and they are not the same thing. A **call** is a
 * tap on the Call button: the CRM cannot know whether the phone rang, so it
 * records that the agent started a call and then asks what happened. A **tap**
 * is the same for WhatsApp and Telegram, and it is deliberately never written
 * down as "sent" — the agent presses send in the real app, and claiming
 * otherwise is the one thing the design research says would lose the agents'
 * trust in the figures (pages.md, global rules).
 *
 * The outcome is where the work happens, and since 14 November it does not
 * happen here: `finishCall` hands it to `saveCallResult` in
 * `v2/call-results.ts`, which counts the try, works out the next one from the
 * owner's own numbers, moves the stage, writes the activity and the audit
 * entry. There is one path, not two -- and until that change there were two,
 * with two different follow-up times for the same tap. See
 * `docs/v2/no-answer-rule.md`.
 */

export const CALL_OUTCOMES = [
  'interested', 'no_answer', 'busy', 'call_back', 'wrong_number', 'not_interested',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/*
 * What an outcome means for the lead, and when the next try is, both now live
 * in `v2/call-results.ts` — see `finishCall` below. There was a table here
 * mapping each outcome to a lead action, and another giving a no-answer two
 * hours and a busy line one, and they were the second answer to a question
 * the no-answer rule now answers: the ladder the owner set in Automations,
 * inside the client's waking hours and ours.
 */

export interface QueueLead {
  id: string;
  contactId: string;
  name: string | null;
  phone: string | null;
  project: string | null;
  unitType: string | null;
  budgetMinAed: number | null;
  budgetMaxAed: number | null;
  language: string | null;
  stage: string;
  score: number | null;
  scoreReason: string | null;
  isVip: boolean;
  nextStepAt: Date | null;
  nextStepNote: string | null;
  lastContactAt: Date | null;
  noAnswerCount: number;
  /** Already called today, so the queue can show it done rather than drop it. */
  calledToday: boolean;
}

/**
 * The day's queue: everything promised for today, VIP first.
 *
 * The same rows as the Today tab, in a different order, from the same clause —
 * so "Start calling · 12 ready" and the list behind it can never be different
 * numbers.
 */
export async function callQueue(user: SessionUser): Promise<QueueLead[]> {
  const visible = await visibleUserIds(user);
  const scope = ownerPredicate('o.owner_user_id', visible);

  const rows = await query<Record<string, unknown>>(
    `SELECT o.id, o.contact_id AS contactId, c.full_name AS name, c.phone_e164 AS phone,
            o.project_name AS project, o.unit_type AS unitType,
            o.budget_min_aed AS budgetMinAed, o.budget_max_aed AS budgetMaxAed,
            c.language, o.stage_key AS stage, o.lead_score AS score,
            o.score_reason AS scoreReason, o.is_vip AS isVip,
            o.next_step_at AS nextStepAt, o.next_step_note AS nextStepNote,
            o.last_contact_at AS lastContactAt, o.no_answer_count AS noAnswerCount,
            EXISTS (SELECT 1 FROM call_logs cl
                     WHERE cl.opportunity_id = o.id AND cl.user_id = ?
                       AND cl.started_at >= ${DAY_START} AND cl.started_at < ${DAY_END}
                   ) AS calledToday
       FROM opportunities o
       JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
      WHERE ${scope.sql} AND ${TABS.today.where}
      ORDER BY o.is_vip DESC, o.next_step_at ASC, o.id ASC
      LIMIT 200`,
    [user.id, ...scope.params],
  );

  return rows.map((r) => ({
    id: String(r.id),
    contactId: String(r.contactId),
    name: (r.name as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    project: (r.project as string | null) ?? null,
    unitType: (r.unitType as string | null) ?? null,
    budgetMinAed: r.budgetMinAed === null ? null : Number(r.budgetMinAed),
    budgetMaxAed: r.budgetMaxAed === null ? null : Number(r.budgetMaxAed),
    language: (r.language as string | null) ?? null,
    stage: String(r.stage),
    score: r.score === null ? null : Number(r.score),
    scoreReason: (r.scoreReason as string | null) ?? null,
    isVip: Number(r.isVip ?? 0) === 1,
    nextStepAt: (r.nextStepAt as Date | null) ?? null,
    nextStepNote: (r.nextStepNote as string | null) ?? null,
    lastContactAt: (r.lastContactAt as Date | null) ?? null,
    noAnswerCount: Number(r.noAnswerCount ?? 0),
    calledToday: Number(r.calledToday ?? 0) === 1,
  }));
}

/** The lead must be one this person may act on. */
async function mine(user: SessionUser, opportunityId: string): Promise<{ contactId: string }> {
  const visible = await visibleUserIds(user);
  const scope = ownerPredicate('o.owner_user_id', visible);
  const row = await queryOne<{ contact_id: string }>(
    `SELECT o.contact_id FROM opportunities o
      WHERE o.id = ? AND o.deleted_at IS NULL AND ${scope.sql}`,
    [opportunityId, ...scope.params],
  );
  if (!row) throw notFound('That lead is not one of yours.');
  return { contactId: row.contact_id };
}

export async function startCall(
  actor: AuditActor,
  user: SessionUser,
  input: { opportunityId: string; source?: 'lead' | 'dialler' | 'followup' | 'incoming' | 'other'; notCheckedIn?: boolean },
): Promise<{ id: string }> {
  const { contactId } = await mine(user, input.opportunityId);
  const id = newId();

  await execute(
    `INSERT INTO call_logs (id, opportunity_id, contact_id, user_id, source, not_checked_in)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.opportunityId, contactId, user.id, input.source ?? 'dialler', input.notCheckedIn ? 1 : 0],
  );

  /*
   * A call started outside check-in is audited at the moment it happens, not
   * when the outcome arrives -- an agent who never comes back to say what
   * happened is exactly the case an owner wants to see.
   */
  if (input.notCheckedIn) {
    await writeAudit({
      actor,
      action: 'call.not_checked_in',
      entityType: 'opportunity',
      entityId: input.opportunityId,
      after: { callId: id },
    });
  }

  return { id };
}

export interface OutcomeInput {
  outcome: CallOutcome;
  note?: string | null;
  /** For `call_back`: when. For the rest the next try is the ladder's. */
  callBackAt?: string | null;
  /** For `not_interested` and `wrong_number`. */
  reason?: string | null;
}

/**
 * What happened on the call. This is also what moves the lead.
 *
 * It does none of that itself any more. Everything a call result means —
 * counting the try, the ladder, the waking-hours rule, the WhatsApp words,
 * the audit row and the undo — lives in `v2/call-results.ts`, and this hands
 * the dialler's answer straight to it.
 *
 * Why it was changed rather than left alone: until 14 November this function
 * had its own schedule, two hours for a no-answer and one for a busy, written
 * before the no-answer rule existed. So the same tap gave a different
 * follow-up time depending on which screen it was pressed on, and the
 * Automations numbers the owner had just been given changed one of them and
 * not the other. Moving the dialler's screen to the new endpoint instead
 * would have left this path alive for the next person to find — which is
 * exactly how `PATCH /api/v2/taps/:id` sat unused for months while every
 * WhatsApp went unanswered.
 *
 * The answer keeps its old shape, because the screen reads `said` out of it.
 * It now also carries the whole no-answer state, so the dialler can draw
 * "try 2 of 5 · next try tomorrow 11:00" without a second request.
 */
export async function finishCall(
  actor: AuditActor,
  user: SessionUser,
  callId: string,
  input: OutcomeInput,
): Promise<{
  stageKey: string | null; status: string; nextStepAt: Date | null; said: string;
  noAnswer: NoAnswerState;
}> {
  const call = await queryOne<{
    id: string; opportunity_id: string | null; user_id: string; outcome: string | null;
  }>(
    'SELECT id, opportunity_id, user_id, outcome FROM call_logs WHERE id = ?',
    [callId],
  );
  if (!call) throw notFound('That call is not there.');
  if (call.user_id !== user.id) throw forbidden('That call was somebody else’s.');
  if (!call.opportunity_id) throw badRequest('That call is not attached to a lead.');

  /* `callId` is passed, so the outcome is written onto this very row. One
     call, one record -- never a second one beside it. */
  const state = await saveCallResult(actor, user, call.opportunity_id, {
    result: input.outcome,
    note: input.note ?? null,
    callBackAt: input.callBackAt ?? null,
    reason: input.reason ?? null,
    callId,
  });

  /* Read back rather than guessed at: `saveCallResult` may have moved the
     stage, closed the lead, or cleared a promise that belonged to the run. */
  const lead = await queryOne<{ stage_key: string; status: string; next_step_at: Date | null }>(
    'SELECT stage_key, status, next_step_at FROM opportunities WHERE id = ?',
    [call.opportunity_id],
  );

  return {
    stageKey: lead?.stage_key ?? null,
    status: lead?.status ?? 'open',
    nextStepAt: lead?.next_step_at ?? null,
    said: savedWords(input.outcome, state),
    noAnswer: state,
  };
}

/* ── WhatsApp and Telegram taps ────────────────────────────────────────── */

export const TAP_RESULTS = [
  'sent', 'replied', 'no_reply', 'wrong_number', 'changed_mind', 'not_sent',
] as const;
export type TapResult = (typeof TAP_RESULTS)[number];

export async function logTap(
  user: SessionUser,
  input: { opportunityId: string; app: 'whatsapp' | 'telegram'; templateKey?: string | null; text?: string | null },
): Promise<{ id: string }> {
  const { contactId } = await mine(user, input.opportunityId);
  const id = newId();
  await execute(
    `INSERT INTO message_taps
       (id, opportunity_id, contact_id, user_id, app, template_key, message_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.opportunityId, contactId, user.id, input.app,
      input.templateKey ?? null, input.text ?? null],
  );
  return { id };
}

/**
 * "What happened?" — the answer to a tap.
 *
 * Only `replied` moves the lead on, because only a reply is evidence that
 * anything reached the client. `sent` means the agent believes they sent it,
 * which is worth recording and is not worth a stage change.
 */
export async function answerTap(
  actor: AuditActor,
  user: SessionUser,
  tapId: string,
  input: { result: TapResult; note?: string | null },
): Promise<{ moved: boolean }> {
  const tap = await queryOne<{ id: string; opportunity_id: string | null; user_id: string }>(
    'SELECT id, opportunity_id, user_id FROM message_taps WHERE id = ?',
    [tapId],
  );
  if (!tap) throw notFound('That message is not there.');
  if (tap.user_id !== user.id) throw forbidden('That message was somebody else’s.');

  await execute(
    'UPDATE message_taps SET result = ?, answered_at = NOW(3), note = ? WHERE id = ?',
    [input.result, input.note ?? null, tapId],
  );

  if (input.result === 'replied' && tap.opportunity_id) {
    await runLeadAction(actor, {
      opportunityId: tap.opportunity_id,
      action: 'whatsapp',
      note: input.note ?? 'Replied on WhatsApp',
      nextStep: null,
    });
    return { moved: true };
  }

  if (input.result === 'wrong_number' && tap.opportunity_id) {
    await runLeadAction(actor, {
      opportunityId: tap.opportunity_id,
      action: 'problem',
      reason: 'wrong_number',
      note: input.note ?? null,
      nextStep: null,
    });
    return { moved: true };
  }

  return { moved: false };
}
