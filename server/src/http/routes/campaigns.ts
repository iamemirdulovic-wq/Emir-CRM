import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth, requireManager,
} from '../middleware/auth.js';
import { execute, query, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { badRequest } from '../../lib/errors.js';
import { writeAudit } from '../../audit/audit.js';
import { enqueue } from '../../jobs/queue.js';
import {
  buildMembers, campaignStats, logOutcome, nextForAgent, pauseCampaign, releaseMember,
} from '../../campaigns/run.js';
import { DEFAULT_BULK_POLICY } from '../../campaigns/guard.js';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth, blockUntilPasswordChanged);

const createSchema = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(['call', 'whatsapp']),
  listId: z.string().max(36),
  templateName: z.string().max(160).nullable().optional(),
  templateLanguage: z.string().max(12).nullable().optional(),
  throttlePerMinute: z.number().int().min(1).max(200).optional(),
});

campaignsRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const items = await query(
      `SELECT c.id, c.name, c.kind, c.status, c.total_members, c.skipped_no_consent,
              c.template_name, c.paused_reason, c.started_at, c.finished_at, c.created_at,
              l.name AS list_name,
              (SELECT COUNT(*) FROM campaign_members cm
                WHERE cm.campaign_id = c.id AND cm.status IN ('done','sent')) AS done_count
         FROM campaigns c LEFT JOIN lists l ON l.id = c.list_id
        ORDER BY c.created_at DESC LIMIT 100`,
    );
    res.json({ items });
  }),
);

campaignsRouter.post(
  '/',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const body = createSchema.parse(req.body);

    if (body.kind === 'whatsapp') {
      if (!body.templateName) throw badRequest('A WhatsApp campaign needs an approved template');
      // Outside the 24-hour window Meta accepts nothing but an approved
      // template, so an unapproved one is refused here rather than failing
      // silently on every send.
      const template = await queryOne<{ status: string }>(
        'SELECT status FROM wa_templates WHERE name = ? AND language = ?',
        [body.templateName, body.templateLanguage ?? 'en'],
      );
      if (!template) throw badRequest('That template does not exist');
      if (template.status !== 'APPROVED') {
        throw badRequest(`That template is ${template.status.toLowerCase()}, not approved. Meta will reject every message.`);
      }
    }

    const id = newId();
    await execute(
      `INSERT INTO campaigns (id, name, kind, list_id, template_name, template_language,
                              throttle_per_minute, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, body.name, body.kind, body.listId,
        body.templateName ?? null, body.templateLanguage ?? null,
        body.throttlePerMinute ?? DEFAULT_BULK_POLICY.throttlePerMinute,
        currentUser(req).id,
      ],
    );

    // Building now means the consent warning the owner confirms is the same
    // number the campaign will act on.
    const build = await buildMembers(actorFrom(req), id);
    await writeAudit({ actor: actorFrom(req), action: 'campaign.created', entityType: 'campaign', entityId: id, after: { name: body.name, kind: body.kind, ...build } });

    res.status(201).json({ id, ...build });
  }),
);

campaignsRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const campaign = await queryOne<Record<string, unknown>>(
      `SELECT c.*, l.name AS list_name FROM campaigns c LEFT JOIN lists l ON l.id = c.list_id WHERE c.id = ?`,
      [id],
    );
    if (!campaign) throw badRequest('That campaign does not exist');
    res.json({ campaign, stats: await campaignStats(id) });
  }),
);

/** Rebuild the membership, e.g. after the list has grown. */
campaignsRouter.post(
  '/:id/build',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await buildMembers(actorFrom(req), String(req.params.id)));
  }),
);

campaignsRouter.post(
  '/:id/start',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const campaign = await queryOne<{ kind: string; status: string; skipped_no_consent: number }>(
      'SELECT kind, status, skipped_no_consent FROM campaigns WHERE id = ?',
      [id],
    );
    if (!campaign) throw badRequest('That campaign does not exist');

    await execute(
      "UPDATE campaigns SET status = 'running', paused_reason = NULL, started_at = COALESCE(started_at, NOW(3)) WHERE id = ?",
      [id],
    );

    // A call campaign is worked by people; only a WhatsApp campaign sends.
    if (campaign.kind === 'whatsapp') {
      await enqueue('campaign.send_batch', { campaignId: id }, { dedupeKey: `campaign-batch:${id}:start` });
    }

    await writeAudit({ actor: actorFrom(req), action: 'campaign.started', entityType: 'campaign', entityId: id, after: { kind: campaign.kind, skippedNoConsent: campaign.skipped_no_consent } });
    res.json({ ok: true });
  }),
);

campaignsRouter.post(
  '/:id/pause',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ reason: z.string().max(250).default('Paused by a manager') }).parse(req.body);
    await pauseCampaign(actorFrom(req), String(req.params.id), body.reason);
    res.json({ ok: true });
  }),
);

/* ── The power dialler ────────────────────────────────────────────────── */

/** Managers and owners run the campaign, so they may work any row on it. */
function canWorkOthers(role: string): boolean {
  return role === 'manager' || role === 'admin' || role === 'owner';
}

campaignsRouter.post(
  '/:id/next',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const card = await nextForAgent(String(req.params.id), user.id, {
      includeOthers: canWorkOthers(user.role),
    });
    res.json({ card });
  }),
);

const outcomeSchema = z.object({
  memberId: z.string().max(36),
  outcome: z.enum(['answered', 'no_answer', 'busy', 'wrong_number', 'not_interested', 'interested']),
  notes: z.string().max(2000).nullable().optional(),
});

campaignsRouter.post(
  '/:id/outcome',
  asyncHandler(async (req: Request, res: Response) => {
    const body = outcomeSchema.parse(req.body);
    const user = currentUser(req);
    await logOutcome(actorFrom(req), body.memberId, body.outcome, body.notes ?? null);
    // Hand the agent the next one straight away; that is what makes it a dialler.
    const card = await nextForAgent(String(req.params.id), user.id, {
      includeOthers: canWorkOthers(user.role),
    });
    res.json({ ok: true, card });
  }),
);

campaignsRouter.post(
  '/:id/release',
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ memberId: z.string().max(36) }).parse(req.body);
    await releaseMember(body.memberId);
    res.json({ ok: true });
  }),
);
