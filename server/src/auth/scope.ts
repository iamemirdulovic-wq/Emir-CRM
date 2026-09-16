import { query, type Executor, getPool } from '../db/client.js';
import { scopeFor, type Role } from './rbac.js';

/**
 * The set of user ids a viewer is allowed to see records for.
 * - agent: themselves
 * - manager: themselves plus their direct reports
 * - owner / admin / automation: unrestricted (null)
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

  const reports = await query<{ id: string }>('SELECT id FROM users WHERE manager_id = ?', [viewer.id], exec);
  return [viewer.id, ...reports.map((r) => r.id)];
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
