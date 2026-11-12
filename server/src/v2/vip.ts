import { getPool, execute, queryOne, withTransaction } from '../db/client.js';
import { notify } from '../messaging/notify.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { addActivity } from '../ingestion/ingest.js';
import { returnLeadToGiver } from '../routing/assignments.js';
import { forbidden, notFound } from '../lib/errors.js';

/**
 * A VIP lead: the owner hands one over by name, with a clock on it.
 *
 * Two answers only, and the agent gives one of them: *I have it* or *I can't
 * take it*. Both are recorded, both tell the owner, and neither is a quiet
 * no-op — the whole point of the feature is that Emir knows within the minute
 * whether his personal introduction is being looked after.
 *
 * Refusing is not a soft option: the lead goes straight back to whoever gave
 * it, in their Incoming, where there is a screen for handing it to somebody
 * else. That reuses `returnLeadToGiver`, the same path a run-out clock takes,
 * so a refused VIP lead and a breached one end up in exactly one place.
 */

interface Handoff {
  id: string;
  opportunity_id: string;
  contact_id: string;
  given_by: string;
  given_to: string;
  accepted_at: Date | null;
  refused_at: Date | null;
  returned_at: Date | null;
  agent_name: string | null;
  lead_name: string | null;
}

async function load(id: string, me: string): Promise<Handoff> {
  const row = await queryOne<Handoff>(
    `SELECT v.id, v.opportunity_id, v.given_by, v.given_to, v.accepted_at, v.refused_at,
            v.returned_at, o.contact_id, u.name AS agent_name, c.full_name AS lead_name
       FROM vip_handoffs v
       JOIN opportunities o ON o.id = v.opportunity_id
       JOIN contacts c ON c.id = o.contact_id
       JOIN users u ON u.id = v.given_to
      WHERE v.id = ?`,
    [id],
  );
  if (!row) throw notFound('That VIP lead is no longer there.');
  /*
   * Only the person it was given to may answer for it. A manager cannot
   * accept on an agent's behalf: the record would then say the agent took it
   * when they never saw it, and the clock it stops is the agent's.
   */
  if (row.given_to !== me) throw forbidden('That VIP lead was given to somebody else.');
  return row;
}

export async function acceptVip(actor: AuditActor, id: string, me: string): Promise<{ acceptedAt: Date }> {
  const handoff = await load(id, me);
  if (handoff.refused_at || handoff.returned_at) {
    throw forbidden('That VIP lead has already gone back.');
  }
  /* Already accepted: say yes again rather than fail. A double tap on a phone
     with a slow connection is not an error. */
  if (handoff.accepted_at) return { acceptedAt: handoff.accepted_at };

  const acceptedAt = new Date();
  await execute(
    'UPDATE vip_handoffs SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL',
    [acceptedAt, id],
  );
  await addActivity(getPool(), {
    contactId: handoff.contact_id,
    opportunityId: handoff.opportunity_id,
    userId: me,
    type: 'note',
    title: 'VIP lead accepted',
    body: 'The agent took the VIP lead and the clock stopped.',
  });
  await notify({
    userId: handoff.given_by,
    type: 'vip_accepted',
    title: `${handoff.agent_name ?? 'The agent'} took the VIP lead`,
    body: handoff.lead_name ? `${handoff.lead_name} is being called now.` : null,
    link: `/v2/leads/${handoff.opportunity_id}`,
    opportunityId: handoff.opportunity_id,
    priority: 'high',
  });
  await writeAudit({
    actor,
    action: 'vip.accept',
    entityType: 'vip_handoff',
    entityId: id,
    after: { acceptedAt },
  });

  return { acceptedAt };
}

export async function refuseVip(
  actor: AuditActor,
  id: string,
  me: string,
  note: string | null,
): Promise<{ refusedAt: Date }> {
  const handoff = await load(id, me);
  if (handoff.returned_at) throw forbidden('That VIP lead has already gone back.');

  const refusedAt = new Date();
  await withTransaction(async (tx) => {
    await execute(
      'UPDATE vip_handoffs SET refused_at = ?, refused_note = ?, returned_at = ? WHERE id = ?',
      [refusedAt, note, refusedAt, id],
      tx,
    );
    await returnLeadToGiver(tx, {
      opportunityId: handoff.opportunity_id,
      contactId: handoff.contact_id,
      agentUserId: me,
      agentName: handoff.agent_name,
      giverUserId: handoff.given_by,
    });
  });

  await addActivity(getPool(), {
    contactId: handoff.contact_id,
    opportunityId: handoff.opportunity_id,
    userId: me,
    type: 'note',
    title: 'VIP lead sent back',
    body: note
      ? `Sent the VIP lead back: ${note}`
      : 'Sent the VIP lead back.',
  });
  await notify({
    userId: handoff.given_by,
    type: 'vip_refused',
    title: `${handoff.agent_name ?? 'The agent'} sent the VIP lead back`,
    body: note ?? 'It is in your Incoming, ready to give to somebody else.',
    link: '/v2/incoming',
    opportunityId: handoff.opportunity_id,
    priority: 'high',
  });
  await writeAudit({
    actor,
    action: 'vip.refuse',
    entityType: 'vip_handoff',
    entityId: id,
    after: { refusedAt, note },
  });

  return { refusedAt };
}
