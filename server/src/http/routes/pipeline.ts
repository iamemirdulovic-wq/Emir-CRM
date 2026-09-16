import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { actorFrom, currentUser, requireAuth, requireManager, blockUntilPasswordChanged } from '../middleware/auth.js';
import { visibleUserIds } from '../../auth/scope.js';
import { DEFAULT_PIPELINE_KEY, LOST_REASONS, STAGE_DEFINITIONS, STAGE_KEYS } from '../../pipeline/stages.js';
import { loadBoard, moveStage, reassign } from '../../services/opportunities.js';
import { query } from '../../db/client.js';

export const pipelineRouter = Router();
pipelineRouter.use(requireAuth, blockUntilPasswordChanged);

/** The stage and sub-status vocabulary, so the UI never hard-codes it. */
pipelineRouter.get(
  '/definition',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      pipelineKey: DEFAULT_PIPELINE_KEY,
      stages: STAGE_DEFINITIONS.map((s) => ({
        key: s.key,
        name: s.name,
        position: s.position,
        isWon: s.isWon,
        isLost: s.isLost,
        subStatuses: s.subStatuses,
      })),
      lostReasons: LOST_REASONS,
    });
  }),
);

const boardQuerySchema = z.object({
  search: z.string().max(120).optional(),
  source: z.string().max(48).optional(),
  ownerUserId: z.string().max(36).optional(),
  projectName: z.string().max(160).optional(),
  limitPerStage: z.coerce.number().int().min(1).max(200).optional(),
});

pipelineRouter.get(
  '/board',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const filters = boardQuerySchema.parse(req.query);
    const visible = await visibleUserIds(user);

    const board = await loadBoard({
      visibleUserIds: visible,
      pipelineKey: DEFAULT_PIPELINE_KEY,
      filters: {
        search: filters.search ?? null,
        source: filters.source ?? null,
        ownerUserId: filters.ownerUserId ?? null,
        projectName: filters.projectName ?? null,
      },
      ...(filters.limitPerStage ? { limitPerStage: filters.limitPerStage } : {}),
    });

    res.json({ pipelineKey: DEFAULT_PIPELINE_KEY, columns: board, scope: visible === null ? 'all' : visible });
  }),
);

const moveSchema = z.object({
  to: z.enum(STAGE_KEYS),
  subStatus: z.string().max(48).nullable().optional(),
  lostReason: z.enum(LOST_REASONS).nullable().optional(),
  lostNote: z.string().max(500).nullable().optional(),
});

pipelineRouter.post(
  '/opportunities/:id/stage',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const body = moveSchema.parse(req.body);

    const result = await moveStage({
      opportunityId: String(req.params.id),
      to: body.to,
      subStatus: body.subStatus ?? null,
      lostReason: body.lostReason ?? null,
      lostNote: body.lostNote ?? null,
      actor: { ...actorFrom(req), role: user.role },
      actingUserId: user.id,
    });

    res.json(result);
  }),
);

const reassignSchema = z.object({
  toUserId: z.string().min(1).max(36),
  reason: z.string().max(500).optional(),
  moveStickyOwner: z.boolean().optional(),
});

pipelineRouter.post(
  '/opportunities/:id/reassign',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const body = reassignSchema.parse(req.body);

    await reassign({
      opportunityId: String(req.params.id),
      toUserId: body.toUserId,
      reason: body.reason ?? null,
      ...(body.moveStickyOwner === undefined ? {} : { moveStickyOwner: body.moveStickyOwner }),
      actor: { ...actorFrom(req), role: user.role },
    });

    res.json({ ok: true });
  }),
);

/** Leads nobody could be assigned. Managers work this queue. */
pipelineRouter.get(
  '/unassigned',
  requireManager,
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await query(
      `SELECT q.id, q.opportunity_id, q.contact_id, q.reason, q.created_at,
              o.title, o.project_name, o.source, c.full_name, c.phone_e164, c.language
         FROM unassigned_queue q
         JOIN opportunities o ON o.id = q.opportunity_id
         JOIN contacts c ON c.id = q.contact_id
        WHERE q.resolved_at IS NULL
        ORDER BY q.created_at ASC
        LIMIT 200`,
    );
    res.json({ items: rows });
  }),
);
