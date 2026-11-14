/**
 * Who has had this lead, and when each of them got it.
 *
 * Emir, 14 Nov 2026, the same day the single "Given out" date shipped:
 *
 * > "We can add like something kind of like, exact date when leads coming from
 * > admin and owner, always need to show date, and if we have another agents
 * > like transfer leads date it's need to also showing like on the leads page,
 * > this leads transfer from this agent with the date, mean 2 dates."
 *
 * So two dates, not one: the day the owner or admin first handed the lead out,
 * and — when it has moved since — the day it moved and who it came from.
 * `opportunities.assigned_at` only ever holds the current holder's date, so the
 * second date cannot come from the lead row. It comes from the history.
 *
 * ## Which table is the truth
 *
 * **`lead_assignments` is authoritative.** It exists for exactly this: one row
 * per hand-out, with `assigned_by_user_id` naming whoever did the handing and
 * NULL when the CRM did it by itself. `lead_transfers` is a table of
 * *requests* — most rows there are `pending`, `refused`, `cancelled` or
 * `expired`, and a refused request is not a hand-over. When a transfer **is**
 * accepted, `v2/transfers.ts` writes a `lead_assignments` row for it in the
 * same transaction, so the move is already in the chain once. This module
 * therefore reads the chain out of `lead_assignments` and uses
 * `lead_transfers` for one thing only: the **reason** the sending agent gave,
 * which `lead_assignments` has no column for. Nothing is shown twice.
 *
 * ## What this module will not do
 *
 * It never invents a name, a date or a reason. Three consequences, all
 * deliberate:
 *
 *  - A NULL `assigned_by_user_id` means the CRM assigned it, which is the
 *    normal case for Workflow A. It is reported as `by: 'crm'`, never as a
 *    person. (`users` rows are only ever deactivated, never deleted, so the
 *    FK's `ON DELETE SET NULL` cannot turn a person into a NULL here.)
 *  - A hand-out this CRM recorded without a giver — the bulk-assign screen,
 *    the shared pool, "share equally", a straight move — writes no
 *    `lead_assignments` row at all. Rather than show a blank block on a lead
 *    that plainly has an agent, the current holder is added from the lead's
 *    own `assigned_at` as `by: 'unknown'`, so the screen can print the date
 *    without naming anybody. See `docs/v2/questions-dates.md`.
 *  - A transfer with no reason recorded shows no reason.
 */
import { getPool, query, queryOne, type Executor } from '../db/client.js';
import { notFound } from '../lib/errors.js';
import type { TransferReason } from '../v2/transfers.js';

/** Who handed the lead over on this step. */
export type HandedBy =
  /** A person, named in `byName`. */
  | 'person'
  /** The CRM, by itself — `assigned_by_user_id` was NULL. */
  | 'crm'
  /** This CRM never recorded a giver for it. Say the date, name nobody. */
  | 'unknown';

/**
 * What a transfer request came to, where it is not a completed move.
 *
 * The stored `lead_transfers.status` values, minus `accepted` — an accepted
 * one is a hand-over and appears as one. These are keys, never words: the
 * screen turns them into English, because Emir's first rule is that nobody is
 * ever shown a raw code.
 */
export type AttemptOutcome = 'pending' | 'needs_approval' | 'refused' | 'cancelled' | 'expired';

export interface HandoverStep {
  id: string;
  /**
   * For a hand-over, when this person got it. For an attempt, when it was
   * asked for — the date the agent would call "the transfer date". ISO.
   */
  at: string;
  /**
   * `handover` — the lead actually moved to `toName`.
   * `attempt` — somebody asked to pass it and it did not happen (or has not
   * happened yet). Emir asked for these on 14 Nov: a cancelled request is the
   * record of a manager pulling a lead back, and it was invisible.
   */
  kind: 'handover' | 'attempt';
  /** The agent who received it, or on an attempt the one who would have. */
  toName: string | null;
  /** Who had it before. Null means this is the first hand-out we know of. */
  fromName: string | null;
  by: HandedBy;
  /** Only set when `by` is `person`. */
  byName: string | null;
  /** The ENUM key the sending agent chose, where a transfer recorded one. */
  reason: TransferReason | null;
  /** What they typed beside it, where they typed anything. */
  note: string | null;
  /** Only on an attempt: what became of the request. */
  outcome: AttemptOutcome | null;
  /**
   * Only on an attempt that ended: when it ended, ISO. Null while it is still
   * waiting — `decided_at` is genuinely not set then, and is not invented.
   */
  decidedAt: string | null;
}

/** How close a transfer's decision and its assignment row have to be to match. */
const SAME_MOVE_MS = 10_000;

interface AssignmentRow {
  id: string;
  at: Date;
  toUserId: string;
  toName: string | null;
  byUserId: string | null;
  byName: string | null;
}

interface TransferRow {
  id: string;
  status: string;
  fromUserId: string;
  fromName: string | null;
  toUserId: string;
  toName: string | null;
  reason: TransferReason;
  note: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
}

/**
 * The hand-over chain for one lead, oldest first.
 *
 * Oldest first because it is a chain of custody and not a log: read down it
 * and you get the story in the order it happened, which is the order the owner
 * described it in. Who holds it *now* is the last line, and the left column of
 * the lead page says that anyway.
 *
 * Callers must check the reader may see this lead first; the one fence is
 * `assertLeadIsVisible` in `http/routes/my-leads.ts` and this does not write a
 * second one.
 */
export async function handoverChain(
  opportunityId: string,
  exec: Executor = getPool(),
): Promise<HandoverStep[]> {
  const lead = await queryOne<{
    owner_user_id: string | null; assigned_at: Date | null; owner_name: string | null;
  }>(
    `SELECT o.owner_user_id, o.assigned_at, u.name AS owner_name
       FROM opportunities o
       LEFT JOIN users u ON u.id = o.owner_user_id
      WHERE o.id = ? AND o.deleted_at IS NULL`,
    [opportunityId],
    exec,
  );
  if (!lead) throw notFound('That lead no longer exists.');

  /*
   * Ordered by `assigned_at` and then by `created_at` and `id`, so two rows
   * written inside the same millisecond still come back in one fixed order —
   * the chain is read by position, and a wobbling order would put a move
   * between the wrong two people.
   *
   * The limit is oldest-first on purpose: a lead with more hand-overs than
   * this is a lead going round in circles, and the first hundred are the ones
   * that explain how it started. The current holder is added below in any
   * case, so the block never ends on somebody who let it go.
   */
  const assignments = await query<AssignmentRow>(
    `SELECT la.id, la.assigned_at AS at,
            la.agent_user_id AS toUserId, ut.name AS toName,
            la.assigned_by_user_id AS byUserId, ub.name AS byName
       FROM lead_assignments la
       LEFT JOIN users ut ON ut.id = la.agent_user_id
       LEFT JOIN users ub ON ub.id = la.assigned_by_user_id
      WHERE la.opportunity_id = ?
      ORDER BY la.assigned_at ASC, la.created_at ASC, la.id ASC
      LIMIT 100`,
    [opportunityId],
    exec,
  );

  /*
   * Every request, whatever became of it.
   *
   * It used to read `status = 'accepted'`, which answered the question "what
   * is the reason for this move" and threw away everything else. Emir, 14 Nov,
   * with a cancelled request on a real lead in front of him: *"show every
   * transfer, also cancelled and refused ones, with from, to, date, time and
   * reason."* A refused request is the record of an agent turning a lead
   * down, and a cancelled one of a manager pulling it back; neither is a
   * hand-over, and neither should vanish.
   *
   * An accepted row still annotates the assignment it produced, so it is
   * never drawn twice. Everything else becomes a line of its own.
   */
  const transfers = await query<TransferRow>(
    `SELECT t.id, t.status, t.from_user_id AS fromUserId, uf.name AS fromName,
            t.to_user_id AS toUserId, ut.name AS toName,
            t.reason, t.note, t.requested_at AS requestedAt, t.decided_at AS decidedAt
       FROM lead_transfers t
       LEFT JOIN users uf ON uf.id = t.from_user_id
       LEFT JOIN users ut ON ut.id = t.to_user_id
      WHERE t.opportunity_id = ?
      ORDER BY t.requested_at ASC, t.id ASC
      LIMIT 100`,
    [opportunityId],
    exec,
  );

  const accepted = transfers.filter(
    (one) => one.status === 'accepted' && one.decidedAt !== null,
  );
  const spent = new Set<number>();
  const steps: HandoverStep[] = [];

  for (const row of assignments) {
    const matched = matchTransfer(accepted, spent, row);
    const previous = steps.length > 0 ? (steps[steps.length - 1] as HandoverStep) : null;
    /*
     * Where the lead came from: the transfer says so itself, otherwise it is
     * whoever the previous step handed it to. Null on the first step, which is
     * what makes it read "Given out by …" rather than "Transferred from …".
     */
    const fromName = matched?.fromName ?? previous?.toName ?? null;

    steps.push({
      id: row.id,
      at: row.at.toISOString(),
      kind: 'handover',
      toName: row.toName,
      fromName,
      by: row.byUserId === null ? 'crm' : 'person',
      byName: row.byUserId === null ? null : row.byName,
      reason: matched?.reason ?? null,
      note: matched?.note ?? null,
      outcome: null,
      decidedAt: null,
    });
  }

  /*
   * The hand-outs this CRM records without a `lead_assignments` row — the bulk
   * assign screen, "share equally", a claim from the shared pool, a straight
   * move. The date is on the lead itself, so it can be said; the giver was
   * never written down, so nobody is named.
   */
  const last = steps.length > 0 ? (steps[steps.length - 1] as HandoverStep) : null;
  const covered = last !== null
    && assignments.length > 0
    && (assignments[assignments.length - 1] as AssignmentRow).toUserId === lead.owner_user_id;

  if (!covered && lead.owner_user_id !== null && lead.assigned_at !== null) {
    steps.push({
      id: `now:${opportunityId}`,
      at: lead.assigned_at.toISOString(),
      kind: 'handover',
      toName: lead.owner_name,
      fromName: last?.toName ?? null,
      by: 'unknown',
      byName: null,
      reason: null,
      note: null,
      outcome: null,
      decidedAt: null,
    });
  }

  /*
   * The requests that did not move the lead. Dated by when they were **asked
   * for**, not by when they ended: that is the date an agent means by "the
   * transfer date", and it is the one the request shares with the rest of the
   * story. When it ended is sent alongside, and the screen puts it in the
   * tooltip rather than printing two dates on one line.
   *
   * `requested_at` is NOT NULL and `reason` is NOT NULL on this table, so
   * every one of these rows really does carry a from, a to, a date, a time
   * and a reason. `decided_at` is the only field that can be missing, and it
   * is missing exactly when the request is still waiting — which is the truth
   * and is shown as such.
   */
  for (const one of transfers) {
    if (one.status === 'accepted') continue;
    steps.push({
      id: `t:${one.id}`,
      at: one.requestedAt.toISOString(),
      kind: 'attempt',
      toName: one.toName,
      fromName: one.fromName,
      by: 'person',
      byName: one.fromName,
      reason: one.reason,
      note: one.note,
      outcome: one.status as AttemptOutcome,
      decidedAt: one.decidedAt === null ? null : one.decidedAt.toISOString(),
    });
  }

  /*
   * One list, oldest first. The chain above was built in its own order on
   * purpose — each hand-over reads its "from" off the one before it — so the
   * attempts are woven in only now, once that is settled. A stable sort keeps
   * a request and the move it produced in the order they were pushed.
   */
  steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return steps;
}

/**
 * The accepted transfer that produced this assignment row, if there is one.
 *
 * `v2/transfers.ts` writes the transfer's `decided_at` and the assignment row
 * inside one transaction, so the two timestamps are milliseconds apart; ten
 * seconds of slack is generous and still far too narrow to catch a different
 * move. Each transfer is used once, so the same pair of agents swapping a lead
 * back and forth cannot have one reason printed twice.
 */
function matchTransfer(
  transfers: TransferRow[],
  spent: Set<number>,
  row: AssignmentRow,
): TransferRow | null {
  for (const [index, transfer] of transfers.entries()) {
    if (spent.has(index)) continue;
    if (transfer.toUserId !== row.toUserId) continue;
    /* The accepting path records the sending agent as the giver, so these are
       the same person on a transfer and different people on anything else. */
    if (transfer.fromUserId !== row.byUserId) continue;
    /* Only accepted rows reach here, and an accepted one always has a
       decision time; the guard keeps that promise honest rather than assumed. */
    if (transfer.decidedAt === null) continue;
    if (Math.abs(transfer.decidedAt.getTime() - row.at.getTime()) > SAME_MOVE_MS) continue;
    spent.add(index);
    return transfer;
  }
  return null;
}
