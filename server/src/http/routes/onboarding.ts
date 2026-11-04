import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  blockUntilPasswordChanged, currentUser, requireAuth, requireRole,
} from '../middleware/auth.js';
import { ONBOARDING_QUESTIONS } from '../../onboarding/questions.js';
import { getOnboarding, listForOwner, saveOnboarding } from '../../onboarding/store.js';

/**
 * The welcome a new agent gets on their first sign-in.
 *
 * Everything but the last route is the caller's own: the user id comes from
 * the session and is never read from the body, so there is no path by which
 * one agent reads or writes another's answers.
 *
 * The last route is the owner's, and it is guarded by role on the server. The
 * UI hides it too, but the UI is not what stops an agent asking for it.
 */
export const onboardingRouter = Router();
onboardingRouter.use(requireAuth, blockUntilPasswordChanged);

/** My own state, plus the questions, so the web app never hard-codes them. */
onboardingRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const state = await getOnboarding(currentUser(req).id);
    res.json({ questions: ONBOARDING_QUESTIONS, ...state });
  }),
);

const saveSchema = z.object({
  preferredName: z.string().max(80).nullable().optional(),
  /* Values arrive as strings or numbers and are cleaned against the question
     list in cleanAnswers, which is the only thing that decides what is kept. */
  answers: z.record(z.union([z.string(), z.number(), z.null()])).optional(),
  skip: z.boolean().optional(),
});

/** Save progress. Called on every step, so a dropped connection loses one answer. */
onboardingRouter.put(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const input = saveSchema.parse(req.body);
    res.json(await saveOnboarding(currentUser(req).id, input));
  }),
);

/**
 * Everyone's answers.
 *
 * Owner and admin only. The agents are told in the flow itself that this
 * screen exists, which is the part that matters.
 */
onboardingRouter.get(
  '/all',
  requireRole('owner', 'admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ questions: ONBOARDING_QUESTIONS, items: await listForOwner() });
  }),
);
