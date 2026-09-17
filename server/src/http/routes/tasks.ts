import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { actorFrom, blockUntilPasswordChanged, currentUser, requireAuth } from '../middleware/auth.js';
import { visibleUserIds } from '../../auth/scope.js';
import {
  completeTask, createTask, deleteTask, listTasks, reopenTask, tasksInRange, updateTask,
} from '../../services/tasks.js';
import {
  ALLOWED_TYPES, attachmentsFor, deleteAttachment, findAttachment, isInlineSafe, openAttachment,
  saveAttachment,
} from '../../tasks/attachments.js';
import { assertCanViewTask } from '../../services/task-access.js';
import { writeAudit } from '../../audit/audit.js';
import { badRequest } from '../../lib/errors.js';
import { env } from '../../config/env.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth, blockUntilPasswordChanged);

const listSchema = z.object({
  scope: z.enum(['mine', 'team', 'all']).default('mine'),
  filter: z.enum(['open', 'overdue', 'today', 'done']).default('open'),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/**
 * The agent's working list. "team" and "all" are the same query — the viewer's
 * scope already decides how far either reaches, so an agent asking for "all"
 * still only gets their own.
 */
tasksRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const options = listSchema.parse(req.query);
    const visible = await visibleUserIds(user);
    const result = await listTasks(user.id, visible, options);
    res.json({ ...result, attachments: await attachmentsFor(result.items.map((task) => task.id)) });
  }),
);

/* ── The calendar ───────────────────────────────────────────────────────── */

const rangeSchema = z.object({
  from: z.string().min(10).max(40),
  to: z.string().min(10).max(40),
  scope: z.enum(['mine', 'team', 'all']).default('mine'),
});

/**
 * Tasks falling inside a window, for the month, week or day grid.
 *
 * The client sends real instants, not dates: a task due at 23:30 belongs to the
 * day it is 23:30 in for the person looking, and only the browser knows that.
 */
tasksRouter.get(
  '/calendar',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const options = rangeSchema.parse(req.query);
    const visible = await visibleUserIds(user);
    const items = await tasksInRange(user.id, visible, options);
    res.json({ items, attachments: await attachmentsFor(items.map((task) => task.id)) });
  }),
);

/* ── Creating and editing ───────────────────────────────────────────────── */

const taskSchema = z.object({
  title: z.string().trim().min(1).max(255),
  notes: z.string().max(4000).nullable().optional(),
  type: z.enum(['call', 'whatsapp', 'email', 'meeting', 'other']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  dueAt: z.string().min(10).max(40),
  assignedUserId: z.string().max(36).nullable().optional(),
  contactId: z.string().max(36).nullable().optional(),
  opportunityId: z.string().max(36).nullable().optional(),
});

tasksRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const body = taskSchema.parse(req.body);
    const id = await createTask(actorFrom(req), body, await visibleUserIds(user));
    res.status(201).json({ id });
  }),
);

tasksRouter.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const body = taskSchema.partial().parse(req.body);
    await updateTask(actorFrom(req), String(req.params.id), body, await visibleUserIds(user));
    res.json({ ok: true });
  }),
);

tasksRouter.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    await deleteTask(actorFrom(req), String(req.params.id), await visibleUserIds(user));
    res.json({ ok: true });
  }),
);

tasksRouter.post(
  '/:id/complete',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    await completeTask(actorFrom(req), String(req.params.id), await visibleUserIds(user));
    res.json({ ok: true });
  }),
);

tasksRouter.post(
  '/:id/reopen',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    await reopenTask(actorFrom(req), String(req.params.id), await visibleUserIds(user));
    res.json({ ok: true });
  }),
);

/* ── Attachments ────────────────────────────────────────────────────────── */

/** Uploads write to disk, so they get their own budget, keyed per user. */
const uploadLimit = rateLimit({
  max: 60,
  windowMs: 10 * 60 * 1000,
  keyFor: (req) => `task-attachment:${currentUser(req).id}`,
  message: 'Too many uploads in a short time. Please wait a few minutes.',
});

/**
 * The name the uploader gave the file.
 *
 * It arrives percent-encoded, because a header holding a raw filename is a
 * header holding whatever the filesystem allowed — including newlines, which
 * would split it into two. Decoding can throw on a malformed sequence, so a
 * name that does not survive the trip is replaced rather than allowed to fail
 * the upload; control characters go the same way, since this string is later
 * written into a Content-Disposition header.
 */
function decodeFilename(raw: string | undefined): string {
  if (!raw) return 'attachment';
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f"\\]/g, '').trim();
  return name.slice(0, 255) || 'attachment';
}

/**
 * The body is the file itself, with its name and type in headers — the same
 * shape the import upload uses, and for the same reason: no multipart parser
 * and no buffering a whole request twice.
 */
tasksRouter.post(
  '/:id/attachments',
  uploadLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const taskId = String(req.params.id);
    await assertCanViewTask(taskId, await visibleUserIds(user));

    const contentType = (req.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (!ALLOWED_TYPES.includes(contentType)) {
      throw badRequest(`${contentType || 'That file'} cannot be attached. Images and PDF only.`);
    }

    const limit = env().MAX_ATTACHMENT_MB * 1024 * 1024;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > limit) throw badRequest(`That file is larger than the ${env().MAX_ATTACHMENT_MB} MB limit`);
      chunks.push(chunk as Buffer);
    }

    const attachment = await saveAttachment({
      taskId,
      filename: decodeFilename(req.get('x-filename')),
      contentType,
      body: Buffer.concat(chunks),
      uploadedByUserId: user.id,
    });

    await writeAudit({
      actor: actorFrom(req),
      action: 'task.attachment_added',
      entityType: 'task',
      entityId: taskId,
      after: { attachmentId: attachment.id, filename: attachment.filename, bytes: attachment.byte_size },
    });

    res.status(201).json(attachment);
  }),
);

/**
 * A `Content-Disposition` value that survives a filename in any language.
 *
 * HTTP header values are Latin-1. An agent in Dubai naming a file in Arabic —
 * or typing an em dash — produces a name Node refuses to put in a header at
 * all, which turned a download into a 500. RFC 6266 is the way out: an ASCII
 * `filename` that every client understands, and a UTF-8 `filename*` that every
 * client made this century prefers, so the real name still reaches the disk.
 */
export function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  // The fallback keeps only characters a header can carry, minus the quote and
  // backslash that would end the quoted string early.
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '') || 'file';
  // encodeURIComponent leaves ! ' ( ) * alone; RFC 5987 does not allow them.
  const utf8 = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * Serving an uploaded file back.
 *
 * Authenticated and scoped through the task, never served statically: an
 * attachment is a lead's floor plan or a colleague's screenshot, and a
 * guessable public URL would make the whole CRM's files readable by anyone who
 * found one link.
 */
tasksRouter.get(
  '/attachments/:attachmentId',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const row = await findAttachment(String(req.params.attachmentId));
    await assertCanViewTask(row.task_id, await visibleUserIds(user));

    const stream = await openAttachment(row);
    res.setHeader('Content-Type', row.content_type);
    res.setHeader('Content-Length', String(row.byte_size));
    /*
     * Images render in the page; everything else downloads. A PDF shown inline
     * runs in the CRM's own origin, and there is no reason to give a file
     * somebody uploaded that much reach.
     */
    res.setHeader(
      'Content-Disposition',
      contentDisposition(isInlineSafe(row.content_type) ? 'inline' : 'attachment', row.filename),
    );
    // Private: the browser may keep it, a proxy may not.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.pipe(res);
  }),
);

tasksRouter.delete(
  '/attachments/:attachmentId',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const row = await findAttachment(String(req.params.attachmentId));
    await assertCanViewTask(row.task_id, await visibleUserIds(user));
    await deleteAttachment(row);
    await writeAudit({
      actor: actorFrom(req),
      action: 'task.attachment_removed',
      entityType: 'task',
      entityId: row.task_id,
      before: { attachmentId: row.id, filename: row.filename },
    });
    res.json({ ok: true });
  }),
);
