/**
 * The project library and the developers behind it.
 *
 * Separate from `projects.ts`, which stays as it is: that router serves the
 * narrow verified list the WhatsApp workflows read, and breaking it would take
 * the live auto-replies down with it.
 *
 * Who may do what, enforced here and not only in the UI:
 *  - anyone signed in may read the library and build offers from it
 *  - `projects:manage` (owner, admin, manager) may add, edit and import
 *  - owner/admin only may delete, and only with the project's name typed back
 *  - commission and developer terms never leave the server for an agent
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAdmin, requireAuth, requirePermission,
} from '../middleware/auth.js';
import {
  addDeveloperContact, createDeveloper, deleteDeveloper, developerContacts, getDeveloper,
  listDevelopers, publicDeveloper, removeDeveloperContact, updateDeveloper,
} from '../../services/developers.js';
import {
  archiveProject, createProject, deleteProject, deletePaymentPlan, deleteUnit, findSimilarProjects,
  getProject, importUnits, libraryStats, listLibrary, listPaymentPlans, listUnits, savePaymentPlan,
  setStarred, setUnitStatus, updateProject, type SaleStatus,
} from '../../services/project-library.js';
import { query, queryOne, execute } from '../../db/client.js';
import { writeAudit } from '../../audit/audit.js';
import { newId } from '../../lib/ids.js';
import { badRequest } from '../../lib/errors.js';
import { extractProject } from '../../ai/extract-project.js';
import { extractDeveloper } from '../../ai/extract-developer.js';

export const libraryRouter = Router();
libraryRouter.use(requireAuth, blockUntilPasswordChanged);

/** True for the roles allowed to see our commission and the developer's terms. */
function canSeeCommercials(role: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

/** Reading a document is the most expensive call the CRM makes, so it is bounded. */
const extractLimit = rateLimit({
  max: 20,
  windowMs: 15 * 60 * 1000,
  keyFor: (req) => `project-extract:${currentUser(req).id}`,
  message: 'Too many documents read in a short time. Please wait a few minutes.',
});

/* ── Developers ─────────────────────────────────────────────────────────── */

libraryRouter.get(
  '/developers',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const items = await listDevelopers();
    // An agent gets the developer without the commercial terms.
    res.json({ items: canSeeCommercials(user.role) ? items : items.map((row) => ({ ...publicDeveloper(row), project_count: row.project_count, contact_count: row.contact_count })) });
  }),
);

libraryRouter.get(
  '/developers/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const developer = await getDeveloper(String(req.params.id));
    /*
     * The developer's own sales people are an internal contact book — their
     * direct mobiles. Agents need them to do the job, so they are shown; what
     * agents do not get is what we are paid.
     */
    const contacts = await developerContacts(developer.id);
    res.json({
      developer: canSeeCommercials(user.role) ? developer : publicDeveloper(developer),
      contacts,
    });
  }),
);

const developerSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  shortName: z.string().trim().max(120).nullable().optional(),
  orn: z.string().trim().max(64).nullable().optional(),
  trn: z.string().trim().max(64).nullable().optional(),
  headOffice: z.string().trim().max(255).nullable().optional(),
  escrowBank: z.string().trim().max(160).nullable().optional(),
  logoUrl: z.string().trim().max(1024).nullable().optional(),
  website: z.string().trim().max(255).nullable().optional(),
  commissionPct: z.number().min(0).max(100).nullable().optional(),
  paymentTerms: z.string().trim().max(255).nullable().optional(),
  agreementDate: z.string().max(10).nullable().optional(),
  avgDaysToPay: z.number().int().min(0).max(3650).nullable().optional(),
  trackRecord: z.string().max(5000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

libraryRouter.post(
  '/developers',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = await createDeveloper(actorFrom(req), developerSchema.parse(req.body));
    res.status(201).json({ id });
  }),
);

libraryRouter.patch(
  '/developers/:id',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    await updateDeveloper(actorFrom(req), String(req.params.id), developerSchema.partial().parse(req.body));
    res.json({ ok: true });
  }),
);

libraryRouter.delete(
  '/developers/:id',
  requireAdmin,
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    await deleteDeveloper(actorFrom(req), String(req.params.id));
    res.json({ ok: true });
  }),
);

/**
 * Emir AI looks a developer up from their website or name.
 *
 * Rate-limited with the document reader rather than separately: both cost
 * money per call and both are pressed from the same two screens.
 */
libraryRouter.post(
  '/developers/lookup',
  extractLimit,
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const body = z.object({ query: z.string().trim().min(2).max(255) }).parse(req.body);
    const result = await extractDeveloper(body.query, user.id);

    // A read, not a write — nothing is stored until a person presses save.
    await writeAudit({
      actor: actorFrom(req),
      action: 'developer.ai_lookup',
      entityType: 'developer',
      entityId: null,
      after: { query: body.query, model: result.model, filled: result.filled.length },
    });

    res.json(result);
  }),
);

const contactSchema = z.object({
  name: z.string().trim().min(1).max(160),
  role: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(24).nullable().optional(),
  whatsapp: z.string().trim().max(24).nullable().optional(),
  email: z.string().trim().max(255).nullable().optional(),
  isPrimary: z.boolean().optional(),
});

libraryRouter.post(
  '/developers/:id/contacts',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = await addDeveloperContact(actorFrom(req), String(req.params.id), contactSchema.parse(req.body));
    res.status(201).json({ id });
  }),
);

libraryRouter.delete(
  '/developers/contacts/:contactId',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    await removeDeveloperContact(actorFrom(req), String(req.params.contactId));
    res.json({ ok: true });
  }),
);

/* ── The library ────────────────────────────────────────────────────────── */

const listSchema = z.object({
  emirate: z.string().max(40).optional(),
  status: z.enum(['selling_now', 'coming_soon', 'sold_out']).optional(),
  starred: z.enum(['0', '1']).optional(),
  search: z.string().max(160).optional(),
  includeArchived: z.enum(['0', '1']).optional(),
});

libraryRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const options = listSchema.parse(req.query);
    const items = await listLibrary({
      ...(options.emirate ? { emirate: options.emirate } : {}),
      ...(options.status ? { status: options.status as SaleStatus } : {}),
      ...(options.starred === '1' ? { starred: true } : {}),
      ...(options.search ? { search: options.search } : {}),
      ...(options.includeArchived === '1' ? { includeArchived: true } : {}),
    });
    res.json({ items });
  }),
);

/**
 * The four KPI cards.
 *
 * Every number is a real query. "Most leads" and "best converting" read
 * `opportunities`; inventory reads `units`. Where the spec asks for offers-sent
 * counts those are reported as null until the offers table exists — a missing
 * number is shown as missing rather than invented.
 */
libraryRouter.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await libraryStats());
  }),
);

libraryRouter.get(
  '/similar',
  asyncHandler(async (req: Request, res: Response) => {
    const name = String(req.query.name ?? '');
    res.json({ items: await findSimilarProjects(name) });
  }),
);

/* ── Emir AI reads a developer file ─────────────────────────────────────── */

const EXTRACT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/**
 * Drop a developer file, get the project back as fields.
 *
 * Nothing is written. The reply is a suggestion the wizard shows with
 * confidence scores, and the owner presses the button — which is why this is a
 * POST that creates nothing and why the audit entry records a read, not a
 * change.
 */
libraryRouter.post(
  '/extract/file',
  extractLimit,
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const contentType = (req.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (!EXTRACT_TYPES.includes(contentType)) {
      throw badRequest(`${contentType || 'That file'} cannot be read. PDF or an image of the page.`);
    }

    // 20 MB: a brochure with photographs, and no more.
    const limit = 20 * 1024 * 1024;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > limit) throw badRequest('That file is larger than 20 MB. Send the price list or the offer rather than the full brochure.');
      chunks.push(chunk as Buffer);
    }
    if (size === 0) throw badRequest('That file is empty');

    const filename = decodeURIComponent(String(req.get('x-filename') ?? 'document')).slice(0, 255);
    const result = await extractProject(
      { kind: 'file', data: Buffer.concat(chunks), mimeType: contentType, filename },
      user.id,
    );

    // What was read, not what was written — nothing was.
    await writeAudit({
      actor: actorFrom(req),
      action: 'project.ai_read_document',
      entityType: 'project',
      entityId: null,
      after: { filename, model: result.model, filled: result.filled.length },
    });

    res.json(result);
  }),
);

libraryRouter.post(
  '/extract/link',
  extractLimit,
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const body = z.object({ url: z.string().trim().url().max(2048) }).parse(req.body);
    const result = await extractProject({ kind: 'link', url: body.url }, user.id);
    await writeAudit({
      actor: actorFrom(req),
      action: 'project.ai_read_link',
      entityType: 'project',
      entityId: null,
      after: { url: body.url, model: result.model, filled: result.filled.length },
    });
    res.json(result);
  }),
);

/* ── One project ────────────────────────────────────────────────────────── */

libraryRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const id = String(req.params.id);
    const [project, units, plans] = await Promise.all([getProject(id), listUnits(id), listPaymentPlans(id)]);

    // Commission is manager-and-up. Fetched only when it may be shown, so it
    // cannot leak through a response an agent could read.
    const commission = canSeeCommercials(user.role)
      ? await queryOne<Record<string, unknown>>('SELECT * FROM project_commissions WHERE project_id = ?', [id])
      : null;

    const location = await queryOne<Record<string, unknown>>(
      'SELECT * FROM project_locations WHERE project_id = ?', [id],
    );
    const amenities = await query<{ id: string; name: string; enabled: number }>(
      'SELECT id, name, enabled FROM project_amenities WHERE project_id = ? ORDER BY name', [id],
    );

    res.json({ project, units, plans, commission, location, amenities });
  }),
);

const projectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  developerId: z.string().max(36).nullable().optional(),
  developer: z.string().trim().max(160).nullable().optional(),
  emirate: z.enum(['dubai', 'abu_dhabi', 'sharjah', 'ras_al_khaimah', 'ajman', 'fujairah', 'umm_al_quwain', 'other']),
  community: z.string().trim().max(160).nullable().optional(),
  propertyType: z.enum(['apartment', 'townhouse', 'villa', 'penthouse', 'plot', 'office', 'mixed']).nullable().optional(),
  saleStatus: z.enum(['selling_now', 'coming_soon', 'sold_out']).optional(),
  startingPriceAed: z.number().int().min(0).nullable().optional(),
  handoverDate: z.string().trim().max(48).nullable().optional(),
  paymentPlan: z.string().trim().max(255).nullable().optional(),
  reraNo: z.string().trim().max(64).nullable().optional(),
  escrowAccount: z.string().trim().max(160).nullable().optional(),
  ownership: z.enum(['freehold', 'leasehold']).nullable().optional(),
  serviceChargeSqft: z.number().min(0).nullable().optional(),
  goldenVisaThresholdAed: z.number().int().min(0).nullable().optional(),
  constructionPct: z.number().int().min(0).max(100).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  buyerProfile: z.string().max(5000).nullable().optional(),
  marketingCopy: z.string().max(5000).nullable().optional(),
  brochureUrl: z.string().trim().max(1024).nullable().optional(),
  imageUrl: z.string().trim().max(1024).nullable().optional(),
  coverStyle: z.string().trim().max(32).nullable().optional(),
  visibility: z.enum(['private', 'team', 'public']).optional(),
  goldenVisaEligible: z.boolean().optional(),
});

libraryRouter.post(
  '/',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = await createProject(actorFrom(req), projectSchema.parse(req.body));
    res.status(201).json({ id });
  }),
);

libraryRouter.patch(
  '/:id',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    await updateProject(actorFrom(req), String(req.params.id), projectSchema.partial().parse(req.body));
    res.json({ ok: true });
  }),
);

libraryRouter.post(
  '/:id/star',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ starred: z.boolean() }).parse(req.body);
    await setStarred(actorFrom(req), String(req.params.id), body.starred);
    res.json({ ok: true });
  }),
);

libraryRouter.post(
  '/:id/archive',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ archived: z.boolean() }).parse(req.body);
    await archiveProject(actorFrom(req), String(req.params.id), body.archived);
    res.json({ ok: true });
  }),
);

/**
 * Delete. Owner/admin only, and the caller must send the project's exact name,
 * which is what the type-to-confirm box collects. Checked in the service too.
 */
libraryRouter.delete(
  '/:id',
  requireAdmin,
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ confirmName: z.string().min(1).max(160) }).parse(req.body);
    await deleteProject(actorFrom(req), String(req.params.id), body.confirmName);
    res.json({ ok: true });
  }),
);

/* ── Units ──────────────────────────────────────────────────────────────── */

const unitSchema = z.object({
  unitNo: z.string().trim().min(1).max(64),
  unitType: z.string().trim().max(64).nullable().optional(),
  bedrooms: z.number().int().min(0).max(20).nullable().optional(),
  floor: z.string().trim().max(24).nullable().optional(),
  internalAreaSqft: z.number().min(0).nullable().optional(),
  balconySqft: z.number().min(0).nullable().optional(),
  view: z.string().trim().max(160).nullable().optional(),
  parking: z.number().int().min(0).max(20).nullable().optional(),
  priceAed: z.number().int().min(0).nullable().optional(),
  pricePerSqftAed: z.number().int().min(0).nullable().optional(),
  status: z.enum(['available', 'on_hold', 'reserved', 'sold']).optional(),
});

/** A price list can be thousands of rows, so this one is rate-limited. */
const importLimit = rateLimit({
  max: 30,
  windowMs: 10 * 60 * 1000,
  keyFor: (req) => `unit-import:${currentUser(req).id}`,
  message: 'Too many price-list imports in a short time. Please wait a few minutes.',
});

libraryRouter.post(
  '/:id/units',
  importLimit,
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({
      units: z.array(unitSchema).min(1).max(5000),
      label: z.string().trim().max(160).default('Manual entry'),
      sourceFile: z.string().max(255).nullable().optional(),
      note: z.string().max(500).nullable().optional(),
    }).parse(req.body);

    const result = await importUnits(actorFrom(req), String(req.params.id), body.units, {
      label: body.label,
      sourceFile: body.sourceFile ?? null,
      note: body.note ?? null,
    });
    res.status(201).json(result);
  }),
);

libraryRouter.post(
  '/units/:unitId/status',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ status: z.enum(['available', 'on_hold', 'reserved', 'sold']) }).parse(req.body);
    await setUnitStatus(actorFrom(req), String(req.params.unitId), body.status);
    res.json({ ok: true });
  }),
);

libraryRouter.delete(
  '/units/:unitId',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    await deleteUnit(actorFrom(req), String(req.params.unitId));
    res.json({ ok: true });
  }),
);

/* ── Payment plans ──────────────────────────────────────────────────────── */

const planSchema = z.object({
  name: z.string().trim().min(1).max(160),
  isDefault: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
  rows: z.array(z.object({
    milestone: z.string().trim().min(1).max(200),
    percent: z.number().min(0).max(100),
    dueNote: z.string().trim().max(160).nullable().optional(),
  })).max(60),
});

libraryRouter.post(
  '/:id/plans',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const planId = await savePaymentPlan(actorFrom(req), String(req.params.id), planSchema.parse(req.body));
    res.status(201).json({ id: planId });
  }),
);

libraryRouter.put(
  '/:id/plans/:planId',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    await savePaymentPlan(actorFrom(req), String(req.params.id), planSchema.parse(req.body), String(req.params.planId));
    res.json({ ok: true });
  }),
);

libraryRouter.delete(
  '/plans/:planId',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    await deletePaymentPlan(actorFrom(req), String(req.params.planId));
    res.json({ ok: true });
  }),
);

/* ── Amenities, location and commission ─────────────────────────────────── */

libraryRouter.put(
  '/:id/amenities',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const body = z.object({ names: z.array(z.string().trim().min(1).max(120)).max(200) }).parse(req.body);
    await getProject(id);

    await execute('DELETE FROM project_amenities WHERE project_id = ?', [id]);
    for (const name of new Set(body.names)) {
      await execute('INSERT INTO project_amenities (id, project_id, name, enabled) VALUES (?, ?, ?, 1)', [newId(), id, name]);
    }
    await writeAudit({ actor: actorFrom(req), action: 'project.amenities_set', entityType: 'project', entityId: id, after: { count: body.names.length } });
    res.json({ ok: true });
  }),
);

libraryRouter.put(
  '/:id/location',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const body = z.object({
      lat: z.number().min(-90).max(90).nullable().optional(),
      lng: z.number().min(-180).max(180).nullable().optional(),
      address: z.string().max(255).nullable().optional(),
      salesCentre: z.string().max(255).nullable().optional(),
      distances: z.array(z.object({ to: z.string().max(80), minutes: z.number().int().min(0).max(600) })).max(30).optional(),
    }).parse(req.body);
    await getProject(id);

    await execute(
      `INSERT INTO project_locations (project_id, lat, lng, address, sales_centre, distances)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE lat = VALUES(lat), lng = VALUES(lng), address = VALUES(address),
                               sales_centre = VALUES(sales_centre), distances = VALUES(distances)`,
      [id, body.lat ?? null, body.lng ?? null, body.address ?? null, body.salesCentre ?? null,
       body.distances ? JSON.stringify(body.distances) : null],
    );
    await writeAudit({ actor: actorFrom(req), action: 'project.location_set', entityType: 'project', entityId: id });
    res.json({ ok: true });
  }),
);

/** Commission is manager-and-up on the way in as well as on the way out. */
libraryRouter.put(
  '/:id/commission',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const body = z.object({
      ratePct: z.number().min(0).max(100).nullable().optional(),
      paymentTerms: z.string().max(255).nullable().optional(),
      agreementDate: z.string().max(10).nullable().optional(),
      avgDaysToPay: z.number().int().min(0).max(3650).nullable().optional(),
      defaultAgentSplitPct: z.number().min(0).max(100).nullable().optional(),
      note: z.string().max(5000).nullable().optional(),
    }).parse(req.body);
    await getProject(id);

    await execute(
      `INSERT INTO project_commissions (project_id, rate_pct, payment_terms, agreement_date,
                                        avg_days_to_pay, default_agent_split_pct, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rate_pct = VALUES(rate_pct), payment_terms = VALUES(payment_terms),
                               agreement_date = VALUES(agreement_date), avg_days_to_pay = VALUES(avg_days_to_pay),
                               default_agent_split_pct = VALUES(default_agent_split_pct), note = VALUES(note)`,
      [id, body.ratePct ?? null, body.paymentTerms ?? null, body.agreementDate ?? null,
       body.avgDaysToPay ?? null, body.defaultAgentSplitPct ?? null, body.note ?? null],
    );
    await writeAudit({ actor: actorFrom(req), action: 'project.commission_set', entityType: 'project', entityId: id });
    res.json({ ok: true });
  }),
);
