import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { actorFrom, blockUntilPasswordChanged, requireAuth, requirePermission } from '../middleware/auth.js';
import { execute, query, queryOne } from '../../db/client.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { TEMPLATE_LIBRARY } from '../../messaging/templates/library.js';
import { validateTemplate } from '../../messaging/templates/validator.js';
import { seedLocalTemplates, syncTemplates } from '../../messaging/templates/sync.js';
import { writeAudit } from '../../audit/audit.js';
import type { TemplateComponent, TemplateCategory } from '../../messaging/templates/types.js';

export const templatesRouter = Router();
templatesRouter.use(requireAuth, blockUntilPasswordChanged);

templatesRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const items = await query(
      `SELECT id, name, language, category, status, provider_template_id, components, quality_score,
              rejected_reason, last_synced_at, updated_at
         FROM wa_templates ORDER BY name, language`,
    );
    res.json({
      items,
      // Templates that are not APPROVED cannot be sent outside the 24-hour window.
      blocked: (items as Array<{ status: string }>).filter((t) => t.status !== 'APPROVED').length,
    });
  }),
);

/** The day-one library as shipped, for comparison against what Meta reports. */
templatesRouter.get(
  '/library',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      items: TEMPLATE_LIBRARY.map((t) => ({ ...t, validation: validateTemplate(t) })),
    });
  }),
);

const validateSchema = z.object({
  name: z.string().min(1).max(512),
  language: z.string().min(2).max(16),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  components: z.array(z.record(z.unknown())).min(1),
});

/** Check a draft against Meta's rules before anyone submits it for review. */
templatesRouter.post(
  '/validate',
  requirePermission('templates:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = validateSchema.parse(req.body);
    const result = validateTemplate({
      name: body.name,
      language: body.language,
      category: body.category as TemplateCategory,
      components: body.components as unknown as TemplateComponent[],
    });
    res.json(result);
  }),
);

templatesRouter.post(
  '/sync',
  requirePermission('templates:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await syncTemplates();
    await writeAudit({
      actor: actorFrom(req),
      action: 'templates.synced',
      entityType: 'wa_template',
      entityId: null,
      after: { synced: result.synced, newlyBroken: result.newlyBroken.length },
    });
    res.json(result);
  }),
);

templatesRouter.post(
  '/seed-library',
  requirePermission('templates:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await seedLocalTemplates();
    await writeAudit({
      actor: actorFrom(req),
      action: 'templates.library_seeded',
      entityType: 'wa_template',
      entityId: null,
      after: result,
    });
    res.json(result);
  }),
);

const statusSchema = z.object({ status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED']) });

/**
 * Set a status by hand. Meta is the source of truth, so this exists for
 * providers that do not expose template status (Wati, Twilio) and for local
 * testing.
 */
templatesRouter.patch(
  '/:id/status',
  requirePermission('templates:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const body = statusSchema.parse(req.body);

    const before = await queryOne<{ status: string; name: string }>('SELECT status, name FROM wa_templates WHERE id = ?', [id]);
    if (!before) throw notFound('Template not found');

    await execute('UPDATE wa_templates SET status = ? WHERE id = ?', [body.status, id]);
    await writeAudit({
      actor: actorFrom(req),
      action: 'template.status_changed',
      entityType: 'wa_template',
      entityId: id,
      before: { status: before.status },
      after: { status: body.status },
    });
    res.json({ ok: true });
  }),
);

const mappingSchema = z.object({
  source: z.string().min(1).max(48),
  formId: z.string().max(64).nullable().optional(),
  externalField: z.string().min(1).max(255),
  crmField: z.string().min(1).max(80),
  transform: z.string().max(48).nullable().optional(),
  valueMap: z.record(z.string()).nullable().optional(),
  notes: z.string().max(255).nullable().optional(),
});

/** Form field mappings: how a new custom question gets into the CRM. */
templatesRouter.get(
  '/field-map/all',
  requirePermission('integrations:manage'),
  asyncHandler(async (_req: Request, res: Response) => {
    const items = await query(
      'SELECT id, source, form_id, external_field, crm_field, transform, value_map, notes, updated_at FROM form_field_map ORDER BY source, form_id, external_field',
    );
    res.json({ items });
  }),
);

templatesRouter.post(
  '/field-map',
  requirePermission('integrations:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = mappingSchema.parse(req.body);
    const id = newId();
    await execute(
      `INSERT INTO form_field_map (id, source, form_id, external_field, crm_field, transform, value_map, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE crm_field = VALUES(crm_field), transform = VALUES(transform),
                               value_map = VALUES(value_map), notes = VALUES(notes)`,
      [
        id,
        body.source,
        body.formId ?? null,
        body.externalField,
        body.crmField,
        body.transform ?? null,
        body.valueMap ? JSON.stringify(body.valueMap) : null,
        body.notes ?? null,
      ],
    );
    await writeAudit({ actor: actorFrom(req), action: 'field_map.upserted', entityType: 'form_field_map', entityId: id, after: body });
    res.status(201).json({ id });
  }),
);

templatesRouter.delete(
  '/field-map/:id',
  requirePermission('integrations:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const result = await execute('DELETE FROM form_field_map WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw badRequest('That mapping does not exist');
    await writeAudit({ actor: actorFrom(req), action: 'field_map.deleted', entityType: 'form_field_map', entityId: id });
    res.json({ ok: true });
  }),
);

/**
 * Questions that arrived on a lead form with no mapping yet. This is the
 * worklist that keeps custom questions out of the code.
 */
templatesRouter.get(
  '/field-map/unmapped',
  requirePermission('integrations:manage'),
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await query<{ raw_payload: unknown; external_id: string }>(
      `SELECT raw_payload, external_id FROM inbound_events
        WHERE source = 'meta_lead_ads' AND status = 'processed'
        ORDER BY received_at DESC LIMIT 200`,
    );

    const mapped = new Set(
      (await query<{ external_field: string }>(`SELECT external_field FROM form_field_map WHERE source = 'meta_lead_ads'`)).map(
        (r) => r.external_field.toLowerCase(),
      ),
    );

    const counts = new Map<string, { field: string; count: number; sample: string }>();
    for (const row of rows) {
      const payload = typeof row.raw_payload === 'string' ? safeParse(row.raw_payload) : row.raw_payload;
      const fields = (payload as { field_data?: Array<{ name?: string; values?: string[] }> })?.field_data ?? [];
      for (const field of fields) {
        const name = field.name ?? '';
        if (!name || mapped.has(name.toLowerCase())) continue;
        const existing = counts.get(name);
        if (existing) existing.count += 1;
        else counts.set(name, { field: name, count: 1, sample: field.values?.[0] ?? '' });
      }
    }

    res.json({ items: [...counts.values()].sort((a, b) => b.count - a.count) });
  }),
);

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
