import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { actorFrom, blockUntilPasswordChanged, currentUser, requireAuth } from '../middleware/auth.js';
import { visibleUserIds } from '../../auth/scope.js';
import { completeTask, listTasks, reopenTask } from '../../services/tasks.js';

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
    res.json(await listTasks(user.id, visible, options));
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
