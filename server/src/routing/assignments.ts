/**
 * Who a lead was given to, whether they picked it up, and what happened next.
 *
 * The CRM assigns a lead the moment it arrives and the client gets a reply
 * inside thirty seconds — none of that changes. What this adds is the part
 * after: the agent has to say "mine", and then actually do something, and if
 * they do neither the lead goes back to the owner instead of going cold on
 * someone's screen.
 *
 * `opportunities` only ever holds the current owner, so the history lives in
 * `lead_assignments`: it is where "Sara answers in 90 seconds, Omar in 40
 * minutes" comes from, and it survives the lead moving on.
 */
import type { PoolConnection } from 'mysql2/promise';
import { execute, query, queryOne, type Executor, getPool } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { addActivity } from '../ingestion/ingest.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { badRequest, notFound } from '../lib/errors.js';

/**
 * What counts as the agent having done something.
 *
 * Deliberately the same list the speed-to-lead check has always used: moving
 * the card, sending a message, leaving a note, editing the contact, finishing
 * a task — or the lead replying, which means the agent reached them somehow
 * even if the CRM never saw how. Opening the lead is not on the list, because
 * looking at a lead is not working it.
 */
const ACTION_TYPES = "('stage.changed','message.outbound','note','contact.updated','task.completed')";

export interface ActedResult {
  acted: boolean;
  /** When the first real action happened, where one can be dated. */
  at: Date | null;
}

export async function hasActed(
  input: { opportunityId: string; contactId: string; since: Date | null },
  exec: Executor = getPool(),
): Promise<ActedResult> {
  const since = input.since ?? new Date(0);
  const [action] = await query<{ at: Date }>(
    `SELECT MIN(created_at) AS at FROM activities
      WHERE opportunity_id = ? AND user_id IS NOT NULL
        AND type IN ${ACTION_TYPES} AND created_at >= ?`,
    [input.opportunityId, since],
    exec,
  );
  const [reply] = await query<{ at: Date }>(
    `SELECT MIN(created_at) AS at FROM messages
      WHERE contact_id = ? AND direction = 'inbound' AND created_at >= ?`,
    [input.contactId, since],
    exec,
  );

  const times = [action?.at, reply?.at].filter((at): at is Date => at instanceof Date);
  if (times.length === 0) return { acted: false, at: null };
  return { acted: true, at: new Date(Math.min(...times.map((t) => t.getTime()))) };
}

/**
 * Note that a lead has been handed to someone.
 *
 * Any row still open for this lead is closed first: a lead is only ever with
 * one agent, and two open rows would double-count both of them in the speed
 * figures.
 */
export async function recordAssignment(
  tx: PoolConnection,
  input: { opportunityId: string; contactId: string; agentUserId: string; assignedByUserId?: string | null },
): Promise<string> {
  await execute(
    `UPDATE lead_assignments SET outcome = 'reassigned'
      WHERE opportunity_id = ? AND outcome = 'working'`,
    [input.opportunityId],
    tx,
  );
  const id = newId();
  await execute(
    `INSERT INTO lead_assignments (id, opportunity_id, contact_id, agent_user_id, assigned_by_user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [id, input.opportunityId, input.contactId, input.agentUserId, input.assignedByUserId ?? null],
    tx,
  );
  return id;
}

/**
 * The agent says the lead is theirs.
 *
 * Accepting is not the same as working it — it starts a second clock for the
 * first action, which is what stops a lead being accepted and then sat on.
 */
export async function acceptLead(
  actor: AuditActor,
  opportunityId: string,
  exec: Executor = getPool(),
): Promise<{ acceptedAt: Date }> {
  const opportunity = await queryOne<{ id: string; owner_user_id: string | null; accepted_at: Date | null; status: string }>(
    'SELECT id, owner_user_id, accepted_at, status FROM opportunities WHERE id = ?',
    [opportunityId],
    exec,
  );
  if (!opportunity) throw notFound('That lead no longer exists.');
  if (opportunity.status !== 'open') throw badRequest('That lead is already closed.');
  /*
   * Only the agent holding it may accept. Checked here and not only in the
   * screen, because the screen is not where the rule lives — and because a
   * lead accepted by the wrong person stops the clock on the right one.
   */
  if (opportunity.owner_user_id !== actor.userId) {
    throw badRequest('That lead is not assigned to you.');
  }
  if (opportunity.accepted_at) return { acceptedAt: opportunity.accepted_at };

  const acceptedAt = new Date();
  await execute('UPDATE opportunities SET accepted_at = ? WHERE id = ?', [acceptedAt, opportunityId], exec);
  await execute(
    `UPDATE lead_assignments SET accepted_at = ?
      WHERE opportunity_id = ? AND agent_user_id = ? AND outcome = 'working' AND accepted_at IS NULL`,
    [acceptedAt, opportunityId, actor.userId],
    exec,
  );
  await writeAudit(
    {
      actor,
      action: 'lead.accepted',
      entityType: 'opportunity',
      entityId: opportunityId,
      after: { acceptedAt: acceptedAt.toISOString() },
    },
    exec,
  );
  logger.info('lead accepted', { opportunityId, agentUserId: actor.userId });
  return { acceptedAt };
}

/** Record how long the agent actually took, once it is known. */
export async function recordFirstAction(
  input: { opportunityId: string; agentUserId: string; at: Date; assignedAt: Date | null },
  exec: Executor = getPool(),
): Promise<void> {
  const seconds = input.assignedAt
    ? Math.max(0, Math.round((input.at.getTime() - input.assignedAt.getTime()) / 1000))
    : null;
  await execute(
    `UPDATE lead_assignments
        SET first_action_at = COALESCE(first_action_at, ?), responded_in_seconds = COALESCE(responded_in_seconds, ?)
      WHERE opportunity_id = ? AND agent_user_id = ? AND outcome = 'working'`,
    [input.at, seconds, input.opportunityId, input.agentUserId],
    exec,
  );
}

/**
 * Take the lead back off the agent and put it in Incoming.
 *
 * The owner is the backstop deliberately: the alternative — passing it quietly
 * to the next agent — is how a lead gets handed round four people in twenty
 * minutes while nobody is actually accountable for it.
 */
export async function bounceLead(
  tx: PoolConnection,
  input: { opportunityId: string; contactId: string; agentUserId: string; agentName: string | null },
): Promise<void> {
  await execute(
    `UPDATE opportunities
        SET owner_user_id = NULL, accepted_at = NULL, sla_breached = 1, bounce_count = bounce_count + 1
      WHERE id = ?`,
    [input.opportunityId],
    tx,
  );
  await execute(
    `UPDATE lead_assignments SET outcome = 'bounced'
      WHERE opportunity_id = ? AND agent_user_id = ? AND outcome = 'working'`,
    [input.opportunityId, input.agentUserId],
    tx,
  );
  const who = input.agentName ?? 'the agent';
  await execute(
    `INSERT INTO unassigned_queue (id, opportunity_id, contact_id, reason)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE reason = VALUES(reason), resolved_at = NULL`,
    [newId(), input.opportunityId, input.contactId, `Bounced from ${who}`.slice(0, 160)],
    tx,
  );
  await addActivity(tx, {
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    type: 'lead.bounced',
    title: `Returned to Incoming — ${who} did not pick it up in time`,
    body: null,
    meta: { previousUserId: input.agentUserId },
  });
}

/**
 * The contact's sticky owner follows the lead back.
 *
 * Without this the contact still points at the agent who let it go, and the
 * next lead from the same person lands straight back on their desk — which is
 * the opposite of what a bounce means.
 */
export async function clearStickyOwner(tx: PoolConnection, contactId: string, agentUserId: string): Promise<void> {
  await execute(
    'UPDATE contacts SET owner_user_id = NULL WHERE id = ? AND owner_user_id = ?',
    [contactId, agentUserId],
    tx,
  );
  await execute(
    'UPDATE conversations SET assigned_user_id = NULL WHERE contact_id = ? AND assigned_user_id = ?',
    [contactId, agentUserId],
    tx,
  );
}

/* ── The decision ─────────────────────────────────────────────────────── */

export type SlaVerdict =
  /** Leave it alone — someone else moved it, or it is no longer ours to judge. */
  | { act: 'ignore'; why: 'closed' | 'owner_changed' | 'accepted_elsewhere' }
  /** The agent did the work; note when, and stop. */
  | { act: 'record'; why: 'acted' }
  /** Nothing happened in time. */
  | { act: 'bounce'; why: 'not_accepted' | 'no_action' };

/**
 * Whether a lead should be taken off the agent holding it.
 *
 * Pure, and separate from the queries around it, because the cost of getting
 * it wrong is asymmetric and invisible. Bounce too eagerly and you pull a lead
 * off an agent who is mid-call with the client. Bounce too late and the lead
 * goes cold while looking handled. Neither shows up in a log — the lead just
 * quietly does worse — so every case is written down here instead.
 */
export function decideSla(state: {
  phase: 'accept' | 'action';
  open: boolean;
  /** Still the agent the timer was armed for? */
  ownedByTimerAgent: boolean;
  acceptedAt: Date | null;
  acted: boolean;
  /** The lead moved past New on its own, which is work by another name. */
  firstTouchAt: Date | null;
}): SlaVerdict {
  if (!state.open) return { act: 'ignore', why: 'closed' };
  if (!state.ownedByTimerAgent) return { act: 'ignore', why: 'owner_changed' };

  /*
   * The accept clock stops the moment the lead is accepted: the action clock
   * takes over and has its own, later deadline. Bouncing here would take the
   * lead off an agent still well inside their time.
   */
  if (state.phase === 'accept' && state.acceptedAt) return { act: 'ignore', why: 'accepted_elsewhere' };

  /*
   * Work counts whether or not anyone pressed a button. An agent who saw the
   * push, rang the client and booked a viewing has not failed anything by
   * skipping Accept.
   */
  if (state.acted || state.firstTouchAt) return { act: 'record', why: 'acted' };

  return { act: 'bounce', why: state.phase === 'accept' ? 'not_accepted' : 'no_action' };
}
