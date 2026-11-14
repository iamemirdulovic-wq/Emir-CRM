/**
 * Saving what happened on a call, and the no-answer ladder behind it.
 *
 * The shape is fixed by `docs/v2/call-results-contract.md`, which four agents
 * built against at once on 14 November. The engine is `v2/call-results.ts`;
 * this file is the four addresses and nothing else.
 *
 * Mounted at `/api/v2` alongside `v2Router` rather than inside it. Express
 * runs routers in the order they are mounted and a router passes on a path it
 * does not declare, so two routers on one prefix is not a conflict — and it
 * keeps a 1,500-line file that three people are editing today out of the way.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAdmin, requireAuth,
} from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  CALL_RESULTS, CALL_TRIES_DEFAULTS, STEP_LABELS, TRY_PERIODS, TRY_STEPS,
  callResultState, callTriesSettings, saveCallResult, saveCallTries, triesByAgent,
  undoCallResult, type TryPeriod,
} from '../../v2/call-results.js';

export const callResultsRouter = Router();
callResultsRouter.use(requireAuth, blockUntilPasswordChanged);

/* ── the owner's settings (contract §5) ───────────────────────────────── */

/*
 * Declared before `/leads/:opportunityId/call-result` for the usual reason:
 * Express matches in declaration order. These paths cannot collide with that
 * one, but keeping the fixed paths first is the habit that stops the next
 * addition from being swallowed silently.
 */

/** The ladder, plus the choices and their words, so no screen writes them twice. */
callResultsRouter.get(
  '/call-tries',
  requireAdmin,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      ...await callTriesSettings(),
      defaults: CALL_TRIES_DEFAULTS,
      /* Every rung the owner may pick, with the words for it. */
      choices: TRY_STEPS.map((step) => ({ step, label: STEP_LABELS[step] })),
    });
  }),
);

const triesSchema = z.object({
  max: z.number().int().min(1).max(10).optional(),
  steps: z.array(z.enum(TRY_STEPS)).min(1).max(10).optional(),
  busyMinutes: z.number().int().min(5).max(24 * 60).optional(),
});

callResultsRouter.patch(
  '/call-tries',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const input = triesSchema.parse(req.body ?? {});
    res.json(await saveCallTries(actorFrom(req), input));
  }),
);

/**
 * No-answer tries per agent, today and this week (H.1).
 *
 * Scoped by role inside, like every other figure: an agent reading it sees
 * their own line only. An unknown period reads as today rather than failing,
 * because the only way to send one is to type it into the address.
 */
callResultsRouter.get(
  '/call-tries/report',
  asyncHandler(async (req: Request, res: Response) => {
    const asked = String(req.query.period ?? 'today');
    const period: TryPeriod = (TRY_PERIODS as readonly string[]).includes(asked)
      ? (asked as TryPeriod) : 'today';
    res.json(await triesByAgent(currentUser(req), period));
  }),
);

/* ── one result (contract §1, §1b) ────────────────────────────────────── */

const resultSchema = z.object({
  result: z.enum(CALL_RESULTS),
  /* Required for `call_back` only; the engine says so in plain English if it
     is missing, because that is a sentence an agent reads. */
  callBackAt: z.string().min(4).max(40).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  /* When the screen started the call through `POST /api/v2/calls`, so the
     outcome lands on that row instead of a second one. */
  callId: z.string().min(1).max(36).nullable().optional(),
});

/**
 * The state without changing anything — for a reload, or a card being drawn.
 *
 * Same answer as a save, so a screen has one shape to read either way.
 */
callResultsRouter.get(
  '/leads/:opportunityId/call-result',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await callResultState(currentUser(req), String(req.params.opportunityId)));
  }),
);

/**
 * One tap, and everything that follows from it.
 *
 * Rate-limited per person rather than per lead: a stuck button repeating
 * itself would otherwise walk a lead up the ladder in a second, and the
 * figures an owner reads would have a day of calls in them that nobody made.
 */
callResultsRouter.post(
  '/leads/:opportunityId/call-result',
  rateLimit({
    windowMs: 60_000,
    max: 60,
    keyFor: (req) => `call-result:${currentUser(req).id}`,
    message: 'That is a lot of call results in a minute. Please wait a moment.',
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = resultSchema.parse(req.body ?? {});
    res.json(await saveCallResult(
      actorFrom(req), currentUser(req), String(req.params.opportunityId), input,
    ));
  }),
);

/** Take the last one back, inside the ten minutes the toast lives for. */
callResultsRouter.delete(
  '/leads/:opportunityId/call-result',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await undoCallResult(
      actorFrom(req), currentUser(req), String(req.params.opportunityId),
    ));
  }),
);
