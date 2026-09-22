/**
 * Sales offers — the library's HTTP surface.
 *
 * Every route below hands the signed-in user to the service, which builds the
 * permission fence from that session in SQL. Nothing here trusts a user id, a
 * folder id or an agent id arriving in a body: an agent may name another
 * agent's offer all they like, and still be told it does not exist.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth,
} from '../middleware/auth.js';
import {
  createFolder, createOffer, deleteFolder, duplicateOffer, getOffer, listFolders, listOffers,
  purgeOffer, renameFolder, restoreOffer, trashOffer, updateOffer,
  type LibraryFilter,
} from '../../services/offers.js';

export const offersRouter = Router();
offersRouter.use(requireAuth, blockUntilPasswordChanged);

/** The actor the service audits with, carrying the role the fence reads. */
function actor(req: Request) {
  const user = currentUser(req);
  return { ...actorFrom(req), id: user.id, role: user.role };
}

const FILTERS = ['all', 'star', 'viewed', 'draft', 'trash'] as const;

function filterFrom(value: unknown): LibraryFilter {
  return FILTERS.includes(value as LibraryFilter) ? (value as LibraryFilter) : 'all';
}

/* ── Folders ────────────────────────────────────────────────────────────── */

offersRouter.get(
  '/folders',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ items: await listFolders(currentUser(req)) });
  }),
);

const folderBody = z.object({
  name: z.string().min(1).max(160),
  parentId: z.string().uuid().nullish(),
});

offersRouter.post(
  '/folders',
  asyncHandler(async (req: Request, res: Response) => {
    const body = folderBody.parse(req.body);
    const folder = await createFolder(actor(req), { name: body.name, parentId: body.parentId ?? null });
    res.status(201).json(folder);
  }),
);

offersRouter.patch(
  '/folders/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ name: z.string().min(1).max(160) }).parse(req.body);
    await renameFolder(actor(req), String(req.params.id), body.name);
    res.json({ ok: true });
  }),
);

offersRouter.delete(
  '/folders/:id',
  asyncHandler(async (req: Request, res: Response) => {
    await deleteFolder(actor(req), String(req.params.id));
    res.json({ ok: true });
  }),
);

/* ── Offers ─────────────────────────────────────────────────────────────── */

offersRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const items = await listOffers(currentUser(req), {
      filter: filterFrom(req.query.filter),
      folderId: typeof req.query.folder === 'string' && req.query.folder ? req.query.folder : null,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    });
    res.json({ items });
  }),
);

offersRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getOffer(currentUser(req), String(req.params.id)));
  }),
);

const createBody = z.object({
  title: z.string().max(200).optional(),
  folderId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
  opportunityId: z.string().uuid().nullish(),
  projectId: z.string().uuid().nullish(),
  agentUserId: z.string().uuid().optional(),
  language: z.enum(['en', 'ar', 'ru', 'hi']).optional(),
});

offersRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = createBody.parse(req.body);
    const offer = await createOffer(actor(req), {
      title: body.title,
      folderId: body.folderId ?? null,
      contactId: body.contactId ?? null,
      opportunityId: body.opportunityId ?? null,
      projectId: body.projectId ?? null,
      agentUserId: body.agentUserId,
      language: body.language,
    });
    res.status(201).json(offer);
  }),
);

const patchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  folderId: z.string().uuid().nullish(),
  starred: z.boolean().optional(),
});

offersRouter.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const body = patchBody.parse(req.body);
    const patch: Parameters<typeof updateOffer>[2] = {};
    if (body.title !== undefined) patch.title = body.title;
    // `null` means "move to the top level", so presence matters, not truthiness.
    if ('folderId' in body) patch.folderId = body.folderId ?? null;
    if (body.starred !== undefined) patch.starred = body.starred;
    res.json(await updateOffer(actor(req), String(req.params.id), patch));
  }),
);

offersRouter.post(
  '/:id/duplicate',
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await duplicateOffer(actor(req), String(req.params.id)));
  }),
);

/** Move to trash. Recoverable for 30 days; the client's link stops working now. */
offersRouter.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    await trashOffer(actor(req), String(req.params.id));
    res.json({ ok: true });
  }),
);

offersRouter.post(
  '/:id/restore',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await restoreOffer(actor(req), String(req.params.id)));
  }),
);

/** Delete for good. The service refuses anyone below admin, and audits it. */
offersRouter.delete(
  '/:id/forever',
  asyncHandler(async (req: Request, res: Response) => {
    await purgeOffer(actor(req), String(req.params.id));
    res.json({ ok: true });
  }),
);
