import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { actorFrom, blockUntilPasswordChanged, requireAdmin, requireAuth } from '../middleware/auth.js';
import { listAutomations, setAutomationActive } from '../../services/automations.js';

export const automationsRouter = Router();
automationsRouter.use(requireAuth, blockUntilPasswordChanged);

/** Everyone may see what is running; the specification puts the switches with the owner and admin. */
automationsRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ items: await listAutomations() });
  }),
);

const toggleSchema = z.object({ isActive: z.boolean() });

automationsRouter.patch(
  '/:key',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const body = toggleSchema.parse(req.body);
    await setAutomationActive(actorFrom(req), String(req.params.key), body.isActive);
    res.json({ ok: true });
  }),
);
