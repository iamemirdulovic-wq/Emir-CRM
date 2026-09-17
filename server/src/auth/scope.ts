import { query, type Executor, getPool } from '../db/client.js';
import { scopeFor, type Role } from './rbac.js';

/**
 * The set of user ids a viewer is allowed to see records for.
 * - agent: themselves
 * - manager: themselves, their direct reports, and every member of a desk they
 *   manage
 * - owner / admin / automation: unrestricted (null)
 *
 * "Their team" has two spellings in this system and both are legitimate:
 * `users.manager_id` is the reporting line, and `teams` / `team_members` are the
 * desks Phase 12 added ("Arabic desk", "Abu Dhabi team"). A manager put in
 * charge of a desk but not named as each member's manager would otherwise see an
 * empty board — and, worse, silently: every query would simply return fewer
 * rows. The union is the reading that matches the specification, so it is taken
 * here, once, rather than left for each caller to remember.
 *
 * Returning null means "no restriction"; every caller must handle it.
 */
export async function visibleUserIds(
  viewer: { id: string; role: Role },
  exec: Executor = getPool(),
): Promise<string[] | null> {
  const scope = scopeFor(viewer.role);
  if (scope === 'all') return null;
  if (scope === 'own') return [viewer.id];

  const rows = await query<{ id: string }>(
    `SELECT id FROM users WHERE manager_id = ?
      UNION
     SELECT tm.user_id AS id
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
      WHERE t.manager_user_id = ? AND t.is_active = 1`,
    [viewer.id, viewer.id],
    exec,
  );
  return [...new Set([viewer.id, ...rows.map((r) => r.id)])];
}

/**
 * Build a SQL predicate that restricts `column` to the viewer's scope.
 * Returns an always-true predicate for unrestricted viewers.
 */
export function ownerPredicate(column: string, ids: string[] | null): { sql: string; params: string[] } {
  if (ids === null) return { sql: '1=1', params: [] };
  if (ids.length === 0) return { sql: '1=0', params: [] };
  return { sql: `${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

/** True when the viewer may act on a record owned by `ownerUserId`. */
export function canActOnOwner(viewerIds: string[] | null, ownerUserId: string | null): boolean {
  if (viewerIds === null) return true;
  if (!ownerUserId) return false;
  return viewerIds.includes(ownerUserId);
}
