/**
 * Moving leads from one agent to another, several at a time.
 *
 * `design/web/all-leads.html` ticks rows, shows a dark bar, and opens a "Move
 * N leads" panel that asks twice and then offers Undo. The build had the
 * boxes in the phone branch only, and the move itself was one HTTP request
 * per lead from the browser — twenty leads was twenty round trips, and there
 * was no way to put them back.
 *
 * So the whole move is one request, and it answers with where each lead came
 * from, which is what makes Undo possible: the browser sends the inverse list
 * back to the same endpoint.
 *
 * One transaction per lead rather than one for the batch, which is the same
 * choice `routing/handover.ts` made and for the same reason: fifty leads in
 * one transaction holds fifty rows locked while the rest of the floor is
 * working in them.
 *
 * "Notes and history go with them" — the design's own words, and they are
 * true because nothing is copied: the lead keeps its id, so its notes,
 * timeline, tasks and files are exactly where they were.
 */
import { randomUUID } from 'node:crypto';
import { execute, query, queryOne, withRetryingTransaction } from '../db/client.js';
import { addActivity } from '../ingestion/ingest.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { badRequest } from '../lib/errors.js';
import { ownerPredicate } from '../auth/scope.js';
import { notify } from '../messaging/notify.js';
import { logger, errorContext } from '../lib/logger.js';

/**
 * How many leads one press may move.
 *
 * Generous enough for "select all on this page" twice over, small enough that
 * the request cannot become a job. The owner's book is 863 leads; moving all
 * of them in one press is not a thing anybody means to do, and the screen
 * says so rather than discovering it halfway through.
 */
export const MOVE_LIMIT = 200;

export interface MoveOne {
  id: string;
  /** Null means Incoming — the free-leads queue any agent can claim from. */
  toUserId: string | null;
}

export interface MovedOne {
  id: string;
  name: string | null;
  /** Who held it before, so the browser can offer Undo. */
  fromUserId: string | null;
  fromName: string | null;
  toUserId: string | null;
  toName: string | null;
}

export interface MoveResult {
  moved: MovedOne[];
  /** Leads the mover may not see, or that no longer exist. */
  skipped: number;
  said: string;
}

export async function moveLeads(
  actor: AuditActor,
  visible: string[] | null,
  moves: MoveOne[],
): Promise<MoveResult> {
  if (moves.length === 0) throw badRequest('Choose at least one lead to move.');
  if (moves.length > MOVE_LIMIT) {
    throw badRequest(`That is more than ${MOVE_LIMIT} leads. Move them in smaller batches.`);
  }

  /* Who the leads may go to. Checked once for the batch rather than once per
     lead, and an inactive account is refused outright: a lead handed to
     somebody who has left is a lead nobody rings. */
  const targets = [...new Set(moves.map((one) => one.toUserId).filter((one): one is string => !!one))];
  const people = new Map<string, string>();
  if (targets.length > 0) {
    const rows = await query<{ id: string; name: string; is_active: number }>(
      `SELECT id, name, is_active FROM users WHERE id IN (${targets.map(() => '?').join(',')})`,
      targets,
    );
    for (const row of rows) {
      if (row.is_active !== 1) throw badRequest(`${row.name} is not an active account.`);
      people.set(row.id, row.name);
    }
    for (const id of targets) {
      if (!people.has(id)) throw badRequest('One of those agents no longer exists.');
    }
  }

  const scope = ownerPredicate('o.owner_user_id', visible);
  const moved: MovedOne[] = [];
  let skipped = 0;

  for (const move of moves) {
    /* eslint-disable no-await-in-loop -- one transaction per lead, on purpose. */
    const lead = await queryOne<{
      id: string; contact_id: string; owner_user_id: string | null;
      full_name: string | null; owner_name: string | null;
    }>(
      `SELECT o.id, o.contact_id, o.owner_user_id, c.full_name, u.name AS owner_name
         FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
         LEFT JOIN users u ON u.id = o.owner_user_id
        WHERE o.id = ? AND o.deleted_at IS NULL AND ${scope.sql}`,
      [move.id, ...scope.params],
    );
    /* Not an error: a list open in another tab can name a lead this person
       may no longer touch, and nineteen good moves must not fail for it. */
    if (!lead) {
      skipped += 1;
      continue;
    }
    if (lead.owner_user_id === move.toUserId) {
      skipped += 1;
      continue;
    }

    await withRetryingTransaction(async (tx) => {
      if (move.toUserId) {
        await execute(
          'UPDATE opportunities SET owner_user_id = ?, assigned_at = NOW(3), returned_at = NULL WHERE id = ?',
          [move.toUserId, move.id],
          tx,
        );
        /* The person's sticky owner goes with the enquiry, or their next
           enquiry routes straight back to the agent who no longer has them. */
        await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ?', [move.toUserId, lead.contact_id], tx);
        await execute(
          'UPDATE conversations SET assigned_user_id = ? WHERE contact_id = ?',
          [move.toUserId, lead.contact_id],
          tx,
        );
        /* It is somebody's lead again, so it is no longer waiting to be
           placed. Left behind, it would show in Incoming for ever. */
        await execute(
          'UPDATE unassigned_queue SET resolved_at = NOW(3), resolved_by_user_id = ? WHERE opportunity_id = ? AND resolved_at IS NULL',
          [actor.userId, move.id],
          tx,
        );
      } else {
        await execute(
          `UPDATE opportunities
              SET owner_user_id = NULL, assigned_at = NULL, accepted_at = NULL, returned_at = NULL
            WHERE id = ?`,
          [move.id],
          tx,
        );
        await execute('UPDATE contacts SET owner_user_id = NULL WHERE id = ?', [lead.contact_id], tx);
        await execute(
          'UPDATE conversations SET assigned_user_id = NULL WHERE contact_id = ?',
          [lead.contact_id],
          tx,
        );
        await execute(
          `INSERT INTO unassigned_queue (id, opportunity_id, contact_id, reason)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE reason = VALUES(reason), resolved_at = NULL, resolved_by_user_id = NULL`,
          [
            randomUUID(), move.id, lead.contact_id,
            /* `reason` is VARCHAR(160) NOT NULL, and a long name would make
               the whole move fail on a truncation rather than a bug. */
            `Moved to Incoming by ${actor.label ?? 'an owner'}`.slice(0, 160),
          ],
          tx,
        );
      }

      const toName = move.toUserId ? people.get(move.toUserId) ?? 'another agent' : 'Incoming';
      await addActivity(tx, {
        contactId: lead.contact_id,
        opportunityId: move.id,
        userId: actor.userId,
        type: 'opportunity.reassigned',
        title: move.toUserId ? `Given to ${toName}` : 'Moved to Incoming',
        body: 'Notes and history went with it.',
        meta: { from: lead.owner_user_id, to: move.toUserId },
      });

      await writeAudit(
        {
          actor,
          action: 'opportunity.reassigned',
          entityType: 'opportunity',
          entityId: move.id,
          before: { owner_user_id: lead.owner_user_id },
          after: { owner_user_id: move.toUserId },
        },
        tx,
      );
    });

    moved.push({
      id: move.id,
      name: lead.full_name,
      fromUserId: lead.owner_user_id,
      fromName: lead.owner_name,
      toUserId: move.toUserId,
      toName: move.toUserId ? people.get(move.toUserId) ?? null : null,
    });
    /* eslint-enable no-await-in-loop */
  }

  /*
   * "The new agent gets one notification." One per receiving agent for the
   * whole batch, not one per lead: twenty leads must not be twenty pushes.
   */
  const perAgent = new Map<string, number>();
  for (const one of moved) {
    if (one.toUserId) perAgent.set(one.toUserId, (perAgent.get(one.toUserId) ?? 0) + 1);
  }
  await Promise.all([...perAgent].map(([userId, n]) => notify({
    userId,
    type: 'lead_assigned',
    title: n === 1 ? 'A lead was given to you' : `${n} leads were given to you`,
    body: n === 1
      ? `${moved.find((one) => one.toUserId === userId)?.name ?? 'A lead'} is yours now.`
      : 'Notes and history came with them.',
    link: '/v2/leads',
  }).catch((err: unknown) => logger.warn('could not tell an agent about a move', errorContext(err)))));

  const word = (n: number) => (n === 1 ? '1 lead' : `${n} leads`);
  const names = [...new Set(moved.map((one) => one.fromName).filter(Boolean))];
  const to = moved[0]?.toUserId ? moved[0]?.toName : 'Incoming';
  const said = moved.length === 0
    ? 'Nothing moved.'
    : `${word(moved.length)} moved${names.length === 1 ? ` from ${names[0]}` : ''} to ${to}`
      + ' · notes and history went with them';

  return { moved, skipped, said };
}
