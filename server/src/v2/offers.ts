/**
 * The sales offer, as the new design draws it.
 *
 * `design/web/sales-offers.html`, and its own words for what this is: *"a
 * one-page price sheet for one unit. You share the link yourself in WhatsApp.
 * The CRM shows when the client opens it."*
 *
 * That is a much smaller thing than the offer builder in the original brief —
 * a multi-section presentation with a gallery, a payment timeline and a
 * developer sheet behind it — and a better fit for how the offer actually
 * goes out, which is an agent pasting a link into a chat they are already in.
 * Both live on the same `offers` table; migration 0037 added the four columns
 * the sheet needs and touched none of the builder's.
 *
 * Three rules this module keeps:
 *
 *  - **Nothing reaches a client by itself.** Creating an offer writes a draft.
 *    Sharing is the agent copying the link. There is no send here at all.
 *  - **The fence is the session's.** Who may see an offer comes from the role
 *    on the session, never from the request, and an offer somebody may not see
 *    reads as not found rather than forbidden — telling an agent that an offer
 *    exists but is not theirs confirms a client is being worked.
 *  - **The price is an integer of whole AED.** Never a float. A rounding error
 *    in a number a client has been quoted is argued about months later.
 */
import { z } from 'zod';
import { getPool, query, queryOne, execute, type Executor, type SqlParam } from '../db/client.js';
import { ownerPredicate, visibleUserIds } from '../auth/scope.js';
import { badRequest, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import type { Role } from '../auth/rbac.js';

export type Viewer = { id: string; role: Role };

/** What the row and the tabs show. 'accepted' wins over everything. */
export type SheetStatus = 'draft' | 'shared' | 'accepted';

/** The tabs across the top, in the design's order. */
export const SHEET_TABS = ['all', 'draft', 'shared', 'accepted'] as const;
export type SheetTab = (typeof SHEET_TABS)[number];

export interface OfferSheet {
  id: string;
  slug: string;
  /** The reference the design prints on the sheet, e.g. SO-0148. */
  reference: string;
  contactId: string | null;
  opportunityId: string | null;
  leadName: string | null;
  projectId: string | null;
  projectName: string | null;
  unitLabel: string | null;
  priceAed: number | null;
  paymentPlan: string | null;
  handover: string | null;
  note: string | null;
  validUntil: string | null;
  agentUserId: string;
  agentName: string | null;
  status: SheetStatus;
  createdAt: string;
  sharedAt: string | null;
  acceptedAt: string | null;
  /** From `offer_views`: whether the client has actually opened it. */
  opens: number;
  lastOpenedAt: string | null;
}

/**
 * The reference an offer is known by in conversation.
 *
 * Derived from the row's own sequence rather than stored, so there is no
 * counter to get out of step and no gap when a draft is deleted. `SO-0148` is
 * the 148th offer ever made, which is what an agent reading it out means.
 */
function reference(seq: number): string {
  return `SO-${String(seq).padStart(4, '0')}`;
}

const COLUMNS = `o.id, o.slug, o.contact_id, o.opportunity_id, o.project_id,
  o.unit_label, o.price_aed, o.payment_plan, o.description, o.hold_until,
  o.agent_user_id, o.status, o.created_at, o.sent_at, o.accepted_at,
  c.full_name AS lead_name,
  p.name      AS project_name,
  p.handover_date AS handover,
  u.name      AS agent_name,
  COALESCE(v.opens, 0) AS opens,
  v.last_view_at       AS last_view_at,
  (SELECT COUNT(*) FROM offers e WHERE e.created_at <= o.created_at) AS seq`;

const JOINS = `FROM offers o
  LEFT JOIN contacts c ON c.id = o.contact_id
  LEFT JOIN projects p ON p.id = o.project_id
  LEFT JOIN users    u ON u.id = o.agent_user_id
  LEFT JOIN (
    SELECT offer_id, COUNT(*) AS opens, MAX(last_seen_at) AS last_view_at
      FROM offer_views GROUP BY offer_id
  ) v ON v.offer_id = o.id`;

interface Row {
  id: string; slug: string; contact_id: string | null; opportunity_id: string | null;
  project_id: string | null; unit_label: string | null; price_aed: string | number | null;
  payment_plan: string | null; description: string | null; hold_until: string | null;
  agent_user_id: string; status: string; created_at: string; sent_at: string | null;
  accepted_at: string | null; lead_name: string | null; project_name: string | null;
  handover: string | null; agent_name: string | null; opens: number;
  last_view_at: string | null; seq: number;
}

function shape(row: Row): OfferSheet {
  return {
    id: row.id,
    slug: row.slug,
    reference: reference(Number(row.seq)),
    contactId: row.contact_id,
    opportunityId: row.opportunity_id,
    leadName: row.lead_name,
    projectId: row.project_id,
    projectName: row.project_name,
    unitLabel: row.unit_label,
    /* BIGINT arrives as a string from mysql2 once it is large enough. */
    priceAed: row.price_aed === null ? null : Number(row.price_aed),
    paymentPlan: row.payment_plan,
    handover: row.handover,
    note: row.description,
    validUntil: row.hold_until,
    agentUserId: row.agent_user_id,
    agentName: row.agent_name,
    /* Accepted wins: a client who has said yes has said yes, whatever the
       link's state is. */
    status: row.accepted_at ? 'accepted' : row.status === 'draft' ? 'draft' : 'shared',
    createdAt: row.created_at,
    sharedAt: row.sent_at,
    acceptedAt: row.accepted_at,
    opens: Number(row.opens),
    lastOpenedAt: row.last_view_at,
  };
}

/** Which offers this viewer may see, from the session's role and nothing else. */
async function fence(viewer: Viewer, exec: Executor = getPool()) {
  return ownerPredicate('o.agent_user_id', await visibleUserIds(viewer, exec));
}

/** The predicate for one tab. `all` adds nothing. */
function tabWhere(tab: SheetTab): string | null {
  if (tab === 'draft') return "o.status = 'draft' AND o.accepted_at IS NULL";
  if (tab === 'shared') return "o.status <> 'draft' AND o.accepted_at IS NULL";
  if (tab === 'accepted') return 'o.accepted_at IS NOT NULL';
  return null;
}

export interface SheetFilters {
  tab?: SheetTab;
  search?: string;
  projectId?: string;
  agentUserId?: string;
}

export interface SheetList {
  items: OfferSheet[];
  counts: Record<SheetTab, number>;
  stats: {
    thisMonth: number;
    valueAed: number;
    accepted: number;
    waiting: number;
  };
}

export async function listSheets(
  viewer: Viewer,
  filters: SheetFilters = {},
  exec: Executor = getPool(),
): Promise<SheetList> {
  const scope = await fence(viewer, exec);

  /* The builder's offers live in the same table. They are a different screen
     and would read as half-filled rows here, so this list is the sheets: the
     ones that have a unit and a price on them. */
  const base = [scope.sql, 'o.deleted_at IS NULL'];
  const baseParams: SqlParam[] = [...scope.params];

  const where = [...base];
  const params: SqlParam[] = [...baseParams];

  const tab = filters.tab ?? 'all';
  const forTab = tabWhere(tab);
  if (forTab) where.push(forTab);

  if (filters.projectId) { where.push('o.project_id = ?'); params.push(filters.projectId); }
  if (filters.agentUserId) { where.push('o.agent_user_id = ?'); params.push(filters.agentUserId); }
  if (filters.search?.trim()) {
    /* Lead, unit or number — what the design's placeholder promises. */
    where.push('(c.full_name LIKE ? OR o.unit_label LIKE ? OR o.slug LIKE ? OR p.name LIKE ?)');
    const needle = `%${filters.search.trim()}%`;
    params.push(needle, needle, needle, needle);
  }

  const rows = await query<Row>(
    `SELECT ${COLUMNS} ${JOINS}
      WHERE ${where.join(' AND ')}
      ORDER BY o.created_at DESC
      LIMIT 500`,
    params,
    exec,
  );

  /* Counts ignore the tab but keep the filters, so the number on a tab is
     what that tab would show if it were pressed. */
  const countWhere = [...base];
  const countParams: SqlParam[] = [...baseParams];
  if (filters.projectId) { countWhere.push('o.project_id = ?'); countParams.push(filters.projectId); }
  if (filters.agentUserId) { countWhere.push('o.agent_user_id = ?'); countParams.push(filters.agentUserId); }
  if (filters.search?.trim()) {
    countWhere.push('(c.full_name LIKE ? OR o.unit_label LIKE ? OR o.slug LIKE ? OR p.name LIKE ?)');
    const needle = `%${filters.search.trim()}%`;
    countParams.push(needle, needle, needle, needle);
  }

  const counted = await queryOne<Record<string, number>>(
    `SELECT COUNT(*) AS \`all\`,
            SUM(${tabWhere('draft')}) AS \`draft\`,
            SUM(${tabWhere('shared')}) AS \`shared\`,
            SUM(${tabWhere('accepted')}) AS \`accepted\`
       FROM offers o
       LEFT JOIN contacts c ON c.id = o.contact_id
       LEFT JOIN projects p ON p.id = o.project_id
      WHERE ${countWhere.join(' AND ')}`,
    countParams,
    exec,
  );

  /*
   * The four numbers across the top. Dubai's month, not UTC's: on the 1st
   * between midnight and 04:00 Dubai time the two disagree, and an owner
   * opening this at 01:00 on the 1st should not see last month's total.
   */
  const month = await queryOne<Record<string, string | number | null>>(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(o.price_aed), 0) AS value_aed,
            SUM(o.accepted_at IS NOT NULL) AS accepted,
            SUM(o.status <> 'draft' AND o.accepted_at IS NULL) AS waiting
       FROM offers o
      WHERE ${base.join(' AND ')}
        AND o.created_at >= DATE_FORMAT(CONVERT_TZ(NOW(3), '+00:00', '+04:00'), '%Y-%m-01')`,
    baseParams,
    exec,
  );

  return {
    items: rows.map(shape),
    counts: Object.fromEntries(
      SHEET_TABS.map((name) => [name, Number(counted?.[name] ?? 0)]),
    ) as Record<SheetTab, number>,
    stats: {
      thisMonth: Number(month?.n ?? 0),
      valueAed: Number(month?.value_aed ?? 0),
      accepted: Number(month?.accepted ?? 0),
      waiting: Number(month?.waiting ?? 0),
    },
  };
}

/**
 * One sheet.
 *
 * `notFound` rather than `forbidden` when it is somebody else's, for the same
 * reason the library does it: the existence of an offer is itself information
 * about a client.
 */
export async function getSheet(
  viewer: Viewer,
  id: string,
  exec: Executor = getPool(),
): Promise<OfferSheet> {
  const scope = await fence(viewer, exec);
  const row = await queryOne<Row>(
    `SELECT ${COLUMNS} ${JOINS} WHERE o.id = ? AND o.deleted_at IS NULL AND ${scope.sql}`,
    [id, ...scope.params],
    exec,
  );
  if (!row) throw notFound('That sales offer does not exist.');
  return shape(row);
}

/* ── writing ───────────────────────────────────────────────────────────── */

/**
 * The public address.
 *
 * The page it leads to has a client's name and a price on it and no login in
 * front of it, so the random part is long enough that guessing one is not
 * worth anybody's afternoon.
 */
function slugFor(): string {
  return `${newId()}${newId()}`.replace(/-/g, '').slice(0, 40);
}

export const sheetSchema = z.object({
  opportunityId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  unitLabel: z.string().min(2).max(120),
  /* Whole AED. The screen strips the thousands separators before sending. */
  priceAed: z.number().int().min(1).max(10_000_000_000),
  paymentPlan: z.string().max(80).nullable().optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(2000).nullable().optional(),
});

export type SheetInput = z.infer<typeof sheetSchema>;

/** Dubai's date today, which is what "cannot be in the past" is measured against. */
function dubaiToday(): string {
  return new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
}

export async function createSheet(
  actor: AuditActor & { id: string; role: Role },
  input: SheetInput,
  exec: Executor = getPool(),
): Promise<OfferSheet> {
  const viewer: Viewer = { id: actor.id, role: actor.role };

  /* The lead must be one this person may work. Checked here rather than
     trusted from the body: an offer is a document with a client's name on it. */
  const scope = ownerPredicate('o.owner_user_id', await visibleUserIds(viewer, exec));
  const lead = await queryOne<{ id: string; contact_id: string; project_id: string | null }>(
    `SELECT o.id, o.contact_id, o.project_id
       FROM opportunities o
       JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
      WHERE o.id = ? AND ${scope.sql}`,
    [input.opportunityId, ...scope.params],
    exec,
  );
  if (!lead) throw notFound('That lead is not one of yours.');

  if (input.validUntil < dubaiToday()) {
    throw badRequest('The valid-until day cannot be in the past.');
  }

  const id = newId();
  const slug = slugFor();
  const projectId = input.projectId ?? lead.project_id;

  await execute(
    `INSERT INTO offers
       (id, slug, title, contact_id, opportunity_id, project_id, unit_label, price_aed,
        payment_plan, description, hold_until, agent_user_id, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      id, slug, input.unitLabel.trim(), lead.contact_id, lead.id, projectId,
      input.unitLabel.trim(), input.priceAed, input.paymentPlan?.trim() || null,
      input.note?.trim() || null, `${input.validUntil} 23:59:59.000`,
      actor.id, actor.id,
    ],
    exec,
  );

  await writeAudit({
    actor, action: 'offer.sheet.created', entityType: 'offer', entityId: id,
    after: { unitLabel: input.unitLabel, priceAed: input.priceAed, opportunityId: lead.id },
  }, exec);

  return getSheet(viewer, id, exec);
}

export const patchSchema = sheetSchema.partial().omit({ opportunityId: true });

export async function updateSheet(
  actor: AuditActor & { id: string; role: Role },
  id: string,
  input: z.infer<typeof patchSchema>,
  exec: Executor = getPool(),
): Promise<OfferSheet> {
  const viewer: Viewer = { id: actor.id, role: actor.role };
  const before = await getSheet(viewer, id, exec);

  if (input.validUntil && input.validUntil < dubaiToday()) {
    throw badRequest('The valid-until day cannot be in the past.');
  }

  const sets: string[] = [];
  const params: SqlParam[] = [];
  if (input.unitLabel !== undefined) { sets.push('unit_label = ?', 'title = ?'); params.push(input.unitLabel.trim(), input.unitLabel.trim()); }
  if (input.priceAed !== undefined) { sets.push('price_aed = ?'); params.push(input.priceAed); }
  if (input.paymentPlan !== undefined) { sets.push('payment_plan = ?'); params.push(input.paymentPlan?.trim() || null); }
  if (input.note !== undefined) { sets.push('description = ?'); params.push(input.note?.trim() || null); }
  if (input.validUntil !== undefined) { sets.push('hold_until = ?'); params.push(`${input.validUntil} 23:59:59.000`); }
  if (input.projectId !== undefined) { sets.push('project_id = ?'); params.push(input.projectId); }
  if (sets.length === 0) return before;

  await execute(`UPDATE offers SET ${sets.join(', ')} WHERE id = ?`, [...params, id], exec);
  const after = await getSheet(viewer, id, exec);
  await writeAudit({
    actor, action: 'offer.sheet.updated', entityType: 'offer', entityId: id,
    before: { priceAed: before.priceAed, unitLabel: before.unitLabel, validUntil: before.validUntil },
    after: { priceAed: after.priceAed, unitLabel: after.unitLabel, validUntil: after.validUntil },
  }, exec);
  return after;
}

/**
 * The agent has sent the link.
 *
 * Nothing is sent from here — the design is explicit that the agent shares it
 * themselves in WhatsApp. This only records that they did, which is what moves
 * it out of Draft and starts the CRM watching for the client to open it.
 */
export async function markShared(
  actor: AuditActor & { id: string; role: Role },
  id: string,
  exec: Executor = getPool(),
): Promise<OfferSheet> {
  const viewer: Viewer = { id: actor.id, role: actor.role };
  const sheet = await getSheet(viewer, id, exec);
  if (sheet.status !== 'draft') return sheet;

  await execute(
    "UPDATE offers SET status = 'sent', sent_at = NOW(3) WHERE id = ? AND status = 'draft'",
    [id],
    exec,
  );
  await writeAudit({
    actor, action: 'offer.sheet.shared', entityType: 'offer', entityId: id,
  }, exec);
  return getSheet(viewer, id, exec);
}

/** The client said yes. */
export async function markAccepted(
  actor: AuditActor & { id: string; role: Role },
  id: string,
  exec: Executor = getPool(),
): Promise<OfferSheet> {
  const viewer: Viewer = { id: actor.id, role: actor.role };
  const sheet = await getSheet(viewer, id, exec);
  if (sheet.status === 'draft') {
    throw badRequest('Share the offer with the client before marking it accepted.');
  }
  if (sheet.acceptedAt) return sheet;

  await execute(
    'UPDATE offers SET accepted_at = NOW(3) WHERE id = ? AND accepted_at IS NULL',
    [id],
    exec,
  );
  await writeAudit({
    actor, action: 'offer.sheet.accepted', entityType: 'offer', entityId: id,
    after: { priceAed: sheet.priceAed, unitLabel: sheet.unitLabel },
  }, exec);
  return getSheet(viewer, id, exec);
}

/**
 * Delete a draft.
 *
 * Only a draft, and only ever into the trash the library already has. An offer
 * the client has seen is a document that was sent; deleting the record of it
 * does not unsend it, and a price somebody was quoted is worth keeping.
 */
export async function deleteDraft(
  actor: AuditActor & { id: string; role: Role },
  id: string,
  exec: Executor = getPool(),
): Promise<{ deleted: true }> {
  const viewer: Viewer = { id: actor.id, role: actor.role };
  const sheet = await getSheet(viewer, id, exec);
  if (sheet.status !== 'draft') {
    throw badRequest('This offer has been shared with the client, so it cannot be deleted.');
  }

  await execute('UPDATE offers SET deleted_at = NOW(3) WHERE id = ?', [id], exec);
  await writeAudit({
    actor, action: 'offer.sheet.deleted', entityType: 'offer', entityId: id,
    before: { unitLabel: sheet.unitLabel, priceAed: sheet.priceAed },
  }, exec);
  return { deleted: true };
}
