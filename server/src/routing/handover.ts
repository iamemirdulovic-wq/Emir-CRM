/**
 * What happens to an agent's leads when the agent leaves.
 *
 * Deactivating someone already ends their sessions. Their open leads were the
 * part nobody handled: they stayed assigned to an account that cannot log in,
 * so no card moved, no follow-up fired and no timer bounced them — the lead
 * was not lost on paper, it was just never going to be called again. That is
 * the exact failure this CRM exists to prevent.
 *
 * So the leads come back to Incoming, carrying who had them, for the owner to
 * place with someone who is still here.
 */
import { execute, query, queryOne, withRetryingTransaction } from '../db/client.js';
import { randomUUID } from 'node:crypto';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { addActivity } from '../ingestion/ingest.js';
import { cancelJobs } from '../jobs/queue.js';
import { logger, errorContext } from '../lib/logger.js';

export interface HandoverResult {
  returned: number;
  agentName: string;
}

export async function returnLeadsToIncoming(
  actor: AuditActor,
  agentUserId: string,
  why: 'deactivated' | 'removed',
): Promise<HandoverResult> {
  const agent = await queryOne<{ name: string }>('SELECT name FROM users WHERE id = ?', [agentUserId]);
  const agentName = agent?.name ?? 'a former agent';

  const open = await query<{ id: string; contact_id: string }>(
    `SELECT id, contact_id FROM opportunities
      WHERE owner_user_id = ? AND status = 'open' AND deleted_at IS NULL`,
    [agentUserId],
  );
  if (open.length === 0) return { returned: 0, agentName };

  const reason = why === 'deactivated'
    ? `From ${agentName} (left)`
    : `From ${agentName} (removed from the team)`;

  for (const opportunity of open) {
    await withRetryingTransaction(async (tx) => {
      /*
       * One transaction per lead, not one for the batch: an agent with two
       * hundred open leads would otherwise hold every one of those rows
       * locked while the rest of the team is working in them.
       */
      await execute(
        `UPDATE opportunities
            SET owner_user_id = NULL, assigned_at = NULL, accepted_at = NULL
          WHERE id = ? AND owner_user_id = ?`,
        [opportunity.id, agentUserId],
        tx,
      );

      /*
       * The contact's owner goes too. Leaving it would make the lead sticky
       * to someone who has left: the next enquiry from this person would be
       * routed straight back to the account that cannot answer it.
       */
      await execute(
        'UPDATE contacts SET owner_user_id = NULL WHERE id = ? AND owner_user_id = ?',
        [opportunity.contact_id, agentUserId],
        tx,
      );
      await execute(
        'UPDATE conversations SET assigned_user_id = NULL WHERE contact_id = ? AND assigned_user_id = ?',
        [opportunity.contact_id, agentUserId],
        tx,
      );

      await execute(
        `INSERT INTO unassigned_queue (id, opportunity_id, contact_id, reason)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE reason = VALUES(reason), resolved_at = NULL, resolved_by_user_id = NULL`,
        [randomUUID(), opportunity.id, opportunity.contact_id, reason],
        tx,
      );

      await addActivity(tx, {
        contactId: opportunity.contact_id,
        opportunityId: opportunity.id,
        userId: actor.userId,
        type: 'assigned',
        title: `Returned to Incoming — ${reason}`,
      });
    });

    /* Their five-minute clock belonged to an agent who is gone. Leaving it
       armed would bounce a lead that is already sitting in the queue, and
       alert a manager about it a second time. */
    await cancelJobs({
      contactId: opportunity.contact_id,
      types: ['workflow.a.sla_check'],
      reason: 'agent left',
    }).catch((err: unknown) =>
      logger.warn('could not cancel the lead timer during handover', errorContext(err)));
  }

  await writeAudit({
    actor,
    action: 'leads.returned_to_incoming',
    entityType: 'user',
    entityId: agentUserId,
    before: { openLeads: open.length, agent: agentName },
    after: { returned: open.length, reason },
  });

  logger.info('returned an agent\'s open leads to Incoming', { agentUserId, count: open.length });
  return { returned: open.length, agentName };
}
