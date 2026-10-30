/**
 * The nine buttons an agent presses all day.
 *
 * Each one does three things at once, and all three matter: it records what
 * happened, it moves the lead, and it decides what is owed next. Doing only
 * the first is how a CRM becomes a diary nobody reads — the timeline fills up
 * and the list of who to call stays empty.
 *
 * Every action also counts as touching the lead, which is what stops the
 * five-minute clock. An agent who rings a client and books a viewing has not
 * failed because they skipped a button labelled Accept.
 */
import { randomUUID } from 'node:crypto';
import { execute, queryOne, withRetryingTransaction } from '../db/client.js';
import { addActivity } from '../ingestion/ingest.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { recordFirstAction } from '../routing/assignments.js';
import { logger, errorContext } from '../lib/logger.js';

export const LEAD_ACTIONS = [
  'call', 'whatsapp', 'no_answer', 'call_back', 'interested', 'meeting', 'problem', 'lost', 'won',
] as const;
export type LeadAction = (typeof LEAD_ACTIONS)[number];

export const PROBLEM_REASONS = [
  'wrong_number', 'not_reachable', 'budget_too_low', 'not_decision_maker', 'other',
] as const;
export const LOST_REASONS = [
  'bought_elsewhere', 'budget_too_low', 'just_browsing', 'not_reachable', 'changed_plans', 'other',
] as const;

export type NextStepType = 'call' | 'whatsapp' | 'email' | 'meeting' | 'viewing' | 'other';

export interface ActionInput {
  opportunityId: string;
  action: LeadAction;
  /** Required for problem and lost — the business rule, enforced here. */
  reason?: string | null;
  note?: string | null;
  /** The agent's answer to "what's next?", when they gave one. */
  nextStep?: { type: NextStepType; at: string; note?: string | null } | null;
  /** Meeting and viewing carry a time and a place. */
  meetingAt?: string | null;
  meetingKind?: string | null;
  meetingWhere?: string | null;
  /** Won carries what was actually sold. */
  wonProject?: string | null;
  wonUnit?: string | null;
}

export interface ActionResult {
  stageKey: string | null;
  status: 'open' | 'won' | 'lost';
  nextStepAt: string | null;
  /** True when the lead is open and nothing is promised — the UI then asks. */
  needsNextStep: boolean;
  /** What happened, in the words the toast should use. */
  said: string;
}

/** What each action does to the stage. `null` leaves it where it is. */
const MOVES: Record<LeadAction, { stage: string | null; sub?: string; status?: 'won' | 'lost' }> = {
  call: { stage: null },
  whatsapp: { stage: null },
  /* A no-answer is an attempt, and an attempt is progress — a lead sitting at
     New after four rings is a lead the board is lying about. */
  no_answer: { stage: 'attempted_contact', sub: 'no_answer' },
  call_back: { stage: 'attempted_contact' },
  interested: { stage: 'engaged_qualified', sub: 'engaged' },
  meeting: { stage: 'appointment_scheduled', sub: 'booked' },
  problem: { stage: 'attempted_contact', sub: 'wrong_number' },
  lost: { stage: 'lost', status: 'lost' },
  won: { stage: 'won', status: 'won' },
};

/** Which actions are a real outbound touch, for `last_contact_at`. */
const REACHED_OUT = new Set<LeadAction>(['call', 'whatsapp', 'no_answer', 'meeting', 'interested']);

/**
 * Decide the next step when the agent did not choose one.
 *
 * Only two actions get an automatic answer, and both because the right answer
 * is obvious and waiting for a person to type it loses it. Everything else
 * deliberately leaves the lead in "No next step", where it is visible, rather
 * than inventing a promise nobody made.
 */
export function defaultNextStep(
  action: LeadAction,
  noAnswerCount: number,
  now: Date = new Date(),
): { type: NextStepType; at: Date; note: string } | null {
  if (action === 'no_answer') {
    /*
     * Two hours, backing off as the attempts pile up. Ringing the same number
     * every two hours all day is how a brokerage gets blocked.
     */
    const backoff = noAnswerCount <= 1 ? 2 : noAnswerCount === 2 ? 4 : 24;
    return {
      type: noAnswerCount >= 3 ? 'whatsapp' : 'call',
      at: new Date(now.getTime() + backoff * 60 * 60 * 1000),
      note: noAnswerCount >= 3 ? 'Try WhatsApp — three calls unanswered' : 'Call again',
    };
  }
  return null;
}

export async function runLeadAction(
  actor: AuditActor,
  input: ActionInput,
): Promise<ActionResult> {
  if ((input.action === 'problem' || input.action === 'lost') && !input.reason) {
    throw Object.assign(new Error('A reason is required'), { status: 400 });
  }

  const before = await queryOne<{
    id: string; contact_id: string; stage_key: string; status: string;
    owner_user_id: string | null; no_answer_count: number; next_step_at: Date | null;
    assigned_at: Date | null; first_touch_at: Date | null;
  }>(
    `SELECT id, contact_id, stage_key, status, owner_user_id, no_answer_count, next_step_at,
            assigned_at, first_touch_at
       FROM opportunities WHERE id = ? AND deleted_at IS NULL`,
    [input.opportunityId],
  );
  if (!before) throw Object.assign(new Error('That lead no longer exists'), { status: 404 });

  const move = MOVES[input.action];
  const noAnswerCount = input.action === 'no_answer' ? before.no_answer_count + 1 : before.no_answer_count;

  const chosen = input.nextStep
    ? {
      type: input.nextStep.type,
      at: new Date(input.nextStep.at),
      note: input.nextStep.note ?? null,
    }
    : defaultNextStep(input.action, noAnswerCount);

  /* Closing a lead clears what was promised: a Lost lead owing a call back
     would sit in the follow-up tab forever. */
  const closing = move.status === 'won' || move.status === 'lost';

  await withRetryingTransaction(async (tx) => {
    const sets: string[] = [];
    const args: Array<string | number | Date | null> = [];

    if (move.stage) {
      sets.push('stage_key = ?', 'stage_changed_at = NOW(3)');
      args.push(move.stage);
      if (move.sub) {
        sets.push('sub_status = ?');
        args.push(move.sub);
      }
    }
    if (move.status) {
      sets.push('status = ?', 'closed_at = NOW(3)');
      args.push(move.status);
    }
    if (input.action === 'lost') {
      sets.push('lost_reason = ?');
      args.push(input.reason ?? 'not_interested');
      if (input.note) {
        sets.push('lost_note = ?');
        args.push(input.note.slice(0, 500));
      }
    }
    if (input.action === 'no_answer') {
      sets.push('no_answer_count = ?');
      args.push(noAnswerCount);
    }
    if (REACHED_OUT.has(input.action)) {
      sets.push('last_contact_at = NOW(3)');
      /* The first real touch is what the speed-to-lead figure measures. */
      if (!before.first_touch_at) sets.push('first_touch_at = NOW(3)');
    }
    if (input.action === 'won') {
      if (input.wonProject) {
        sets.push('project_name = COALESCE(project_name, ?)');
        args.push(input.wonProject);
      }
    }

    if (closing) {
      sets.push('next_step_at = NULL', 'next_step_type = NULL', 'next_step_note = NULL');
    } else if (chosen) {
      sets.push('next_step_type = ?', 'next_step_at = ?', 'next_step_note = ?');
      args.push(chosen.type, chosen.at, chosen.note?.slice(0, 255) ?? null);
    }

    if (sets.length > 0) {
      await execute(
        `UPDATE opportunities SET ${sets.join(', ')} WHERE id = ?`,
        [...args, input.opportunityId],
        tx,
      );
    }

    await addActivity(tx, {
      contactId: before.contact_id,
      opportunityId: input.opportunityId,
      userId: actor.userId,
      type: ACTIVITY_TYPE[input.action],
      title: TITLE[input.action](input),
      body: input.note ?? null,
      meta: {
        action: input.action,
        reason: input.reason ?? null,
        ...(input.meetingAt ? { meetingAt: input.meetingAt, kind: input.meetingKind, where: input.meetingWhere } : {}),
        ...(chosen ? { nextStepAt: chosen.at.toISOString(), nextStepType: chosen.type } : {}),
      },
    });

    /* A meeting is a commitment with a time on it, so it becomes a task as
       well as an activity — the calendar is where an agent looks for it. */
    if (input.action === 'meeting' && input.meetingAt) {
      await execute(
        `INSERT INTO tasks (id, contact_id, opportunity_id, assigned_user_id, type, title, due_at, created_by_user_id)
         VALUES (?, ?, ?, ?, 'meeting', ?, ?, ?)`,
        [
          randomUUID(),
          before.contact_id,
          input.opportunityId,
          before.owner_user_id,
          [input.meetingKind ?? 'Meeting', input.meetingWhere].filter(Boolean).join(' · ').slice(0, 200),
          new Date(input.meetingAt),
          actor.userId,
        ],
        tx,
      );
    }

    await writeAudit(
      {
        actor,
        action: `lead.${input.action}`,
        entityType: 'opportunity',
        entityId: input.opportunityId,
        before: { stageKey: before.stage_key, status: before.status },
        after: {
          stageKey: move.stage ?? before.stage_key,
          status: move.status ?? before.status,
          reason: input.reason ?? null,
        },
      },
      tx,
    );
  });

  /*
   * Pressing any of these is doing the work, so the clock stops. Done after
   * the transaction because it reaches into the assignment record, and a
   * failure there must not undo the thing the agent actually did.
   */
  if (!before.first_touch_at && before.owner_user_id) {
    await recordFirstAction({
      opportunityId: input.opportunityId,
      agentUserId: before.owner_user_id,
      at: new Date(),
      assignedAt: before.assigned_at,
    }).catch((err: unknown) => logger.warn('could not record the first action', errorContext(err)));
  }

  /*
   * Points and the wall, after the transaction has committed. Never allowed
   * to fail the action: an agent whose Won button errors because the wall had
   * a bad day is an agent who stops pressing Won.
   */
  void recordAchievement(actor, input.action, before.id, before.owner_user_id)
    .catch((err: unknown) => logger.warn('could not record points for an action', errorContext(err)));

  const nextStepAt = closing ? null : (chosen?.at.toISOString() ?? before.next_step_at?.toISOString() ?? null);

  return {
    stageKey: move.stage ?? before.stage_key,
    status: (move.status ?? 'open') as 'open' | 'won' | 'lost',
    nextStepAt,
    /* The prompt that keeps the No next step tab empty. */
    needsNextStep: !closing && !nextStepAt,
    said: SAID[input.action](input),
  };
}

const ACTIVITY_TYPE: Record<LeadAction, string> = {
  call: 'call',
  whatsapp: 'whatsapp',
  no_answer: 'no_answer',
  call_back: 'callback_set',
  interested: 'stage_change',
  meeting: 'meeting_set',
  problem: 'problem',
  lost: 'lost',
  won: 'won',
};

const TITLE: Record<LeadAction, (input: ActionInput) => string> = {
  call: () => 'Called',
  whatsapp: () => 'WhatsApp sent',
  no_answer: () => 'No answer',
  call_back: () => 'Call back scheduled',
  interested: () => 'Interested',
  meeting: (input) => `${input.meetingKind ?? 'Meeting'} booked`,
  problem: (input) => `Problem — ${human(input.reason)}`,
  lost: (input) => `Lost — ${human(input.reason)}`,
  won: (input) => `Won${input.wonUnit ? ` — unit ${input.wonUnit}` : ''}`,
};

/** What the toast says. Short, and in the agent's own words. */
const SAID: Record<LeadAction, (input: ActionInput) => string> = {
  call: () => 'Call logged',
  whatsapp: () => 'WhatsApp logged',
  no_answer: () => 'No answer logged',
  call_back: () => 'Call back set',
  interested: () => 'Moved to Interested 🔥',
  meeting: () => 'Meeting booked 📅',
  problem: () => 'Flagged as a problem',
  lost: () => 'Marked Lost',
  won: () => 'Deal won! 🏆',
};

function human(value: string | null | undefined): string {
  if (!value) return 'no reason given';
  return value.replace(/_/g, ' ');
}

/**
 * What an action is worth, and what the wall should say about it.
 *
 * Nothing here pays for logging something. Reaching somebody pays, because
 * the client is a witness; a viewing that happened pays more than one that
 * was booked. A person paid for activity logs activity that did not happen.
 */
async function recordAchievement(
  actor: AuditActor,
  action: LeadAction,
  opportunityId: string,
  ownerId: string | null,
): Promise<void> {
  const userId = ownerId ?? actor.userId;
  if (!userId) return;

  const { awardXp } = await import('../wall/wall.js');

  if (action === 'interested' || action === 'whatsapp') {
    await awardXp({ userId, rule: 'lead_reached', subjectType: 'opportunity', subjectId: opportunityId });
  }
  if (action === 'meeting') {
    await awardXp({ userId, rule: 'meeting_booked', subjectType: 'opportunity', subjectId: opportunityId });
  }
  if (action === 'won') {
    const { postDealWon } = await import('../wall/auto.js');
    await postDealWon(opportunityId);
  }
}
