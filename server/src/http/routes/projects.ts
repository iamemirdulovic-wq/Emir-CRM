import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { actorFrom, blockUntilPasswordChanged, currentUser, requireAuth, requirePermission } from '../middleware/auth.js';
import { execute, query, queryOne } from '../../db/client.js';
import { notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { slugify } from '../../services/projects.js';
import { writeAudit, diffFields } from '../../audit/audit.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth, blockUntilPasswordChanged);

/**
 * The off-plan library.
 *
 * `verified_at` is the gate for the HARD RULE: only a verified project's price,
 * payment plan and handover date may ever reach a lead. Any edit to those
 * fields clears the verification, so a figure is never quoted on an
 * unreviewed change.
 */
const PRICE_FIELDS = ['starting_price_aed', 'price_per_sqft_aed', 'payment_plan', 'handover_date'] as const;

projectsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const includeUnverified = req.query.includeUnverified === '1';
    const items = await query(
      `SELECT id, slug, name, developer, emirate, area, unit_types, starting_price_aed, price_per_sqft_aed,
              payment_plan, handover_date, golden_visa_eligible, brochure_url, image_url,
              location_lat, location_lng, location_label, description, is_active, verified_at, updated_at
         FROM projects
        WHERE is_active = 1 ${includeUnverified ? '' : 'AND verified_at IS NOT NULL'}
        ORDER BY name`,
    );
    res.json({ items });
  }),
);

const projectSchema = z.object({
  name: z.string().min(1).max(160),
  developer: z.string().min(1).max(160),
  emirate: z.enum(['dubai', 'abu_dhabi', 'sharjah', 'ras_al_khaimah', 'ajman', 'fujairah', 'umm_al_quwain', 'other']),
  area: z.string().max(160).nullable().optional(),
  unitTypes: z.array(z.string().max(64)).max(30).optional(),
  startingPriceAed: z.number().int().positive().nullable().optional(),
  pricePerSqftAed: z.number().int().positive().nullable().optional(),
  paymentPlan: z.string().max(255).nullable().optional(),
  handoverDate: z.string().max(48).nullable().optional(),
  goldenVisaEligible: z.boolean().optional(),
  brochureUrl: z.string().url().max(1024).nullable().optional(),
  imageUrl: z.string().url().max(1024).nullable().optional(),
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLng: z.number().min(-180).max(180).nullable().optional(),
  locationLabel: z.string().max(255).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  isActive: z.boolean().optional(),
});

projectsRouter.post(
  '/',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = projectSchema.parse(req.body);
    const id = newId();

    await execute(
      `INSERT INTO projects (id, slug, name, developer, emirate, area, unit_types, starting_price_aed,
                             price_per_sqft_aed, payment_plan, handover_date, golden_visa_eligible,
                             brochure_url, image_url, location_lat, location_lng, location_label,
                             description, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        slugify(body.name),
        body.name,
        body.developer,
        body.emirate,
        body.area ?? null,
        body.unitTypes ? JSON.stringify(body.unitTypes) : null,
        body.startingPriceAed ?? null,
        body.pricePerSqftAed ?? null,
        body.paymentPlan ?? null,
        body.handoverDate ?? null,
        body.goldenVisaEligible ? 1 : 0,
        body.brochureUrl ?? null,
        body.imageUrl ?? null,
        body.locationLat ?? null,
        body.locationLng ?? null,
        body.locationLabel ?? null,
        body.description ?? null,
        body.isActive === false ? 0 : 1,
      ],
    );

    await writeAudit({ actor: actorFrom(req), action: 'project.created', entityType: 'project', entityId: id, after: body });
    // Created unverified: nothing here can be quoted to a lead until it is reviewed.
    res.status(201).json({ id, verified: false });
  }),
);

projectsRouter.patch(
  '/:id',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const body = projectSchema.partial().parse(req.body);

    const before = await queryOne<Record<string, unknown>>('SELECT * FROM projects WHERE id = ?', [id]);
    if (!before) throw notFound('Project not found');

    const patch: Record<string, unknown> = {};
    const map: Array<[keyof typeof body, string]> = [
      ['name', 'name'],
      ['developer', 'developer'],
      ['emirate', 'emirate'],
      ['area', 'area'],
      ['startingPriceAed', 'starting_price_aed'],
      ['pricePerSqftAed', 'price_per_sqft_aed'],
      ['paymentPlan', 'payment_plan'],
      ['handoverDate', 'handover_date'],
      ['brochureUrl', 'brochure_url'],
      ['imageUrl', 'image_url'],
      ['locationLat', 'location_lat'],
      ['locationLng', 'location_lng'],
      ['locationLabel', 'location_label'],
      ['description', 'description'],
    ];
    for (const [key, column] of map) {
      if (body[key] !== undefined) patch[column] = body[key];
    }
    if (body.name !== undefined) patch.slug = slugify(body.name);
    if (body.unitTypes !== undefined) patch.unit_types = JSON.stringify(body.unitTypes);
    if (body.goldenVisaEligible !== undefined) patch.golden_visa_eligible = body.goldenVisaEligible ? 1 : 0;
    if (body.isActive !== undefined) patch.is_active = body.isActive ? 1 : 0;

    // Changing a quotable figure sends the project back for re-verification.
    const touchedPrice = PRICE_FIELDS.some((f) => patch[f] !== undefined);
    if (touchedPrice) {
      patch.verified_at = null;
      patch.verified_by_user_id = null;
    }

    if (Object.keys(patch).length > 0) {
      const entries = Object.entries(patch);
      await execute(
        `UPDATE projects SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...entries.map(([, v]) => v as never), id],
      );
    }

    const diff = diffFields(before, patch);
    await writeAudit({
      actor: actorFrom(req),
      action: 'project.updated',
      entityType: 'project',
      entityId: id,
      before: diff.before,
      after: { ...diff.after, ...(touchedPrice ? { verificationCleared: true } : {}) },
    });

    res.json({ ok: true, requiresReverification: touchedPrice });
  }),
);

/** Verify a project. Only a verified project's figures can reach a lead. */
projectsRouter.post(
  '/:id/verify',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const id = String(req.params.id);
    const project = await queryOne<{ id: string; name: string }>('SELECT id, name FROM projects WHERE id = ?', [id]);
    if (!project) throw notFound('Project not found');

    await execute('UPDATE projects SET verified_at = NOW(3), verified_by_user_id = ? WHERE id = ?', [user.id, id]);
    await writeAudit({
      actor: actorFrom(req),
      action: 'project.verified',
      entityType: 'project',
      entityId: id,
      after: { verifiedBy: user.email, name: project.name },
    });
    res.json({ ok: true, verified: true });
  }),
);

projectsRouter.post(
  '/:id/unverify',
  requirePermission('projects:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    await execute('UPDATE projects SET verified_at = NULL, verified_by_user_id = NULL WHERE id = ?', [id]);
    await writeAudit({ actor: actorFrom(req), action: 'project.unverified', entityType: 'project', entityId: id });
    res.json({ ok: true, verified: false });
  }),
);
