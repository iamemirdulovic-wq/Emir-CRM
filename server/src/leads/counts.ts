import { queryOne, type Executor, getPool } from '../db/client.js';
import { ownerPredicate } from '../auth/scope.js';
import { LEAD_TABS, TABS, type LeadTab } from './tabs.js';

/**
 * How many leads are in each tab, for one person.
 *
 * This exists as its own function because three screens read it and they must
 * never disagree. A number above a list and the number on its tab coming from
 * two different queries is exactly how the live CRM came to say "419" over a
 * list of thirty rows on 11 November.
 *
 * One query with a SUM per tab, not eight COUNT(*)s: it runs on every screen
 * open, and eight passes over the same rows is seven more than the answer
 * needs.
 *
 * Every tab, "All" included, is counted through its own `TABS[tab].where`,
 * the same clause the list itself is built from. The count used to take a
 * short cut for All -- a plain `COUNT(*)` -- which quietly counted deleted
 * leads the list would never show. `lead-counts.integration.test.ts` holds
 * that line now.
 */
export type LeadCounts = Record<LeadTab, number>;

export async function leadTabCounts(
  visible: string[] | null,
  extra: { where?: string[]; args?: Array<string | number> } = {},
  exec: Executor = getPool(),
): Promise<LeadCounts> {
  const scope = ownerPredicate('o.owner_user_id', visible);
  const where = [scope.sql, ...(extra.where ?? [])];
  const args = [...scope.params, ...(extra.args ?? [])];

  const row = await queryOne<Record<string, number>>(
    `SELECT ${LEAD_TABS.map((tab) => `SUM(${TABS[tab].where}) AS \`${tab}\``).join(', ')}
       FROM opportunities o
       JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
      WHERE ${where.join(' AND ')}`,
    args,
    exec,
  );

  return Object.fromEntries(
    LEAD_TABS.map((tab) => [tab, Number(row?.[tab] ?? 0)]),
  ) as LeadCounts;
}
