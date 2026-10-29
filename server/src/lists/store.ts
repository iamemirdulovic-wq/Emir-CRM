/**
 * Lists: reading them, filling them, and the bulk actions that operate on a
 * selection of contacts.
 */
import { execute, getPool, query, queryOne, type Executor, type SqlParam } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { badRequest } from '../lib/errors.js';
import { ownerPredicate } from '../auth/scope.js';
import { writeAudit, SYSTEM_ACTOR, type AuditActor } from '../audit/audit.js';
import { tagContact } from '../ingestion/ingest.js';
import { assign } from '../assignment/apply.js';
import type { AssignmentMethod, AssignmentRuleClause, SplitShare } from '../assignment/distribute.js';
import { buildFilter, type ListFilter } from './filters.js';

export interface ListRecord {
  id: string;
  name: string;
  description: string | null;
  kind: 'static' | 'smart';
  filters: unknown;
  owner_user_id: string | null;
  recycle_after_days: number | null;
  recycle_action: 'reassign' | 'pool' | null;
  created_at: string;
}

export interface ListMemberRow {
  contact_id: string;
  opportunity_id: string | null;
  full_name: string | null;
  phone_e164: string | null;
  email: string | null;
  language: string | null;
  lead_score: number;
  dnc: number;
  owner_user_id: string | null;
  owner_name: string | null;
  stage_key: string | null;
  project_name: string | null;
  budget_band: string | null;
  last_inbound_at: string | null;
}

function asFilter(raw: unknown): ListFilter {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as ListFilter;
    } catch {
      return {};
    }
  }
  return raw as ListFilter;
}

/**
 * The contacts in a list.
 *
 * A static list reads its members; a smart list runs its filter. Both are then
 * narrowed to what the viewer is allowed to see, in SQL — a manager browsing a
 * list built by the owner sees their team's share of it, not all of it.
 */
export async function listMembers(
  listId: string,
  visible: string[] | null,
  options: { limit?: number; offset?: number } = {},
  exec: Executor = getPool(),
): Promise<{ items: ListMemberRow[]; total: number }> {
  const list = await queryOne<ListRecord>('SELECT * FROM lists WHERE id = ?', [listId], exec);
  if (!list) throw badRequest('That list does not exist');

  const scope = ownerPredicate('c.owner_user_id', visible);
  // An unowned lead is in the pool and visible to everyone; scoping it away
  // would hide the shared queue from the people meant to work it.
  const scopeSql = visible === null ? '1=1' : `(${scope.sql} OR c.owner_user_id IS NULL)`;

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);

  const from =
    list.kind === 'smart'
      ? `FROM contacts c
         LEFT JOIN opportunities o ON o.id = (SELECT id FROM opportunities WHERE contact_id = c.id ORDER BY created_at DESC LIMIT 1)`
      : `FROM list_members lm
         JOIN contacts c ON c.id = lm.contact_id
         LEFT JOIN opportunities o ON o.id = COALESCE(lm.opportunity_id,
           (SELECT id FROM opportunities WHERE contact_id = c.id ORDER BY created_at DESC LIMIT 1))`;

  const built = list.kind === 'smart' ? buildFilter(asFilter(list.filters)) : { sql: '1=1', params: [] as SqlParam[] };
  const listParam = list.kind === 'smart' ? [] : [listId];
  const listWhere = list.kind === 'smart' ? '' : 'lm.list_id = ? AND ';

  const where = `${listWhere}${built.sql} AND ${scopeSql}`;
  const params = [...listParam, ...built.params, ...scope.params];

  const items = await query<ListMemberRow>(
    `SELECT c.id AS contact_id, o.id AS opportunity_id, c.full_name, c.phone_e164, c.email,
            c.language, c.lead_score, c.dnc, c.owner_user_id, u.name AS owner_name,
            o.stage_key, o.project_name, o.budget_band, c.last_inbound_at
     ${from}
     LEFT JOIN users u ON u.id = c.owner_user_id
     WHERE ${where}
     ORDER BY c.lead_score DESC, c.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
    exec,
  );

  const total = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n ${from} WHERE ${where}`,
    params,
    exec,
  );

  return { items, total: Number(total?.n ?? 0) };
}

export interface ResolvedListContact {
  contact_id: string;
  opportunity_id: string | null;
  owner_user_id: string | null;
  dnc: number;
  wa_id: string | null;
  consented: number;
}

/**
 * Every contact a list currently means, whichever kind it is.
 *
 * A static list is its stored members; a smart list is whatever its filter
 * matches right now. Anything that acts on "the people on this list" — a
 * campaign, a recycle, a bulk action — has to go through here, or it silently
 * finds nothing for half the lists in the system.
 *
 * Unscoped by design: a campaign covers the whole list regardless of who is
 * looking at it. Read paths that must respect the viewer use `listMembers`.
 */
export async function resolveListContacts(
  listId: string,
  exec: Executor = getPool(),
): Promise<ResolvedListContact[]> {
  const list = await queryOne<ListRecord>('SELECT * FROM lists WHERE id = ?', [listId], exec);
  if (!list) throw badRequest('That list does not exist');

  const consent = `EXISTS (SELECT 1 FROM consents cs
                            WHERE cs.contact_id = c.id AND cs.channel = 'whatsapp' AND cs.granted = 1) AS consented`;

  if (list.kind === 'smart') {
    const built = buildFilter(asFilter(list.filters));
    return query<ResolvedListContact>(
      `SELECT c.id AS contact_id, o.id AS opportunity_id, c.owner_user_id, c.dnc, c.wa_id, ${consent}
         FROM contacts c
         LEFT JOIN opportunities o
                ON o.id = (SELECT id FROM opportunities WHERE contact_id = c.id ORDER BY created_at DESC LIMIT 1)
        WHERE ${built.sql}`,
      built.params,
      exec,
    );
  }

  return query<ResolvedListContact>(
    `SELECT lm.contact_id, lm.opportunity_id, c.owner_user_id, c.dnc, c.wa_id, ${consent}
       FROM list_members lm
       JOIN contacts c ON c.id = lm.contact_id
      WHERE lm.list_id = ? AND c.merged_into_id IS NULL`,
    [listId],
    exec,
  );
}

/** Adds contacts to a static list. Adding to a smart list is meaningless. */
export async function addToList(
  actor: AuditActor,
  listId: string,
  contactIds: string[],
  exec: Executor = getPool(),
): Promise<number> {
  const list = await queryOne<{ kind: string }>('SELECT kind FROM lists WHERE id = ?', [listId], exec);
  if (!list) throw badRequest('That list does not exist');
  if (list.kind === 'smart') throw badRequest('A smart list fills itself from its filter');
  if (contactIds.length === 0) return 0;

  let added = 0;
  for (const contactId of contactIds) {
    const opportunity = await queryOne<{ id: string }>(
      'SELECT id FROM opportunities WHERE contact_id = ? ORDER BY created_at DESC LIMIT 1',
      [contactId],
      exec,
    );
    const result = await execute(
      `INSERT IGNORE INTO list_members (list_id, contact_id, opportunity_id, added_by_user_id)
       VALUES (?, ?, ?, ?)`,
      [listId, contactId, opportunity?.id ?? null, actor.userId],
      exec,
    );
    added += result.affectedRows;
  }

  await writeAudit(
    { actor, action: 'list.members_added', entityType: 'list', entityId: listId, after: { added } },
    exec,
  );
  return added;
}

export async function removeFromList(
  actor: AuditActor,
  listId: string,
  contactIds: string[],
  exec: Executor = getPool(),
): Promise<number> {
  if (contactIds.length === 0) return 0;
  const result = await execute(
    `DELETE FROM list_members WHERE list_id = ? AND contact_id IN (${contactIds.map(() => '?').join(',')})`,
    [listId, ...contactIds],
    exec,
  );
  await writeAudit(
    {
      actor,
      action: 'list.members_removed',
      entityType: 'list',
      entityId: listId,
      after: { removed: result.affectedRows },
    },
    exec,
  );
  return result.affectedRows;
}

/* ── Bulk actions ─────────────────────────────────────────────────────── */

export type BulkAction =
  | { kind: 'assign'; method: AssignmentMethod; userId?: string | null; teamId?: string | null; shares?: SplitShare[]; clauses?: AssignmentRuleClause[] }
  | { kind: 'add_tag'; tag: string }
  | { kind: 'remove_tag'; tag: string }
  | { kind: 'add_to_list'; listId: string }
  | { kind: 'remove_from_list'; listId: string };

export interface BulkResult {
  affected: number;
  detail?: Record<string, unknown>;
}

/**
 * Applies one action to a set of contacts.
 *
 * Export and delete are deliberately *not* here: the specification restricts
 * them to the owner or admin and requires each one to be logged, so they live
 * on their own endpoints with their own permission checks rather than hiding
 * behind a generic "bulk action" the UI could call with the wrong kind.
 */
export async function runBulkAction(
  actor: AuditActor,
  contactIds: string[],
  action: BulkAction,
  exec: Executor = getPool(),
): Promise<BulkResult> {
  if (contactIds.length === 0) return { affected: 0 };

  switch (action.kind) {
    case 'assign': {
      const opportunities = await query<{ id: string }>(
        `SELECT o.id FROM opportunities o
          WHERE o.contact_id IN (${contactIds.map(() => '?').join(',')}) AND o.status = 'open'`,
        contactIds,
        exec,
      );
      const result = await assign(
        actor,
        {
          method: action.method,
          userId: action.userId ?? null,
          teamId: action.teamId ?? null,
          shares: action.shares ?? [],
          clauses: action.clauses ?? [],
          opportunityIds: opportunities.map((row) => row.id),
          reason: 'bulk action',
        },
        exec,
      );
      return { affected: result.assigned + result.pooled, detail: { ...result } };
    }

    case 'add_tag': {
      const [namespace, value] = action.tag.includes(':') ? action.tag.split(/:(.+)/) : ['ops', action.tag];
      if (!namespace || !value) throw badRequest('That tag is not valid');
      for (const contactId of contactIds) await tagContact(exec, contactId, namespace, value);
      await writeAudit(
        { actor, action: 'contacts.tagged', entityType: 'contact', entityId: null, after: { tag: action.tag, count: contactIds.length } },
        exec,
      );
      return { affected: contactIds.length };
    }

    case 'remove_tag': {
      const [namespace, value] = action.tag.includes(':') ? action.tag.split(/:(.+)/) : ['ops', action.tag];
      const result = await execute(
        `DELETE ct FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
          WHERE ct.contact_id IN (${contactIds.map(() => '?').join(',')})
            AND t.namespace = ? AND t.value = ?`,
        [...contactIds, namespace, value],
        exec,
      );
      await writeAudit(
        { actor, action: 'contacts.untagged', entityType: 'contact', entityId: null, after: { tag: action.tag, count: result.affectedRows } },
        exec,
      );
      return { affected: result.affectedRows };
    }

    case 'add_to_list':
      return { affected: await addToList(actor, action.listId, contactIds, exec) };

    case 'remove_from_list':
      return { affected: await removeFromList(actor, action.listId, contactIds, exec) };

    default: {
      // Exhaustiveness: a new action added to the union without a case here
      // becomes a compile error rather than a silent no-op.
      const never: never = action;
      throw badRequest(`Unknown bulk action: ${JSON.stringify(never)}`);
    }
  }
}

/* ── Automatic recycling ──────────────────────────────────────────────── */

/**
 * Leads on a list that nobody has worked for N days go back to the pool or
 * round the team again, per the list's own setting.
 */
export async function recycleList(listId: string, exec: Executor = getPool()): Promise<number> {
  const list = await queryOne<ListRecord>('SELECT * FROM lists WHERE id = ?', [listId], exec);
  if (!list || !list.recycle_after_days || !list.recycle_action) return 0;

  const stale = await query<{ id: string }>(
    `SELECT o.id
       FROM list_members lm
       JOIN contacts c ON c.id = lm.contact_id
       JOIN opportunities o ON o.contact_id = c.id AND o.status = 'open'
      WHERE lm.list_id = ?
        AND o.owner_user_id IS NOT NULL
        AND o.first_touch_at IS NULL
        AND o.assigned_at < DATE_SUB(NOW(3), INTERVAL ? DAY)
        AND NOT EXISTS (
          SELECT 1 FROM messages m JOIN conversations cv ON cv.id = m.conversation_id
           WHERE cv.contact_id = c.id AND m.direction = 'outbound'
        )
      LIMIT 500`,
    [listId, list.recycle_after_days],
    exec,
  );
  if (stale.length === 0) return 0;

  await assign(
    SYSTEM_ACTOR,
    {
      method: list.recycle_action === 'pool' ? 'pool' : 'team_round_robin',
      opportunityIds: stale.map((row) => row.id),
      reason: `untouched for ${list.recycle_after_days} days on "${list.name}"`,
    },
    exec,
  );

  return stale.length;
}
