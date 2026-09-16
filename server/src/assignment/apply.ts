/**
 * Putting an assignment plan into effect, and the shared pool.
 *
 * `distribute.ts` decides who gets what; this is the thin layer that loads the
 * candidates, writes the result and records it. Every assignment and
 * reassignment is audited, as the specification requires.
 */
import type { PoolConnection } from 'mysql2/promise';
import { execute, getPool, query, queryOne, withRetryingTransaction, type Executor } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { writeAudit, SYSTEM_ACTOR, type AuditActor } from '../audit/audit.js';
import {
  distribute, overloaded,
  type AssignableLead, type AssignmentCandidate, type DistributionInput, type DistributionPlan,
} from './distribute.js';

/** Defaults for the shared pool, overridable per rule. */
export const POOL_DEFAULTS = {
  /** An agent may hold this many claimed leads at once. */
  maxOpenClaims: 50,
  /** A claimed lead nobody touches returns to the pool after this long. */
  releaseAfterDays: 3,
};

function parseJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Agents who can take work, with how many open leads they already hold.
 *
 * `openLeads` counts open opportunities rather than everything ever assigned:
 * a closed deal is not a load on anybody, and counting it would penalise the
 * agents who close.
 */
export async function loadCandidates(
  options: { teamId?: string | null; userIds?: string[] | null } = {},
  exec: Executor = getPool(),
): Promise<AssignmentCandidate[]> {
  const where: string[] = ["u.role = 'agent'", 'u.is_active = 1'];
  const args: string[] = [];

  if (options.teamId) {
    where.push('EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = ? AND tm.user_id = u.id)');
    args.push(options.teamId);
  }
  if (options.userIds && options.userIds.length > 0) {
    where.push(`u.id IN (${options.userIds.map(() => '?').join(',')})`);
    args.push(...options.userIds);
  } else if (options.userIds) {
    return [];
  }

  const rows = await query<{
    id: string;
    name: string;
    availability: 'available' | 'busy' | 'off';
    languages: unknown;
    projects_covered: unknown;
    open_leads: number;
  }>(
    `SELECT u.id, u.name, u.availability, u.languages, u.projects_covered,
            (SELECT COUNT(*) FROM opportunities o
              WHERE o.owner_user_id = u.id AND o.status = 'open') AS open_leads
       FROM users u
      WHERE ${where.join(' AND ')}
      ORDER BY u.name`,
    args,
    exec,
  );

  return rows.map((row) => ({
    userId: row.id,
    name: row.name,
    languages: parseJsonArray(row.languages).map((value) => value.toLowerCase()),
    projectsCovered: parseJsonArray(row.projects_covered),
    openLeads: Number(row.open_leads ?? 0),
    // "off" is a holiday, "busy" is a full desk. Neither takes a new batch.
    isEligible: row.availability === 'available',
  }));
}

/** The leads a plan is about, in the shape distribute() wants. */
export async function loadAssignable(
  opportunityIds: string[],
  exec: Executor = getPool(),
): Promise<AssignableLead[]> {
  if (opportunityIds.length === 0) return [];
  const rows = await query<{
    id: string;
    language: string | null;
    project_name: string | null;
    emirate: string | null;
    budget_max_aed: number | null;
  }>(
    `SELECT o.id, c.language, o.project_name, o.emirate, o.budget_max_aed
       FROM opportunities o JOIN contacts c ON c.id = o.contact_id
      WHERE o.id IN (${opportunityIds.map(() => '?').join(',')})`,
    opportunityIds,
    exec,
  );
  return rows.map((row) => ({
    id: row.id,
    language: row.language,
    projectName: row.project_name,
    emirate: row.emirate,
    budgetMaxAed: row.budget_max_aed === null ? null : Number(row.budget_max_aed),
  }));
}

export interface PreviewResult {
  plan: { method: string; counts: { userId: string; name: string; before: number; after: number }[] };
  pooled: number;
  unmatched: number;
  warnings: { userId: string; name: string; after: number; average: number }[];
}

/** What an assignment would do, before anyone commits to it. */
export function previewPlan(candidates: AssignmentCandidate[], plan: DistributionPlan): PreviewResult {
  const byId = new Map(candidates.map((candidate) => [candidate.userId, candidate]));
  return {
    plan: {
      method: plan.method,
      counts: [...plan.counts.entries()].map(([userId, n]) => ({
        userId,
        name: byId.get(userId)?.name ?? userId,
        before: byId.get(userId)?.openLeads ?? 0,
        after: (byId.get(userId)?.openLeads ?? 0) + n,
      })),
    },
    pooled: plan.pooled.length,
    unmatched: plan.unmatched.length,
    warnings: overloaded(candidates, plan).map((warning) => ({
      ...warning,
      name: byId.get(warning.userId)?.name ?? warning.userId,
    })),
  };
}

export interface ApplyResult {
  assigned: number;
  pooled: number;
  unmatched: number;
}

/**
 * Writes a plan to the opportunities and their contacts.
 *
 * The contact's owner follows the opportunity, because "a returning lead stays
 * with their existing agent" is decided from `contacts.owner_user_id`. Leaving
 * the two out of step would quietly break sticky ownership.
 */
export async function applyPlan(
  actor: AuditActor,
  plan: DistributionPlan,
  reason: string,
  exec: Executor = getPool(),
): Promise<ApplyResult> {
  for (const [opportunityId, userId] of plan.byLead) {
    const before = await queryOne<{ owner_user_id: string | null; contact_id: string }>(
      'SELECT owner_user_id, contact_id FROM opportunities WHERE id = ?',
      [opportunityId],
      exec,
    );
    if (!before) continue;
    if (before.owner_user_id === userId) continue;

    await execute(
      `UPDATE opportunities
          SET owner_user_id = ?, assigned_at = COALESCE(assigned_at, NOW(3))
        WHERE id = ?`,
      [userId, opportunityId],
      exec,
    );
    await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ?', [userId, before.contact_id], exec);
    await execute(
      `INSERT INTO activities (id, contact_id, opportunity_id, user_id, type, title, body, created_at)
       VALUES (?, ?, ?, ?, 'lead.assigned', ?, ?, NOW(3))`,
      [newId(), before.contact_id, opportunityId, actor.userId, `Assigned by ${reason}`, null],
      exec,
    );
    await writeAudit(
      {
        actor,
        action: 'lead.assigned',
        entityType: 'opportunity',
        entityId: opportunityId,
        before: { ownerUserId: before.owner_user_id },
        after: { ownerUserId: userId, method: plan.method, reason },
      },
      exec,
    );
  }

  // Pooled leads are explicitly unowned, which is what makes them claimable.
  for (const opportunityId of plan.pooled) {
    const before = await queryOne<{ owner_user_id: string | null; contact_id: string }>(
      'SELECT owner_user_id, contact_id FROM opportunities WHERE id = ?',
      [opportunityId],
      exec,
    );
    if (!before || before.owner_user_id === null) continue;
    await execute('UPDATE opportunities SET owner_user_id = NULL WHERE id = ?', [opportunityId], exec);
    await execute('UPDATE contacts SET owner_user_id = NULL WHERE id = ?', [before.contact_id], exec);
    await writeAudit(
      {
        actor,
        action: 'lead.pooled',
        entityType: 'opportunity',
        entityId: opportunityId,
        before: { ownerUserId: before.owner_user_id },
        after: { ownerUserId: null, reason },
      },
      exec,
    );
  }

  return { assigned: plan.byLead.size, pooled: plan.pooled.length, unmatched: plan.unmatched.length };
}

/** Load candidates, distribute, apply. The path every caller actually wants. */
export async function assign(
  actor: AuditActor,
  input: Omit<DistributionInput, 'candidates' | 'leads'> & {
    opportunityIds: string[];
    teamId?: string | null;
    reason: string;
  },
  exec: Executor = getPool(),
): Promise<ApplyResult> {
  const [candidates, leads] = await Promise.all([
    loadCandidates({ teamId: input.teamId ?? null }, exec),
    loadAssignable(input.opportunityIds, exec),
  ]);
  const plan = distribute({ ...input, candidates, leads });
  return applyPlan(actor, plan, input.reason, exec);
}

/* ── The shared pool ──────────────────────────────────────────────────── */

export interface ClaimResult {
  opportunityId: string;
  contactId: string;
  fullName: string | null;
}

/**
 * "Claim next lead".
 *
 * The claim and the ownership change happen in one transaction with the
 * opportunity row locked, so two agents pressing the button at the same instant
 * cannot both get the same lead — and the unique index on `open_key` is the
 * backstop if they somehow do.
 */
export async function claimNextLead(
  actor: AuditActor,
  userId: string,
  options: { maxOpenClaims?: number } = {},
): Promise<ClaimResult | null> {
  const limit = options.maxOpenClaims ?? POOL_DEFAULTS.maxOpenClaims;

  return withRetryingTransaction(async (tx: PoolConnection) => {
    const open = await queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM lead_pool_claims WHERE user_id = ? AND released_at IS NULL',
      [userId],
      tx,
    );
    if (Number(open?.n ?? 0) >= limit) {
      throw badRequest(
        `You already have ${limit} claimed leads. Work some of them before claiming more.`,
      );
    }

    /*
     * Oldest first, and SKIP LOCKED so a row another agent is mid-claim on is
     * passed over rather than waited for. The lead must still be unowned and
     * open at the moment we lock it.
     */
    const next = await queryOne<{ id: string; contact_id: string }>(
      `SELECT o.id, o.contact_id
         FROM opportunities o
        WHERE o.owner_user_id IS NULL AND o.status = 'open'
        ORDER BY o.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [],
      tx,
    );
    if (!next) return null;

    await execute('SELECT id FROM contacts WHERE id = ? FOR UPDATE', [next.contact_id], tx);

    await execute(
      `INSERT INTO lead_pool_claims (id, opportunity_id, contact_id, user_id, open_key)
       VALUES (?, ?, ?, ?, ?)`,
      [newId(), next.id, next.contact_id, userId, next.id],
      tx,
    );
    await execute(
      'UPDATE opportunities SET owner_user_id = ?, assigned_at = COALESCE(assigned_at, NOW(3)) WHERE id = ?',
      [userId, next.id],
      tx,
    );
    await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ?', [userId, next.contact_id], tx);

    const contact = await queryOne<{ full_name: string | null }>(
      'SELECT full_name FROM contacts WHERE id = ?',
      [next.contact_id],
      tx,
    );

    await execute(
      `INSERT INTO activities (id, contact_id, opportunity_id, user_id, type, title, body, created_at)
       VALUES (?, ?, ?, ?, 'lead.assigned', 'Claimed from the shared pool', NULL, NOW(3))`,
      [newId(), next.contact_id, next.id, userId],
      tx,
    );
    await writeAudit(
      {
        actor,
        action: 'lead.claimed',
        entityType: 'opportunity',
        entityId: next.id,
        after: { ownerUserId: userId },
      },
      tx,
    );

    return { opportunityId: next.id, contactId: next.contact_id, fullName: contact?.full_name ?? null };
  });
}

/** How many leads are waiting in the pool, and how many this agent holds. */
export async function poolStatus(
  userId: string,
  exec: Executor = getPool(),
): Promise<{ available: number; claimedByYou: number; maxOpenClaims: number }> {
  const available = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM opportunities WHERE owner_user_id IS NULL AND status = 'open'",
    [],
    exec,
  );
  const mine = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM lead_pool_claims WHERE user_id = ? AND released_at IS NULL',
    [userId],
    exec,
  );
  return {
    available: Number(available?.n ?? 0),
    claimedByYou: Number(mine?.n ?? 0),
    maxOpenClaims: POOL_DEFAULTS.maxOpenClaims,
  };
}

/**
 * Returns claimed leads nobody has touched to the pool.
 *
 * "Touched" is first contact, a message, or any stage movement — the same
 * standard the SLA uses. Run from cron; safe to run repeatedly.
 */
export async function recycleStaleClaims(
  afterDays: number = POOL_DEFAULTS.releaseAfterDays,
  exec: Executor = getPool(),
): Promise<number> {
  const stale = await query<{ id: string; opportunity_id: string; contact_id: string; user_id: string }>(
    `SELECT pc.id, pc.opportunity_id, pc.contact_id, pc.user_id
       FROM lead_pool_claims pc
       JOIN opportunities o ON o.id = pc.opportunity_id
      WHERE pc.released_at IS NULL
        AND pc.claimed_at < DATE_SUB(NOW(3), INTERVAL ? DAY)
        AND o.status = 'open'
        AND o.first_touch_at IS NULL
        AND o.stage_key = 'new_lead'
        AND NOT EXISTS (
          SELECT 1 FROM messages m
            JOIN conversations cv ON cv.id = m.conversation_id
           WHERE cv.contact_id = pc.contact_id AND m.created_at > pc.claimed_at
        )
      LIMIT 500`,
    [afterDays],
    exec,
  );

  for (const claim of stale) {
    await execute(
      "UPDATE lead_pool_claims SET released_at = NOW(3), open_key = NULL, release_reason = 'untouched' WHERE id = ?",
      [claim.id],
      exec,
    );
    await execute('UPDATE opportunities SET owner_user_id = NULL WHERE id = ?', [claim.opportunity_id], exec);
    await execute('UPDATE contacts SET owner_user_id = NULL WHERE id = ?', [claim.contact_id], exec);
    await writeAudit(
      {
        actor: SYSTEM_ACTOR,
        action: 'lead.recycled',
        entityType: 'opportunity',
        entityId: claim.opportunity_id,
        before: { ownerUserId: claim.user_id },
        after: { ownerUserId: null, reason: `untouched for ${afterDays} days` },
      },
      exec,
    );
  }

  if (stale.length > 0) logger.info('pool claims recycled', { count: stale.length, afterDays });
  return stale.length;
}

/** An agent giving a lead back voluntarily. */
export async function releaseClaim(
  actor: AuditActor,
  opportunityId: string,
  userId: string,
  exec: Executor = getPool(),
): Promise<void> {
  const claim = await queryOne<{ id: string; contact_id: string }>(
    'SELECT id, contact_id FROM lead_pool_claims WHERE opportunity_id = ? AND user_id = ? AND released_at IS NULL',
    [opportunityId, userId],
    exec,
  );
  if (!claim) throw badRequest('You have not claimed that lead');

  await execute(
    "UPDATE lead_pool_claims SET released_at = NOW(3), open_key = NULL, release_reason = 'returned' WHERE id = ?",
    [claim.id],
    exec,
  );
  await execute('UPDATE opportunities SET owner_user_id = NULL WHERE id = ?', [opportunityId], exec);
  await execute('UPDATE contacts SET owner_user_id = NULL WHERE id = ?', [claim.contact_id], exec);
  await writeAudit(
    {
      actor,
      action: 'lead.released',
      entityType: 'opportunity',
      entityId: opportunityId,
      before: { ownerUserId: userId },
      after: { ownerUserId: null },
    },
    exec,
  );
}
