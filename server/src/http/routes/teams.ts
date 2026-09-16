import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAdmin, requireAuth, requireManager,
} from '../middleware/auth.js';
import { execute, query, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { badRequest } from '../../lib/errors.js';
import { writeAudit } from '../../audit/audit.js';
import { claimNextLead, loadCandidates, poolStatus, releaseClaim } from '../../assignment/apply.js';

export const teamsRouter = Router();
teamsRouter.use(requireAuth, blockUntilPasswordChanged);

/* ── Teams ────────────────────────────────────────────────────────────── */

teamsRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const teams = await query<{ id: string; name: string; description: string | null; manager_name: string | null }>(
      `SELECT t.id, t.name, t.description, u.name AS manager_name
         FROM teams t LEFT JOIN users u ON u.id = t.manager_user_id
        WHERE t.is_active = 1
        ORDER BY t.name`,
    );
    const members = await query<{ team_id: string; user_id: string; name: string; open_leads: number }>(
      `SELECT tm.team_id, tm.user_id, u.name,
              (SELECT COUNT(*) FROM opportunities o WHERE o.owner_user_id = u.id AND o.status = 'open') AS open_leads
         FROM team_members tm JOIN users u ON u.id = tm.user_id
        ORDER BY u.name`,
    );

    res.json({
      items: teams.map((team) => ({
        ...team,
        members: members
          .filter((member) => member.team_id === team.id)
          .map((member) => ({ userId: member.user_id, name: member.name, openLeads: Number(member.open_leads) })),
      })),
    });
  }),
);

const teamSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  managerUserId: z.string().max(36).nullable().optional(),
  memberIds: z.array(z.string().max(36)).max(200).optional(),
});

teamsRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const body = teamSchema.parse(req.body);
    const id = newId();
    await execute('INSERT INTO teams (id, name, description, manager_user_id) VALUES (?, ?, ?, ?)', [
      id, body.name, body.description ?? null, body.managerUserId ?? null,
    ]);
    for (const userId of body.memberIds ?? []) {
      await execute('INSERT IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)', [id, userId]);
    }
    await writeAudit({ actor: actorFrom(req), action: 'team.created', entityType: 'team', entityId: id, after: { name: body.name, members: body.memberIds?.length ?? 0 } });
    res.status(201).json({ id });
  }),
);

teamsRouter.patch(
  '/:id',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const body = teamSchema.partial().parse(req.body);

    const patch: string[] = [];
    const args: unknown[] = [];
    if (body.name !== undefined) { patch.push('name = ?'); args.push(body.name); }
    if (body.description !== undefined) { patch.push('description = ?'); args.push(body.description); }
    if (body.managerUserId !== undefined) { patch.push('manager_user_id = ?'); args.push(body.managerUserId); }
    if (patch.length > 0) {
      await execute(`UPDATE teams SET ${patch.join(', ')} WHERE id = ?`, [...args, id] as never[]);
    }

    if (body.memberIds) {
      // The list replaces the membership wholesale, which is what the editor
      // in the UI actually means when it saves.
      await execute('DELETE FROM team_members WHERE team_id = ?', [id]);
      for (const userId of body.memberIds) {
        await execute('INSERT IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)', [id, userId]);
      }
    }

    await writeAudit({ actor: actorFrom(req), action: 'team.updated', entityType: 'team', entityId: id, after: body });
    res.json({ ok: true });
  }),
);

teamsRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    // Deactivated rather than deleted: the assignment history refers to it.
    await execute('UPDATE teams SET is_active = 0 WHERE id = ?', [id]);
    await writeAudit({ actor: actorFrom(req), action: 'team.deactivated', entityType: 'team', entityId: id });
    res.json({ ok: true });
  }),
);

/** Who could take work, and how loaded they are. Shown before assigning. */
teamsRouter.get(
  '/candidates',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const teamId = req.query.teamId ? String(req.query.teamId) : null;
    res.json({ items: await loadCandidates({ teamId }) });
  }),
);

/* ── Assignment rules ─────────────────────────────────────────────────── */

const ruleSchema = z.object({
  name: z.string().min(1).max(120),
  method: z.enum(['agent', 'team_round_robin', 'split_even', 'split_percent', 'by_rule', 'pool']),
  targetUserId: z.string().max(36).nullable().optional(),
  targetTeamId: z.string().max(36).nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

teamsRouter.get(
  '/rules',
  requireManager,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      items: await query(
        `SELECT r.id, r.name, r.method, r.target_user_id, r.target_team_id, r.config, r.is_active,
                u.name AS target_user_name, t.name AS target_team_name
           FROM assignment_rules r
           LEFT JOIN users u ON u.id = r.target_user_id
           LEFT JOIN teams t ON t.id = r.target_team_id
          ORDER BY r.name`,
      ),
    });
  }),
);

teamsRouter.post(
  '/rules',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const body = ruleSchema.parse(req.body);
    const id = newId();
    await execute(
      `INSERT INTO assignment_rules (id, name, method, target_user_id, target_team_id, config, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id, body.name, body.method, body.targetUserId ?? null, body.targetTeamId ?? null,
        body.config ? JSON.stringify(body.config) : null, currentUser(req).id,
      ],
    );
    await writeAudit({ actor: actorFrom(req), action: 'assignment_rule.created', entityType: 'assignment_rule', entityId: id, after: { name: body.name, method: body.method } });
    res.status(201).json({ id });
  }),
);

teamsRouter.delete(
  '/rules/:id',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    await execute('DELETE FROM assignment_rules WHERE id = ?', [id]);
    await writeAudit({ actor: actorFrom(req), action: 'assignment_rule.deleted', entityType: 'assignment_rule', entityId: id });
    res.json({ ok: true });
  }),
);

/* ── The shared pool ──────────────────────────────────────────────────── */

teamsRouter.get(
  '/pool',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const status = await poolStatus(user.id);
    const claimed = await query(
      `SELECT pc.opportunity_id, pc.contact_id, pc.claimed_at, c.full_name, c.phone_e164, c.lead_score,
              o.stage_key, o.project_name
         FROM lead_pool_claims pc
         JOIN contacts c ON c.id = pc.contact_id
         JOIN opportunities o ON o.id = pc.opportunity_id
        WHERE pc.user_id = ? AND pc.released_at IS NULL
        ORDER BY pc.claimed_at DESC`,
      [user.id],
    );
    res.json({ ...status, claimed });
  }),
);

teamsRouter.post(
  '/pool/claim',
  asyncHandler(async (req: Request, res: Response) => {
    const lead = await claimNextLead(actorFrom(req), currentUser(req).id);
    if (!lead) throw badRequest('There are no leads waiting in the pool');
    res.json(lead);
  }),
);

teamsRouter.post(
  '/pool/release',
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ opportunityId: z.string().max(36) }).parse(req.body);
    await releaseClaim(actorFrom(req), body.opportunityId, currentUser(req).id);
    res.json({ ok: true });
  }),
);
