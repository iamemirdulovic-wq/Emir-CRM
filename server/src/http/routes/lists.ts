import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAdmin, requireAuth, requireManager,
  requirePermission,
} from '../middleware/auth.js';
import { execute, query, queryOne } from '../../db/client.js';
import { visibleUserIds } from '../../auth/scope.js';
import { newId } from '../../lib/ids.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { writeAudit } from '../../audit/audit.js';
import { toCsvRow } from '../../imports/csv.js';
import { describeFilter, listFilterSchema } from '../../lists/filters.js';
import { addToList, listMembers, removeFromList, runBulkAction } from '../../lists/store.js';

export const listsRouter = Router();
listsRouter.use(requireAuth, blockUntilPasswordChanged);

const upsertSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(500).nullable().optional(),
  kind: z.enum(['static', 'smart']).default('static'),
  filters: listFilterSchema.optional(),
  ownerUserId: z.string().max(36).nullable().optional(),
  recycleAfterDays: z.number().int().min(1).max(365).nullable().optional(),
  recycleAction: z.enum(['reassign', 'pool']).nullable().optional(),
});

listsRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const items = await query<Record<string, unknown>>(
      `SELECT l.id, l.name, l.description, l.kind, l.filters, l.recycle_after_days, l.recycle_action,
              l.created_at, u.name AS owner_name,
              (SELECT COUNT(*) FROM list_members lm WHERE lm.list_id = l.id) AS member_count
         FROM lists l LEFT JOIN users u ON u.id = l.owner_user_id
        ORDER BY l.created_at DESC`,
    );

    res.json({
      items: items.map((row) => ({
        ...row,
        // A smart list has no stored members, so its count comes from its
        // filter when it is opened; the card shows the rule instead.
        summary:
          row.kind === 'smart'
            ? describeFilter(
                (typeof row.filters === 'string' ? JSON.parse(row.filters) : row.filters) ?? {},
              )
            : `${row.member_count} contacts`,
      })),
    });
  }),
);

listsRouter.post(
  '/',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const body = upsertSchema.parse(req.body);
    if (body.kind === 'smart' && !body.filters) throw badRequest('A smart list needs a filter');

    const id = newId();
    await execute(
      `INSERT INTO lists (id, name, description, kind, filters, owner_user_id,
                          recycle_after_days, recycle_action, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.name,
        body.description ?? null,
        body.kind,
        body.filters ? JSON.stringify(body.filters) : null,
        body.ownerUserId ?? null,
        body.recycleAfterDays ?? null,
        body.recycleAction ?? null,
        currentUser(req).id,
      ],
    );
    await writeAudit({ actor: actorFrom(req), action: 'list.created', entityType: 'list', entityId: id, after: { name: body.name, kind: body.kind } });
    res.status(201).json({ id });
  }),
);

listsRouter.patch(
  '/:id',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const body = upsertSchema.partial().parse(req.body);

    const patch: string[] = [];
    const args: unknown[] = [];
    if (body.name !== undefined) { patch.push('name = ?'); args.push(body.name); }
    if (body.description !== undefined) { patch.push('description = ?'); args.push(body.description); }
    if (body.filters !== undefined) { patch.push('filters = ?'); args.push(JSON.stringify(body.filters)); }
    if (body.ownerUserId !== undefined) { patch.push('owner_user_id = ?'); args.push(body.ownerUserId); }
    if (body.recycleAfterDays !== undefined) { patch.push('recycle_after_days = ?'); args.push(body.recycleAfterDays); }
    if (body.recycleAction !== undefined) { patch.push('recycle_action = ?'); args.push(body.recycleAction); }
    if (patch.length === 0) throw badRequest('Nothing to update');

    await execute(`UPDATE lists SET ${patch.join(', ')} WHERE id = ?`, [...args, id] as never[]);
    await writeAudit({ actor: actorFrom(req), action: 'list.updated', entityType: 'list', entityId: id, after: body });
    res.json({ ok: true });
  }),
);

listsRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    // Deleting a list removes the grouping, never the contacts in it.
    await execute('DELETE FROM lists WHERE id = ?', [id]);
    await writeAudit({ actor: actorFrom(req), action: 'list.deleted', entityType: 'list', entityId: id });
    res.json({ ok: true });
  }),
);

listsRouter.get(
  '/:id/members',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const params = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) })
      .parse(req.query);
    const result = await listMembers(String(req.params.id), await visibleUserIds(user), params);
    res.json(result);
  }),
);

const membersSchema = z.object({ contactIds: z.array(z.string().max(36)).min(1).max(5000) });

listsRouter.post(
  '/:id/members',
  asyncHandler(async (req: Request, res: Response) => {
    const body = membersSchema.parse(req.body);
    res.json({ added: await addToList(actorFrom(req), String(req.params.id), body.contactIds) });
  }),
);

listsRouter.delete(
  '/:id/members',
  asyncHandler(async (req: Request, res: Response) => {
    const body = membersSchema.parse(req.body);
    res.json({ removed: await removeFromList(actorFrom(req), String(req.params.id), body.contactIds) });
  }),
);

/* ── Bulk actions on a selection ──────────────────────────────────────── */

const bulkSchema = z.object({
  contactIds: z.array(z.string().max(36)).min(1).max(5000),
  action: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('assign'),
      method: z.enum(['agent', 'team_round_robin', 'split_even', 'split_percent', 'by_rule', 'pool']),
      userId: z.string().max(36).nullable().optional(),
      teamId: z.string().max(36).nullable().optional(),
      shares: z.array(z.object({ userId: z.string().max(36), percent: z.number().min(0).max(100) })).max(50).optional(),
      clauses: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
    }),
    z.object({ kind: z.literal('add_tag'), tag: z.string().min(1).max(160) }),
    z.object({ kind: z.literal('remove_tag'), tag: z.string().min(1).max(160) }),
    z.object({ kind: z.literal('add_to_list'), listId: z.string().max(36) }),
    z.object({ kind: z.literal('remove_from_list'), listId: z.string().max(36) }),
  ]),
});

listsRouter.post(
  '/bulk',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const body = bulkSchema.parse(req.body);
    const result = await runBulkAction(actorFrom(req), body.contactIds, body.action as never);
    res.json(result);
  }),
);

/**
 * Bulk export. Owner and admin only, and logged — the specification is explicit
 * about both, because this is the endpoint that can walk out of the building
 * with the whole database.
 */
listsRouter.get(
  '/:id/export.csv',
  requireAdmin,
  requirePermission('export'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const id = String(req.params.id);
    const { items } = await listMembers(id, await visibleUserIds(user), { limit: 500 });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="list-${id.slice(0, 8)}.csv"`);
    res.write(toCsvRow(['Name', 'Phone', 'Email', 'Language', 'Score', 'Stage', 'Project', 'Budget', 'Owner']));
    for (const row of items) {
      res.write(
        toCsvRow([
          row.full_name, row.phone_e164, row.email, row.language, row.lead_score,
          row.stage_key, row.project_name, row.budget_band, row.owner_name,
        ]),
      );
    }
    res.end();

    await writeAudit({
      actor: actorFrom(req),
      action: 'list.exported',
      entityType: 'list',
      entityId: id,
      after: { rows: items.length, format: 'csv' },
    });
  }),
);

/**
 * Bulk delete. Owner only, and logged.
 *
 * Kept off the generic bulk-action endpoint on purpose: a destructive action
 * should need its own call with its own permission, not a different string in
 * a JSON body.
 */
listsRouter.post(
  '/bulk-delete',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    if (user.role !== 'owner') throw forbidden('Only the owner can bulk-delete contacts');

    const body = z
      .object({ contactIds: z.array(z.string().max(36)).min(1).max(1000), confirm: z.literal(true) })
      .parse(req.body);

    const before = await query<{ id: string; full_name: string | null }>(
      `SELECT id, full_name FROM contacts WHERE id IN (${body.contactIds.map(() => '?').join(',')})`,
      body.contactIds,
    );
    const result = await execute(
      `DELETE FROM contacts WHERE id IN (${body.contactIds.map(() => '?').join(',')})`,
      body.contactIds,
    );

    await writeAudit({
      actor: actorFrom(req),
      action: 'contacts.bulk_deleted',
      entityType: 'contact',
      entityId: null,
      // Names, not phone numbers: the audit log must be able to answer "what
      // was deleted" without itself becoming a copy of the contact list.
      before: { requested: body.contactIds.length, names: before.map((row) => row.full_name) },
      after: { deleted: result.affectedRows },
    });

    res.json({ deleted: result.affectedRows });
  }),
);
