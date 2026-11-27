import { execute, query, queryOne, withTransaction } from '../db/client.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { notify } from '../messaging/notify.js';
import type { SessionUser } from '../auth/sessions.js';
import { countedAgentSql } from '../users/counting.js';
import { routingSettings } from '../routing/settings.js';

/**
 * Incoming: the leads nobody is working on.
 *
 * Two kinds end up here and they are the same problem — a lead nobody owns,
 * and a lead that came back because the agent it was given to ran out of
 * time. Both need a person, and the screen's whole job is to put one on them.
 *
 * An agent sees them as **free leads** and may take one. An owner sees the
 * same list plus the means to hand them out. The important rule is the one
 * that stops two agents taking the same lead a second apart: the claim is a
 * conditional UPDATE, so the second one changes no rows and is told plainly
 * rather than being handed a lead that is already somebody else's.
 */

export interface FreeLead {
  id: string;
  contactId: string;
  name: string | null;
  phone: string | null;
  language: string | null;
  project: string | null;
  budgetMaxAed: number | null;
  source: string | null;
  score: number | null;
  isVip: boolean;
  /** Minutes since it arrived — "waiting 42 min" on the row. */
  waitingMinutes: number;
  /** Why it is free: it came back, or nobody ever had it. */
  returnedAt: Date | null;
  bounceCount: number;
  reason: string | null;
}

const SELECT = `
  SELECT o.id, o.contact_id AS contactId, c.full_name AS name, c.phone_e164 AS phone,
         c.language, o.project_name AS project, o.budget_max_aed AS budgetMaxAed,
         o.source, o.lead_score AS score, o.is_vip AS isVip, o.returned_at AS returnedAt,
         o.bounce_count AS bounceCount, q.reason,
         TIMESTAMPDIFF(MINUTE, COALESCE(o.returned_at, o.created_at), NOW(3)) AS waitingMinutes
    FROM opportunities o
    JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
    LEFT JOIN unassigned_queue q ON q.opportunity_id = o.id AND q.resolved_at IS NULL`;

const row = (r: Record<string, unknown>): FreeLead => ({
  id: String(r.id),
  contactId: String(r.contactId),
  name: (r.name as string | null) ?? null,
  phone: (r.phone as string | null) ?? null,
  language: (r.language as string | null) ?? null,
  project: (r.project as string | null) ?? null,
  budgetMaxAed: r.budgetMaxAed === null ? null : Number(r.budgetMaxAed),
  source: (r.source as string | null) ?? null,
  score: r.score === null ? null : Number(r.score),
  isVip: Number(r.isVip ?? 0) === 1,
  waitingMinutes: Number(r.waitingMinutes ?? 0),
  returnedAt: (r.returnedAt as Date | null) ?? null,
  bounceCount: Number(r.bounceCount ?? 0),
  reason: (r.reason as string | null) ?? null,
});

const WAITING = `o.status = 'open' AND o.owner_user_id IS NULL AND o.deleted_at IS NULL`;

/**
 * Everything waiting that somebody actually sent us, newest first.
 *
 * It used to be one list of everything, oldest first, capped at 200. On 27
 * November that list held 200 CSV rows from an agent who left seventeen days
 * earlier, and 207 leads were waiting -- so a website lead that had arrived a
 * minute before was not on the screen at all, cut off past the end of a page
 * of dead imports. The owner could see the count and could not find the lead.
 *
 * An import is a pile of work to get through; a lead somebody sent us today
 * needs a call within five minutes. They do not belong in one list, and the
 * fresh one must never be the half that gets cut. So they are two lists now,
 * each with its own order: this one newest first, because the newest is the
 * most urgent, and the imported one oldest first, because that one is a
 * queue to work down.
 *
 * Age is deliberately not the test. A website lead still unplaced after three
 * days is more urgent than a CSV row, not less -- splitting on "today" would
 * bury exactly the lead this exists to surface.
 */
export async function freeLeads(): Promise<FreeLead[]> {
  const rows = await query<Record<string, unknown>>(
    `${SELECT}
      WHERE ${WAITING} AND (o.source IS NULL OR o.source <> 'csv_import')
      ORDER BY o.created_at DESC
      LIMIT 200`,
  );
  return rows.map(row);
}

/** The imported lists, oldest first — a backlog to work down, not an alarm. */
export async function importedLeads(): Promise<FreeLead[]> {
  const rows = await query<Record<string, unknown>>(
    `${SELECT}
      WHERE ${WAITING} AND o.source = 'csv_import'
      ORDER BY o.created_at ASC
      LIMIT 200`,
  );
  return rows.map(row);
}

/**
 * How many are really waiting in each list.
 *
 * Both queries above stop at 200, and the screen must never print the length
 * of a truncated list as though it were the total: that is what let 207 read
 * as 200 while the seven that mattered were the ones missing.
 */
export async function waitingCounts(): Promise<{ fresh: number; imported: number }> {
  const got = await queryOne<{ fresh: number; imported: number }>(
    `SELECT SUM(o.source <=> 'csv_import') AS imported,
            SUM(NOT (o.source <=> 'csv_import')) AS fresh
       FROM opportunities o
      WHERE ${WAITING}`,
  );
  return { fresh: Number(got?.fresh ?? 0), imported: Number(got?.imported ?? 0) };
}

/** The owner's extra list: leads that bounced back to them. */
export async function cameBack(ownerUserId: string): Promise<FreeLead[]> {
  const rows = await query<Record<string, unknown>>(
    `${SELECT}
      WHERE o.status = 'open' AND o.owner_user_id = ? AND o.returned_at IS NOT NULL
        AND o.deleted_at IS NULL
      ORDER BY o.returned_at ASC
      LIMIT 200`,
    [ownerUserId],
  );
  return rows.map(row);
}

/** Every agent who could take a lead, and how many they are holding. */
export async function agentsWithLoad(): Promise<Array<{
  id: string; name: string; photoUrl: string | null; openLeads: number;
  availability: string; markedToday: string | null;
}>> {
  const rows = await query<Record<string, unknown>>(
    `SELECT u.id, u.name, u.photo_url AS photoUrl, u.availability,
            a.kind AS markedToday,
            (SELECT COUNT(*) FROM opportunities o
              WHERE o.owner_user_id = u.id AND o.status = 'open' AND o.deleted_at IS NULL)
              AS openLeads
       FROM users u
       LEFT JOIN attendance a ON a.user_id = u.id
            AND a.on_date = DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00'))
      WHERE u.is_active = 1 AND ${countedAgentSql()}
      ORDER BY openLeads ASC, u.name ASC`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    photoUrl: (r.photoUrl as string | null) ?? null,
    openLeads: Number(r.openLeads),
    availability: String(r.availability ?? 'available'),
    markedToday: (r.markedToday as string | null) ?? null,
  }));
}

/**
 * May this person take a free lead for themselves?
 *
 * Owners and admins always may. Everyone else only while the CRM hands leads
 * out by itself; when the owner hands them out, a free lead waits for the
 * owner's choice, the same rule as `whoMayPlace` on the old Incoming.
 */
export async function mayTakeFreeLeads(role: string): Promise<boolean> {
  if (role === 'owner' || role === 'admin') return true;
  return (await routingSettings()).autoAssign;
}

/**
 * "Take this lead."
 *
 * The UPDATE carries `owner_user_id IS NULL` in its WHERE, so two agents
 * pressing within the same second cannot both win: the second changes no
 * rows and is told somebody was quicker. Checking first and writing after
 * would leave exactly the gap this closes.
 */
export async function takeLead(
  actor: AuditActor,
  user: SessionUser,
  opportunityId: string,
): Promise<{ taken: true }> {
  const before = await queryOne<{ id: string; contact_id: string; status: string; owner_user_id: string | null }>(
    'SELECT id, contact_id, status, owner_user_id FROM opportunities WHERE id = ? AND deleted_at IS NULL',
    [opportunityId],
  );
  if (!before) throw notFound('That lead is no longer there.');
  if (before.status !== 'open') throw badRequest('That lead is closed.');
  if (before.owner_user_id === user.id) return { taken: true };

  /*
   * With "Give new leads to an agent automatically" off, the owner hands out
   * every lead. George, 24 Nov: "Nelson is getting all the leads" — he was
   * pressing Take on each one the moment it landed, which is the automatic
   * hand-out by another name. The old Incoming already refused this
   * (`whoMayPlace`); this screen did not.
   */
  if (!(await mayTakeFreeLeads(user.role))) {
    throw forbidden('New leads go to the owner first. Ask an owner or admin to give you one.');
  }

  const result = await withTransaction(async (tx) => {
    const changed = await execute(
      `UPDATE opportunities
          SET owner_user_id = ?, assigned_at = NOW(3), accepted_at = NOW(3), returned_at = NULL
        WHERE id = ? AND owner_user_id IS NULL AND status = 'open'`,
      [user.id, opportunityId],
      tx,
    );
    if (changed.affectedRows === 0) return false;

    await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ?', [user.id, before.contact_id], tx);
    await execute(
      'UPDATE conversations SET assigned_user_id = ? WHERE contact_id = ?',
      [user.id, before.contact_id], tx,
    );
    await execute(
      `UPDATE unassigned_queue SET resolved_at = NOW(3), resolved_by_user_id = ?
        WHERE opportunity_id = ? AND resolved_at IS NULL`,
      [user.id, opportunityId], tx,
    );
    return true;
  });

  if (!result) throw forbidden('Somebody was quicker — that lead already has an agent.');

  await writeAudit({
    actor,
    action: 'incoming.take',
    entityType: 'opportunity',
    entityId: opportunityId,
    before: { ownerUserId: null },
    after: { ownerUserId: user.id },
  });

  return { taken: true };
}

/**
 * "Share the normal leads equally."
 *
 * VIP leads are never shared. A VIP lead is one the owner meant to put in a
 * particular person's hands, and sweeping it into a round-robin is precisely
 * the thing that makes the VIP flow pointless — so they are filtered out here
 * and the caller is told how many were left behind.
 */
export async function shareLeads(
  actor: AuditActor,
  input: { opportunityIds: string[]; agentUserIds: string[] },
): Promise<{ given: number; perAgent: Array<{ agentUserId: string; n: number }>; vipSkipped: number }> {
  if (input.agentUserIds.length === 0) throw badRequest('Choose at least one agent.');
  if (input.opportunityIds.length === 0) throw badRequest('Choose at least one lead.');

  const placeholders = input.opportunityIds.map(() => '?').join(',');
  const rows = await query<{ id: string; contact_id: string; is_vip: number }>(
    `SELECT id, contact_id, is_vip FROM opportunities
      WHERE id IN (${placeholders}) AND status = 'open' AND owner_user_id IS NULL
        AND deleted_at IS NULL`,
    input.opportunityIds,
  );

  const vipSkipped = rows.filter((r) => Number(r.is_vip) === 1).length;
  const shareable = rows.filter((r) => Number(r.is_vip) !== 1);

  const counts = new Map(input.agentUserIds.map((id) => [id, 0]));
  let given = 0;

  for (const [index, lead] of shareable.entries()) {
    const agentUserId = input.agentUserIds[index % input.agentUserIds.length] as string;
    const done = await withTransaction(async (tx) => {
      const changed = await execute(
        `UPDATE opportunities
            SET owner_user_id = ?, assigned_at = NOW(3), accepted_at = NOW(3), returned_at = NULL
          WHERE id = ? AND owner_user_id IS NULL AND status = 'open'`,
        [agentUserId, lead.id],
        tx,
      );
      if (changed.affectedRows === 0) return false;
      await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ?', [agentUserId, lead.contact_id], tx);
      await execute(
        'UPDATE conversations SET assigned_user_id = ? WHERE contact_id = ?',
        [agentUserId, lead.contact_id], tx,
      );
      await execute(
        `UPDATE unassigned_queue SET resolved_at = NOW(3), resolved_by_user_id = ?
          WHERE opportunity_id = ? AND resolved_at IS NULL`,
        [actor.userId, lead.id], tx,
      );
      return true;
    });
    if (!done) continue;
    counts.set(agentUserId, (counts.get(agentUserId) ?? 0) + 1);
    given += 1;
  }

  for (const [agentUserId, n] of counts) {
    if (n === 0) continue;
    await notify({
      userId: agentUserId,
      type: 'lead_assigned',
      title: `${n} new ${n === 1 ? 'lead' : 'leads'} for you`,
      body: 'They are in your leads now.',
      link: '/v2/leads?tab=new',
    }).catch(() => undefined);
  }

  await writeAudit({
    actor,
    action: 'incoming.share',
    entityType: 'opportunity',
    entityId: null,
    after: { given, vipSkipped, agents: input.agentUserIds },
  });

  return {
    given,
    perAgent: [...counts].map(([agentUserId, n]) => ({ agentUserId, n })),
    vipSkipped,
  };
}
