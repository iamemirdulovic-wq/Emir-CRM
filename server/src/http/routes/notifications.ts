import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { blockUntilPasswordChanged, currentUser, requireAuth } from '../middleware/auth.js';
import { listNotifications, markRead } from '../../messaging/notify.js';

/**
 * The bell.
 *
 * Every route here is scoped to the signed-in person inside the query itself.
 * There is no "whose notifications?" parameter and no manager view: a
 * notification is addressed to one person, and widening that later should take
 * a deliberate change rather than a missing check.
 */
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, blockUntilPasswordChanged);

notificationsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await listNotifications(currentUser(req).id));
  }),
);

/**
 * Just the number, for the badge.
 *
 * Its own endpoint because it runs on every page for everyone, and the list
 * behind it is fifty rows this only needs the count of.
 */
notificationsRouter.get(
  '/count',
  asyncHandler(async (req: Request, res: Response) => {
    const { unread } = await listNotifications(currentUser(req).id, 1);
    res.json({ unread });
  }),
);

const readSchema = z.object({ id: z.string().max(36).optional() });

notificationsRouter.post(
  '/read',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = readSchema.parse(req.body ?? {});
    /* No id means "mark all read" — the button at the top of the list. */
    const marked = await markRead(currentUser(req).id, id ?? null);
    res.json({ marked });
  }),
);
