/**
 * The off-plan library: projects, their inventory and their payment plans.
 *
 * This sits beside `projects.ts` rather than inside it. That file is the *read*
 * path the WhatsApp workflows use — deliberately narrow, verified-only, and
 * unchanged by any of this. This one is the editing side: what the library
 * screen and the Add-project wizard call.
 *
 * The rule both halves share: a figure that is not in `units` or `projects` is
 * not quoted. Nothing here derives, rounds or infers a price.
 */
import { execute, getPool, query, queryOne, withTransaction, type Executor, type SqlParam } from '../db/client.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { slugify } from './projects.js';

export type SaleStatus = 'selling_now' | 'coming_soon' | 'sold_out';
export type UnitStatus = 'available' | 'on_hold' | 'reserved' | 'sold';
export type Visibility = 'private' | 'team' | 'public';

export type LibraryCard = {
  id: string;
  slug: string;
  name: string;
  developer: string;
  developer_id: string | null;
  emirate: string;
  community: string | null;
  property_type: string | null;
  sale_status: SaleStatus;
  starting_price_aed: number | null;
  handover_date: string | null;
  payment_plan: string | null;
  image_url: string | null;
  visibility: Visibility;
  starred: number;
  verified_at: string | null;
  archived_at: string | null;
  /** Live from `units`, not a stored counter that could drift. */
  units_available: number;
  units_total: number;
};

const CARD_COLUMNS = `p.id, p.slug, p.name, p.developer, p.developer_id, p.emirate, p.community,
  p.property_type, p.sale_status, p.starting_price_aed, p.handover_date, p.payment_plan,
  p.image_url, p.visibility, p.starred, p.verified_at, p.archived_at`;

export type LibraryFilters = {
  emirate?: string;
  status?: SaleStatus;
  starred?: boolean;
  search?: string;
  includeArchived?: boolean;
};

/**
 * The library screen.
 *
 * Archived projects are hidden unless asked for: archiving exists so a project
 * can leave the list without taking its leads and offers with it.
 */
export async function listLibrary(filters: LibraryFilters = {}, exec: Executor = getPool()): Promise<LibraryCard[]> {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (!filters.includeArchived) where.push('p.archived_at IS NULL');
  if (filters.emirate) { where.push('p.emirate = ?'); params.push(filters.emirate); }
  if (filters.status) { where.push('p.sale_status = ?'); params.push(filters.status); }
  if (filters.starred) where.push('p.starred = 1');
  if (filters.search?.trim()) {
    // Name, developer or community — the three things an agent actually types.
    where.push('(p.name LIKE ? OR p.developer LIKE ? OR p.community LIKE ?)');
    const needle = `%${filters.search.trim()}%`;
    params.push(needle, needle, needle);
  }

  return query<LibraryCard>(
    `SELECT ${CARD_COLUMNS},
            COALESCE(u.available, 0) AS units_available,
            COALESCE(u.total, 0)     AS units_total
       FROM projects p
       LEFT JOIN (
         SELECT project_id,
                SUM(status = 'available') AS available,
                COUNT(*)                  AS total
           FROM units GROUP BY project_id
       ) u ON u.project_id = p.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.starred DESC, p.name ASC
      LIMIT 500`,
    params,
    exec,
  );
}

export async function getProject(id: string, exec: Executor = getPool()): Promise<Record<string, unknown>> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT p.*, d.short_name AS developer_name, d.orn AS developer_orn, d.escrow_bank AS developer_escrow
       FROM projects p LEFT JOIN developers d ON d.id = p.developer_id
      WHERE p.id = ?`,
    [id],
    exec,
  );
  if (!row) throw notFound('That project does not exist');
  return row;
}

/* ── Creating and editing a project ─────────────────────────────────────── */

export type ProjectInput = {
  name: string;
  developerId?: string | null;
  /** Free text, kept in step with the linked developer's short name. */
  developer?: string | null;
  emirate: string;
  community?: string | null;
  propertyType?: string | null;
  saleStatus?: SaleStatus;
  startingPriceAed?: number | null;
  handoverDate?: string | null;
  paymentPlan?: string | null;
  reraNo?: string | null;
  escrowAccount?: string | null;
  ownership?: string | null;
  serviceChargeSqft?: number | null;
  goldenVisaThresholdAed?: number | null;
  constructionPct?: number | null;
  description?: string | null;
  buyerProfile?: string | null;
  marketingCopy?: string | null;
  brochureUrl?: string | null;
  imageUrl?: string | null;
  coverStyle?: string | null;
  visibility?: Visibility;
  goldenVisaEligible?: boolean;
};

async function uniqueSlug(base: string, exec: Executor, ignoreId?: string): Promise<string> {
  const root = slugify(base) || 'project';
  for (let n = 0; n < 50; n += 1) {
    const candidate = n === 0 ? root : `${root}-${n + 1}`;
    const clash = await queryOne<{ id: string }>('SELECT id FROM projects WHERE slug = ? LIMIT 1', [candidate], exec);
    if (!clash || clash.id === ignoreId) return candidate;
  }
  return `${root}-${Date.now()}`;
}

/**
 * Is there already a project by this name? Used by the wizard's duplicate
 * check, which is a button rather than a hard block — "Phase 2" legitimately
 * exists alongside "Phase 1".
 */
export async function findSimilarProjects(name: string, exec: Executor = getPool()): Promise<LibraryCard[]> {
  const needle = name.trim();
  if (needle.length < 3) return [];
  return query<LibraryCard>(
    `SELECT ${CARD_COLUMNS}, 0 AS units_available, 0 AS units_total
       FROM projects p WHERE p.name LIKE ? LIMIT 10`,
    [`%${needle}%`],
    exec,
  );
}

const PROJECT_COLUMNS: Record<keyof ProjectInput, string> = {
  name: 'name',
  developerId: 'developer_id',
  developer: 'developer',
  emirate: 'emirate',
  community: 'community',
  propertyType: 'property_type',
  saleStatus: 'sale_status',
  startingPriceAed: 'starting_price_aed',
  handoverDate: 'handover_date',
  paymentPlan: 'payment_plan',
  reraNo: 'rera_no',
  escrowAccount: 'escrow_account',
  ownership: 'ownership',
  serviceChargeSqft: 'service_charge_sqft',
  goldenVisaThresholdAed: 'golden_visa_threshold_aed',
  constructionPct: 'construction_pct',
  description: 'description',
  buyerProfile: 'buyer_profile',
  marketingCopy: 'marketing_copy',
  brochureUrl: 'brochure_url',
  imageUrl: 'image_url',
  coverStyle: 'cover_style',
  visibility: 'visibility',
  goldenVisaEligible: 'golden_visa_eligible',
};

/** The developer's display name, so the text column never drifts from the link. */
async function developerName(developerId: string | null | undefined, exec: Executor): Promise<string | null> {
  if (!developerId) return null;
  const row = await queryOne<{ short_name: string }>('SELECT short_name FROM developers WHERE id = ?', [developerId], exec);
  return row?.short_name ?? null;
}

export async function createProject(
  actor: AuditActor,
  input: ProjectInput,
  exec: Executor = getPool(),
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw badRequest('A project needs a name');

  const linked = await developerName(input.developerId, exec);
  const developer = (linked ?? input.developer ?? '').trim();
  if (!developer) throw badRequest('Choose a developer, or type the developer name');

  const id = newId();
  const slug = await uniqueSlug(name, exec);

  await execute(
    `INSERT INTO projects (id, slug, name, developer, developer_id, emirate, community, property_type,
                           sale_status, starting_price_aed, handover_date, payment_plan, rera_no,
                           escrow_account, ownership, service_charge_sqft, golden_visa_threshold_aed,
                           construction_pct, description, buyer_profile, marketing_copy, brochure_url,
                           image_url, cover_style, visibility, golden_visa_eligible)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, slug, name, developer, input.developerId ?? null, input.emirate,
      input.community ?? null, input.propertyType ?? null, input.saleStatus ?? 'selling_now',
      input.startingPriceAed ?? null, input.handoverDate ?? null, input.paymentPlan ?? null,
      input.reraNo ?? null, input.escrowAccount ?? null, input.ownership ?? null,
      input.serviceChargeSqft ?? null, input.goldenVisaThresholdAed ?? null,
      input.constructionPct ?? null, input.description ?? null, input.buyerProfile ?? null,
      input.marketingCopy ?? null, input.brochureUrl ?? null, input.imageUrl ?? null,
      input.coverStyle ?? null, input.visibility ?? 'private',
      input.goldenVisaEligible ? 1 : 0,
    ],
    exec,
  );

  await writeAudit(
    { actor, action: 'project.created', entityType: 'project', entityId: id, after: { name, developer, emirate: input.emirate } },
    exec,
  );
  return id;
}

export async function updateProject(
  actor: AuditActor,
  id: string,
  patch: Partial<ProjectInput>,
  exec: Executor = getPool(),
): Promise<void> {
  const before = await getProject(id, exec);

  const columns: string[] = [];
  const params: SqlParam[] = [];
  const after: Record<string, unknown> = {};

  for (const [key, column] of Object.entries(PROJECT_COLUMNS) as [keyof ProjectInput, string][]) {
    const value = patch[key];
    if (value === undefined) continue;
    columns.push(`${column} = ?`);
    params.push(
      (typeof value === 'boolean' ? (value ? 1 : 0) : typeof value === 'string' ? value.trim() || null : value) as SqlParam,
    );
    after[column] = value;
  }

  // Changing the linked developer rewrites the text column with it, so the
  // WhatsApp replies that read `projects.developer` stay correct.
  if (patch.developerId !== undefined) {
    const linked = await developerName(patch.developerId, exec);
    if (linked) {
      columns.push('developer = ?');
      params.push(linked);
      after.developer = linked;
    }
  }
  if (columns.length === 0) return;

  await execute(`UPDATE projects SET ${columns.join(', ')} WHERE id = ?`, [...params, id], exec);
  await writeAudit(
    { actor, action: 'project.updated', entityType: 'project', entityId: id, before: { name: before.name }, after },
    exec,
  );
}

export async function setStarred(actor: AuditActor, id: string, starred: boolean, exec: Executor = getPool()): Promise<void> {
  await execute('UPDATE projects SET starred = ? WHERE id = ?', [starred ? 1 : 0, id], exec);
  await writeAudit({ actor, action: starred ? 'project.starred' : 'project.unstarred', entityType: 'project', entityId: id }, exec);
}

/**
 * Archive, which is what the delete dialog recommends instead.
 *
 * The project leaves the library and stops being offered, and every lead,
 * offer and Won deal that points at it is untouched.
 */
export async function archiveProject(actor: AuditActor, id: string, archived: boolean, exec: Executor = getPool()): Promise<void> {
  const before = await getProject(id, exec);
  await execute(
    'UPDATE projects SET archived_at = ?, archived_by_user_id = ? WHERE id = ?',
    [archived ? new Date() : null, archived ? actor.userId : null, id],
    exec,
  );
  await writeAudit(
    { actor, action: archived ? 'project.archived' : 'project.unarchived', entityType: 'project', entityId: id, before: { name: before.name } },
    exec,
  );
}

/**
 * Delete, for real.
 *
 * The caller has to send the project's exact name back, which is what the
 * type-the-name confirmation in the UI collects. Checking it here as well is
 * the point: the dialog can be bypassed, this cannot.
 */
export async function deleteProject(
  actor: AuditActor,
  id: string,
  typedName: string,
  exec: Executor = getPool(),
): Promise<void> {
  const before = await getProject(id, exec);
  if (typedName.trim() !== String(before.name).trim()) {
    throw badRequest('Type the project name exactly to confirm the deletion');
  }
  if (actor.role !== 'owner' && actor.role !== 'admin') {
    throw forbidden('Only the owner or an admin can delete a project');
  }

  /*
   * Leads keep the project as text on the opportunity, so deleting the row
   * never orphans a lead — `opportunities.project_name` is a string, not a
   * foreign key. Units, plans, media, documents and the rest cascade.
   */
  await execute('DELETE FROM projects WHERE id = ?', [id], exec);
  await writeAudit(
    {
      actor, action: 'project.deleted', entityType: 'project', entityId: id,
      before: { name: before.name, developer: before.developer, slug: before.slug },
    },
    exec,
  );
}

/* ── Units ──────────────────────────────────────────────────────────────── */

export type UnitRow = {
  id: string;
  project_id: string;
  unit_no: string;
  unit_type: string | null;
  bedrooms: number | null;
  floor: string | null;
  internal_area_sqft: string | null;
  balcony_sqft: string | null;
  view_text: string | null;
  parking: number | null;
  price_aed: number | null;
  price_per_sqft_aed: number | null;
  status: UnitStatus;
};

export async function listUnits(projectId: string, exec: Executor = getPool()): Promise<UnitRow[]> {
  return query<UnitRow>(
    `SELECT id, project_id, unit_no, unit_type, bedrooms, floor, internal_area_sqft, balcony_sqft,
            view_text, parking, price_aed, price_per_sqft_aed, status
       FROM units WHERE project_id = ? ORDER BY unit_no ASC LIMIT 5000`,
    [projectId],
    exec,
  );
}

export type UnitInput = {
  unitNo: string;
  unitType?: string | null;
  bedrooms?: number | null;
  floor?: string | null;
  internalAreaSqft?: number | null;
  balconySqft?: number | null;
  view?: string | null;
  parking?: number | null;
  priceAed?: number | null;
  pricePerSqftAed?: number | null;
  status?: UnitStatus;
};

/**
 * Add or replace a batch of units, as one price version.
 *
 * Upserted on (project, unit no.) so re-importing a developer's updated sheet
 * revises the rows rather than creating a second unit 1204. Every batch gets a
 * version row, so an offer can always say which price list it quoted.
 */
export async function importUnits(
  actor: AuditActor,
  projectId: string,
  units: UnitInput[],
  options: { label: string; sourceFile?: string | null; note?: string | null } = { label: 'Manual entry' },
): Promise<{ versionId: string; written: number }> {
  if (units.length === 0) throw badRequest('There are no units to import');

  return withTransaction(async (tx) => {
    await getProject(projectId, tx);

    const versionId = newId();
    await execute(
      `INSERT INTO unit_price_versions (id, project_id, label, source_file, note, imported_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [versionId, projectId, options.label, options.sourceFile ?? null, options.note ?? null, actor.userId],
      tx,
    );

    let written = 0;
    for (const unit of units) {
      const unitNo = unit.unitNo?.trim();
      if (!unitNo) continue;
      await execute(
        `INSERT INTO units (id, project_id, price_version_id, unit_no, unit_type, bedrooms, floor,
                            internal_area_sqft, balcony_sqft, view_text, parking, price_aed,
                            price_per_sqft_aed, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           price_version_id = VALUES(price_version_id),
           unit_type = VALUES(unit_type), bedrooms = VALUES(bedrooms), floor = VALUES(floor),
           internal_area_sqft = VALUES(internal_area_sqft), balcony_sqft = VALUES(balcony_sqft),
           view_text = VALUES(view_text), parking = VALUES(parking),
           price_aed = VALUES(price_aed), price_per_sqft_aed = VALUES(price_per_sqft_aed),
           status = VALUES(status)`,
        [
          newId(), projectId, versionId, unitNo, unit.unitType ?? null, unit.bedrooms ?? null,
          unit.floor ?? null, unit.internalAreaSqft ?? null, unit.balconySqft ?? null,
          unit.view ?? null, unit.parking ?? null, unit.priceAed ?? null,
          unit.pricePerSqftAed ?? null, unit.status ?? 'available',
        ],
        tx,
      );
      written += 1;
    }

    await writeAudit(
      {
        actor, action: 'project.units_imported', entityType: 'project', entityId: projectId,
        after: { versionId, label: options.label, units: written },
      },
      tx,
    );
    return { versionId, written };
  });
}

/** Change one unit's status — the thing that happens when a client reserves. */
export async function setUnitStatus(
  actor: AuditActor,
  unitId: string,
  status: UnitStatus,
  exec: Executor = getPool(),
): Promise<void> {
  const before = await queryOne<{ project_id: string; unit_no: string; status: string }>(
    'SELECT project_id, unit_no, status FROM units WHERE id = ?',
    [unitId],
    exec,
  );
  if (!before) throw notFound('That unit does not exist');

  await execute('UPDATE units SET status = ? WHERE id = ?', [status, unitId], exec);
  await writeAudit(
    {
      actor, action: 'project.unit_status_changed', entityType: 'project', entityId: before.project_id,
      before: { unit: before.unit_no, status: before.status }, after: { unit: before.unit_no, status },
    },
    exec,
  );
}

export async function deleteUnit(actor: AuditActor, unitId: string, exec: Executor = getPool()): Promise<void> {
  const before = await queryOne<{ project_id: string; unit_no: string }>(
    'SELECT project_id, unit_no FROM units WHERE id = ?', [unitId], exec,
  );
  if (!before) throw notFound('That unit does not exist');
  await execute('DELETE FROM units WHERE id = ?', [unitId], exec);
  await writeAudit(
    { actor, action: 'project.unit_deleted', entityType: 'project', entityId: before.project_id, before: { unit: before.unit_no } },
    exec,
  );
}

/* ── Payment plans ──────────────────────────────────────────────────────── */

export type PlanRow = { id: string; seq: number; milestone: string; percent: string; due_note: string | null };
export type PaymentPlan = { id: string; project_id: string; name: string; is_default: number; note: string | null; rows: PlanRow[] };

export async function listPaymentPlans(projectId: string, exec: Executor = getPool()): Promise<PaymentPlan[]> {
  const plans = await query<Omit<PaymentPlan, 'rows'>>(
    'SELECT id, project_id, name, is_default, note FROM payment_plans WHERE project_id = ? ORDER BY is_default DESC, name ASC',
    [projectId],
    exec,
  );
  if (plans.length === 0) return [];

  const rows = await query<PlanRow & { plan_id: string }>(
    `SELECT id, plan_id, seq, milestone, percent, due_note FROM payment_plan_rows
      WHERE plan_id IN (${plans.map(() => '?').join(',')}) ORDER BY seq ASC`,
    plans.map((plan) => plan.id),
    exec,
  );

  return plans.map((plan) => ({ ...plan, rows: rows.filter((row) => row.plan_id === plan.id) }));
}

export type PlanInput = {
  name: string;
  isDefault?: boolean;
  note?: string | null;
  rows: { milestone: string; percent: number; dueNote?: string | null }[];
};

/**
 * Save a payment plan and its milestones together.
 *
 * The percentages are *not* forced to total 100: developers publish plans that
 * do not, because a DLD fee or a service-charge year sits outside the schedule.
 * The total is shown in the UI so a person can see it; refusing to save it
 * would just mean the plan lives on paper instead of in the CRM.
 */
export async function savePaymentPlan(
  actor: AuditActor,
  projectId: string,
  input: PlanInput,
  planId?: string,
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw badRequest('A payment plan needs a name');

  return withTransaction(async (tx) => {
    await getProject(projectId, tx);
    const id = planId ?? newId();

    if (planId) {
      await execute('UPDATE payment_plans SET name = ?, is_default = ?, note = ? WHERE id = ? AND project_id = ?',
        [name, input.isDefault ? 1 : 0, input.note ?? null, planId, projectId], tx);
      await execute('DELETE FROM payment_plan_rows WHERE plan_id = ?', [planId], tx);
    } else {
      await execute('INSERT INTO payment_plans (id, project_id, name, is_default, note) VALUES (?, ?, ?, ?, ?)',
        [id, projectId, name, input.isDefault ? 1 : 0, input.note ?? null], tx);
    }

    // Only one default per project, or the offer builder has to guess.
    if (input.isDefault) {
      await execute('UPDATE payment_plans SET is_default = 0 WHERE project_id = ? AND id <> ?', [projectId, id], tx);
    }

    let seq = 0;
    for (const row of input.rows) {
      if (!row.milestone?.trim()) continue;
      seq += 1;
      await execute(
        'INSERT INTO payment_plan_rows (id, plan_id, seq, milestone, percent, due_note) VALUES (?, ?, ?, ?, ?, ?)',
        [newId(), id, seq, row.milestone.trim(), row.percent, row.dueNote ?? null],
        tx,
      );
    }

    await writeAudit(
      { actor, action: planId ? 'project.plan_updated' : 'project.plan_created', entityType: 'project', entityId: projectId, after: { name, milestones: seq } },
      tx,
    );
    return id;
  });
}

export async function deletePaymentPlan(actor: AuditActor, planId: string, exec: Executor = getPool()): Promise<void> {
  const before = await queryOne<{ project_id: string; name: string }>(
    'SELECT project_id, name FROM payment_plans WHERE id = ?', [planId], exec,
  );
  if (!before) throw notFound('That payment plan does not exist');
  await execute('DELETE FROM payment_plans WHERE id = ?', [planId], exec);
  await writeAudit(
    { actor, action: 'project.plan_deleted', entityType: 'project', entityId: before.project_id, before: { name: before.name } },
    exec,
  );
}

/* ── The four KPI cards ─────────────────────────────────────────────────── */

export type LibraryStats = {
  mostLeads: { project_name: string; leads: number } | null;
  trending: { project_name: string; rise_pct: number } | null;
  bestConverting: { project_name: string; rate_pct: number; deals: number } | null;
  inventory: { available: number; value_aed: number; top: { name: string; available: number }[] };
};

/**
 * Real numbers for the four cards at the top of the library.
 *
 * Every one is a query over `opportunities` and `units`. A card with nothing
 * behind it returns null and the screen says so, rather than a zero that reads
 * like a fact.
 *
 * The aggregates are repeated in HAVING and ORDER BY rather than referenced by
 * their aliases. MySQL allows the alias; MariaDB rejects it with "reference to
 * group function", and the live database is MariaDB — which is exactly how
 * this endpoint first went out returning a 500.
 */
export async function libraryStats(exec: Executor = getPool()): Promise<LibraryStats> {
  const WEEK = 'DATE_SUB(NOW(), INTERVAL 7 DAY)';
  const FORTNIGHT = 'DATE_SUB(NOW(), INTERVAL 14 DAY)';
  const THIS_WEEK = `SUM(created_at >= ${WEEK})`;
  const LAST_WEEK = `SUM(created_at < ${WEEK} AND created_at >= ${FORTNIGHT})`;

  const [leaders, trending, converting, inventory, topStock] = await Promise.all([
    query<{ project_name: string; leads: number }>(
      `SELECT project_name, COUNT(*) AS leads
         FROM opportunities
        WHERE project_name IS NOT NULL AND project_name <> ''
          AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY project_name ORDER BY COUNT(*) DESC LIMIT 1`,
      [],
      exec,
    ),
    query<{ project_name: string; this_week: number; last_week: number }>(
      `SELECT project_name, ${THIS_WEEK} AS this_week, ${LAST_WEEK} AS last_week
         FROM opportunities
        WHERE project_name IS NOT NULL AND project_name <> ''
          AND created_at >= ${FORTNIGHT}
        GROUP BY project_name
       HAVING ${LAST_WEEK} > 0 AND ${THIS_WEEK} > ${LAST_WEEK}
        ORDER BY (${THIS_WEEK} - ${LAST_WEEK}) / ${LAST_WEEK} DESC LIMIT 1`,
      [],
      exec,
    ),
    query<{ project_name: string; leads: number; won: number }>(
      `SELECT project_name, COUNT(*) AS leads, SUM(stage_key = 'won') AS won
         FROM opportunities
        WHERE project_name IS NOT NULL AND project_name <> ''
        GROUP BY project_name
       HAVING COUNT(*) >= 5 AND SUM(stage_key = 'won') > 0
        ORDER BY SUM(stage_key = 'won') / COUNT(*) DESC LIMIT 1`,
      [],
      exec,
    ),
    query<{ available: number; value: number }>(
      `SELECT COUNT(*) AS available, COALESCE(SUM(price_aed), 0) AS value
         FROM units WHERE status = 'available'`,
      [],
      exec,
    ),
    query<{ name: string; available: number }>(
      `SELECT p.name, COUNT(*) AS available
         FROM units u JOIN projects p ON p.id = u.project_id
        WHERE u.status = 'available' AND p.archived_at IS NULL
        GROUP BY p.id, p.name ORDER BY COUNT(*) DESC LIMIT 3`,
      [],
      exec,
    ),
  ]);

  const rise = trending[0]
    ? Math.round(((Number(trending[0].this_week) - Number(trending[0].last_week)) / Number(trending[0].last_week)) * 100)
    : 0;

  return {
    mostLeads: leaders[0] ? { project_name: leaders[0].project_name, leads: Number(leaders[0].leads) } : null,
    trending: trending[0] ? { project_name: trending[0].project_name, rise_pct: rise } : null,
    bestConverting: converting[0]
      ? {
          project_name: converting[0].project_name,
          rate_pct: Number(((Number(converting[0].won) / Number(converting[0].leads)) * 100).toFixed(1)),
          deals: Number(converting[0].won),
        }
      : null,
    inventory: {
      available: Number(inventory[0]?.available ?? 0),
      value_aed: Number(inventory[0]?.value ?? 0),
      top: topStock.map((row) => ({ name: row.name, available: Number(row.available) })),
    },
  };
}
