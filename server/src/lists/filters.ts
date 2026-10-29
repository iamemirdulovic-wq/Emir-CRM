/**
 * Smart-list filters.
 *
 * A saved list holds explicit members; a smart list holds a filter and is
 * evaluated every time it is read, so it stays current on its own.
 *
 * `buildFilter` is pure and returns a parameterised predicate. Every user value
 * goes in as a placeholder — a list filter is user input that ends up in a
 * WHERE clause, which is exactly where SQL injection lives.
 */
import { z } from 'zod';
import type { SqlParam } from '../db/client.js';

/** Stage keys, duplicated here so the schema does not drag the pipeline in. */
const STAGE_KEYS = [
  'new_lead', 'attempted_contact', 'engaged_qualified',
  'appointment_scheduled', 'deal_sent', 'won', 'lost',
] as const;

export const listFilterSchema = z.object({
  search: z.string().max(120).optional(),
  sources: z.array(z.string().max(48)).max(10).optional(),
  stages: z.array(z.enum(STAGE_KEYS)).max(7).optional(),
  tags: z.array(z.string().max(160)).max(20).optional(),
  projects: z.array(z.string().max(160)).max(20).optional(),
  languages: z.array(z.string().max(8)).max(5).optional(),
  emirates: z.array(z.string().max(32)).max(10).optional(),
  ownerUserIds: z.array(z.string().max(36)).max(50).optional(),
  /** null means "nobody owns it", which is the shared pool. */
  unassignedOnly: z.boolean().optional(),
  budgetMinAed: z.number().int().nonnegative().max(10_000_000_000).optional(),
  budgetMaxAed: z.number().int().nonnegative().max(10_000_000_000).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  /** Nobody has contacted them in this many days. */
  notContactedForDays: z.number().int().min(0).max(3650).optional(),
  /** Created in the last N days. */
  createdWithinDays: z.number().int().min(0).max(3650).optional(),
  hasWhatsAppConsent: z.boolean().optional(),
  excludeDnc: z.boolean().optional(),
});

export type ListFilter = z.infer<typeof listFilterSchema>;

export interface BuiltFilter {
  sql: string;
  params: SqlParam[];
}

/**
 * Turns a filter into a predicate over `contacts c` joined to its most recent
 * `opportunities o`. The caller owns the FROM clause; this only adds WHERE.
 */
export function buildFilter(filter: ListFilter): BuiltFilter {
  const where: string[] = ['c.merged_into_id IS NULL'];
  const params: SqlParam[] = [];

  if (filter.search) {
    where.push('(c.full_name LIKE ? OR c.phone_e164 LIKE ? OR c.email LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }

  const inClause = (column: string, values: string[] | undefined) => {
    if (!values || values.length === 0) return;
    where.push(`${column} IN (${values.map(() => '?').join(',')})`);
    params.push(...values);
  };

  inClause('o.source', filter.sources);
  inClause('o.stage_key', filter.stages);
  inClause('c.language', filter.languages);
  inClause('o.emirate', filter.emirates);

  if (filter.projects && filter.projects.length > 0) {
    // Project names in a file are spelled loosely, so match on substring.
    where.push(`(${filter.projects.map(() => 'o.project_name LIKE ?').join(' OR ')})`);
    params.push(...filter.projects.map((project) => `%${project}%`));
  }

  if (filter.tags && filter.tags.length > 0) {
    // Every tag must be present: "investor AND arabic", not either.
    for (const tag of filter.tags) {
      const [namespace, value] = tag.includes(':') ? tag.split(/:(.+)/) : [null, tag];
      where.push(
        `EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
                  WHERE ct.contact_id = c.id AND t.value = ?${namespace ? ' AND t.namespace = ?' : ''})`,
      );
      params.push(value);
      if (namespace) params.push(namespace);
    }
  }

  if (filter.unassignedOnly) {
    where.push('c.owner_user_id IS NULL');
  } else if (filter.ownerUserIds && filter.ownerUserIds.length > 0) {
    where.push(`c.owner_user_id IN (${filter.ownerUserIds.map(() => '?').join(',')})`);
    params.push(...filter.ownerUserIds);
  }

  if (filter.budgetMinAed !== undefined) {
    // Their ceiling has to reach our floor.
    where.push('o.budget_max_aed >= ?');
    params.push(filter.budgetMinAed);
  }
  if (filter.budgetMaxAed !== undefined) {
    where.push('(o.budget_min_aed IS NULL OR o.budget_min_aed <= ?)');
    params.push(filter.budgetMaxAed);
  }

  if (filter.minScore !== undefined) {
    where.push('c.lead_score >= ?');
    params.push(filter.minScore);
  }

  if (filter.notContactedForDays !== undefined) {
    /*
     * "Nobody has contacted them" means no outbound message and no first touch
     * in the window. A lead who replied recently is excluded too — they are not
     * neglected, they are in conversation.
     */
    where.push(
      `(COALESCE(o.first_touch_at, c.created_at) < DATE_SUB(NOW(3), INTERVAL ? DAY)
        AND (c.last_inbound_at IS NULL OR c.last_inbound_at < DATE_SUB(NOW(3), INTERVAL ? DAY)))`,
    );
    params.push(filter.notContactedForDays, filter.notContactedForDays);
  }

  if (filter.createdWithinDays !== undefined) {
    where.push('c.created_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)');
    params.push(filter.createdWithinDays);
  }

  if (filter.hasWhatsAppConsent) {
    where.push(
      "EXISTS (SELECT 1 FROM consents cs WHERE cs.contact_id = c.id AND cs.channel = 'whatsapp' AND cs.granted = 1)",
    );
  }

  if (filter.excludeDnc) where.push('c.dnc = 0');

  return { sql: where.join(' AND '), params };
}

/** A short human summary of a filter, for the list card. */
export function describeFilter(filter: ListFilter): string {
  const parts: string[] = [];
  if (filter.stages?.length) parts.push(`stage ${filter.stages.map((s) => s.replace(/_/g, ' ')).join(' or ')}`);
  if (filter.sources?.length) parts.push(`from ${filter.sources.join(' or ')}`);
  if (filter.projects?.length) parts.push(`interested in ${filter.projects.join(' or ')}`);
  if (filter.tags?.length) parts.push(`tagged ${filter.tags.join(' and ')}`);
  if (filter.languages?.length) parts.push(`speaking ${filter.languages.join(' or ')}`);
  if (filter.minScore !== undefined) parts.push(`scoring ${filter.minScore}+`);
  if (filter.budgetMinAed !== undefined) parts.push(`budget from AED ${filter.budgetMinAed.toLocaleString()}`);
  if (filter.notContactedForDays !== undefined) parts.push(`not contacted for ${filter.notContactedForDays} days`);
  if (filter.unassignedOnly) parts.push('unassigned');
  if (filter.hasWhatsAppConsent) parts.push('with WhatsApp consent');
  if (filter.excludeDnc) parts.push('excluding do-not-contact');
  return parts.length === 0 ? 'Everyone' : parts.join(', ');
}
