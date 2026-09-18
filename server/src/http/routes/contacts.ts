import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom,
  blockUntilPasswordChanged,
  currentUser,
  requireAdmin,
  requireAuth,
  requireManager,
  requirePermission,
} from '../middleware/auth.js';
import { ownerPredicate, visibleUserIds } from '../../auth/scope.js';
import { query, queryOne, execute } from '../../db/client.js';
import { badRequest } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import {
  assertCanViewContact,
  contact360,
  EDITABLE_CONTACT_FIELDS,
  mergeContacts,
  setDnc,
  updateContact,
} from '../../services/contacts.js';
import { writeAudit } from '../../audit/audit.js';
import { findSuspectNames, repairNames } from '../../services/name-review.js';
import { completeTask } from '../../services/tasks.js';

export const contactsRouter = Router();
contactsRouter.use(requireAuth, blockUntilPasswordChanged);

const listSchema = z.object({
  search: z.string().max(120).optional(),
  tag: z.string().max(160).optional(),
  dnc: z.enum(['0', '1']).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

contactsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const params = listSchema.parse(req.query);
    const visible = await visibleUserIds(user);
    const scope = ownerPredicate('c.owner_user_id', visible);

    const where = [scope.sql, 'c.merged_into_id IS NULL'];
    const args: Array<string | number> = [...scope.params];

    if (params.search) {
      where.push('(c.full_name LIKE ? OR c.phone_e164 LIKE ? OR c.email LIKE ? OR c.wa_id LIKE ?)');
      const like = `%${params.search}%`;
      args.push(like, like, like, like);
    }
    if (params.dnc) {
      where.push('c.dnc = ?');
      args.push(Number(params.dnc));
    }
    if (params.tag) {
      const [namespace, value] = params.tag.split(':');
      where.push(
        'EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = c.id AND t.namespace = ? AND t.value = ?)',
      );
      args.push(namespace ?? '', value ?? '');
    }

    const offset = (params.page - 1) * params.pageSize;
    const items = await query(
      // The contacts list shows where each person currently sits, so it carries
      // their most recent opportunity. A correlated subquery rather than a join:
      // a contact with several inquiries must still produce exactly one row.
      `SELECT c.id, c.full_name, c.phone_e164, c.wa_id, c.email, c.language, c.lead_score, c.dnc,
              c.owner_user_id, c.first_source, c.last_inbound_at, c.created_at, u.name AS owner_name,
              o.stage_key, o.project_name
         FROM contacts c
         LEFT JOIN users u ON u.id = c.owner_user_id
         LEFT JOIN opportunities o
                ON o.id = (SELECT id FROM opportunities
                            WHERE contact_id = c.id
                            ORDER BY created_at DESC LIMIT 1)
        WHERE ${where.join(' AND ')}
        ORDER BY c.created_at DESC
        LIMIT ${params.pageSize} OFFSET ${offset}`,
      args,
    );
    const total = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM contacts c WHERE ${where.join(' AND ')}`,
      args,
    );

    res.json({ items, page: params.page, pageSize: params.pageSize, total: Number(total?.n ?? 0) });
  }),
);

/*
 * Declared above `GET /:id`. Express matches in definition order, so with these
 * further down the file the router answered /api/contacts/name-review by
 * looking for a contact whose id is the string "name-review".
 */
/* ── Repairing names that are not names ─────────────────────────────────── */

/**
 * Contacts whose name came out of the wrong lead-form answer.
 *
 * Manager and up: it reads across a team, and the fix rewrites a field an agent
 * may have corrected by hand.
 */
contactsRouter.get(
  '/name-review',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const items = await findSuspectNames(await visibleUserIds(user));
    res.json({ items });
  }),
);

const repairSchema = z.object({
  // The ids the screen just showed, so nobody is fixing a list they did not read.
  ids: z.array(z.string().max(36)).min(1).max(500),
});

contactsRouter.post(
  '/name-review/apply',
  requireManager,
  requirePermission('contacts:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const { ids } = repairSchema.parse(req.body);
    const result = await repairNames(actorFrom(req), ids, await visibleUserIds(user));
    res.json(result);
  }),
);

contactsRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const contactId = String(req.params.id);
    await assertCanViewContact(contactId, await visibleUserIds(user));
    res.json(await contact360(contactId));
  }),
);

const updateSchema = z.object(
  Object.fromEntries(EDITABLE_CONTACT_FIELDS.map((f) => [f, z.string().max(2000).nullable().optional()])) as Record<
    string,
    z.ZodOptional<z.ZodNullable<z.ZodString>>
  >,
);

contactsRouter.patch(
  '/:id',
  requirePermission('contacts:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const contactId = String(req.params.id);
    await assertCanViewContact(contactId, await visibleUserIds(user));

    await updateContact({
      contactId,
      patch: updateSchema.parse(req.body),
      actor: actorFrom(req),
      actingUserId: user.id,
    });
    res.json(await contact360(contactId));
  }),
);

const noteSchema = z.object({ body: z.string().min(1).max(5000) });

contactsRouter.post(
  '/:id/notes',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const contactId = String(req.params.id);
    await assertCanViewContact(contactId, await visibleUserIds(user));
    const body = noteSchema.parse(req.body);

    const id = newId();
    await execute(
      `INSERT INTO activities (id, contact_id, user_id, type, title, body) VALUES (?, ?, ?, 'note', 'Note', ?)`,
      [id, contactId, user.id, body.body],
    );
    await writeAudit({ actor: actorFrom(req), action: 'contact.note_added', entityType: 'contact', entityId: contactId });
    res.status(201).json({ id });
  }),
);

const dncSchema = z.object({ reason: z.string().min(1).max(160) });

contactsRouter.post(
  '/:id/dnc',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const contactId = String(req.params.id);
    await assertCanViewContact(contactId, await visibleUserIds(user));
    const body = dncSchema.parse(req.body);

    await setDnc({ contactId, reason: body.reason, actor: actorFrom(req) });
    res.json({ ok: true });
  }),
);

const mergeSchema = z.object({ winnerId: z.string().min(1).max(36), loserId: z.string().min(1).max(36) });

/** The merge tool. Managers and above. */
contactsRouter.post(
  '/merge',
  requireManager,
  requirePermission('contacts:merge'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = mergeSchema.parse(req.body);
    if (body.winnerId === body.loserId) throw badRequest('Choose two different contacts to merge');

    const result = await mergeContacts({ winnerId: body.winnerId, loserId: body.loserId, actor: actorFrom(req) });
    res.json(result);
  }),
);

/** Contacts flagged as possible duplicates, for the merge tool's worklist. */
contactsRouter.get(
  '/duplicates/pending',
  requireManager,
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await query(
      `SELECT c.id, c.full_name, c.phone_e164, c.email, c.created_at,
              o.id AS other_id, o.full_name AS other_full_name, o.phone_e164 AS other_phone, o.email AS other_email
         FROM contacts c
         JOIN contacts o ON o.id = c.possible_duplicate_of
        WHERE c.merged_into_id IS NULL AND o.merged_into_id IS NULL
        ORDER BY c.created_at DESC
        LIMIT 200`,
    );
    res.json({ items: rows });
  }),
);

const tasksSchema = z.object({
  title: z.string().min(1).max(255),
  type: z.enum(['call', 'whatsapp', 'email', 'meeting', 'other']).default('call'),
  dueAt: z.string().datetime(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  notes: z.string().max(2000).optional(),
  assignedUserId: z.string().max(36).optional(),
  opportunityId: z.string().max(36).optional(),
});

contactsRouter.post(
  '/:id/tasks',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const contactId = String(req.params.id);
    await assertCanViewContact(contactId, await visibleUserIds(user));
    const body = tasksSchema.parse(req.body);

    const id = newId();
    await execute(
      `INSERT INTO tasks (id, contact_id, opportunity_id, assigned_user_id, created_by_user_id, type, title, notes, priority, due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        contactId,
        body.opportunityId ?? null,
        body.assignedUserId ?? user.id,
        user.id,
        body.type,
        body.title,
        body.notes ?? null,
        body.priority,
        new Date(body.dueAt),
      ],
    );
    await writeAudit({ actor: actorFrom(req), action: 'task.created', entityType: 'task', entityId: id, after: { contactId } });
    res.status(201).json({ id });
  }),
);

contactsRouter.post(
  '/tasks/:taskId/complete',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    // Delegated so that completing a task from Contact 360 and from the Tasks
    // screen do exactly the same thing, including the audit entry.
    await completeTask(actorFrom(req), String(req.params.taskId), await visibleUserIds(user));
    res.json({ ok: true });
  }),
);

/** Export is owner/admin only, and every export is logged. */
contactsRouter.get(
  '/export/csv',
  requireAdmin,
  requirePermission('export'),
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await query<Record<string, unknown>>(
      `SELECT c.id, c.full_name, c.phone_e164, c.email, c.language, c.lead_score, c.first_source,
              c.created_at, u.name AS owner_name,
              o.stage_key, o.sub_status, o.status, o.project_name, o.budget_band, o.source, o.campaign_name
         FROM contacts c
         LEFT JOIN users u ON u.id = c.owner_user_id
         LEFT JOIN opportunities o ON o.contact_id = c.id
        WHERE c.merged_into_id IS NULL
        ORDER BY c.created_at DESC
        LIMIT 50000`,
    );

    await writeAudit({
      actor: actorFrom(req),
      action: 'contacts.exported',
      entityType: 'contact',
      entityId: null,
      after: { rowCount: rows.length, format: 'csv' },
    });

    const headers = [
      'id', 'full_name', 'phone_e164', 'email', 'language', 'lead_score', 'first_source', 'created_at',
      'owner_name', 'stage_key', 'sub_status', 'status', 'project_name', 'budget_band', 'source', 'campaign_name',
    ];
    const escape = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      const text = value instanceof Date ? value.toISOString() : String(value);
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="emir-crm-contacts-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }),
);
