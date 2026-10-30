import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth, requireManager,
} from '../middleware/auth.js';
import { execute, query, queryOne, withRetryingTransaction } from '../../db/client.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../audit/audit.js';
import { acceptLead, recordAssignment } from '../../routing/assignments.js';
import { armSlaTimer } from '../../workflows/workflow-a.js';
import { routingSettings, saveRoutingSettings } from '../../routing/settings.js';
import { notify } from '../../messaging/notify.js';
import { logger, errorContext } from '../../lib/logger.js';

/**
 * Incoming: the leads nobody is working.
 *
 * Three ways in. A lead arrives when no agent is on shift or none speaks the
 * language. An agent is given one and lets the clock run out, so it comes
 * back. Or a batch is imported and left for a person to place.
 *
 * Deliberately not where every lead starts. A new lead is still assigned the
 * instant it arrives and the client still gets a reply inside thirty seconds;
 * routing every lead through a person first would mean a lead arriving at 2am
 * waits until morning. This page is the exception queue, not the front door.
 */
export const incomingRouter = Router();
incomingRouter.use(requireAuth, blockUntilPasswordChanged);

interface IncomingRow {
  id: string;
  contact_id: string;
  title: string | null;
  project_name: string | null;
  budget_max_aed: number | null;
  source: string | null;
  lead_score: number | null;
  bounce_count: number;
  created_at: Date;
  full_name: string | null;
  phone_e164: string | null;
  language: string | null;
  reason: string | null;
}

/** Everything waiting for an owner, oldest first — the ones going coldest. */
incomingRouter.get(
  '/',
  requireManager,
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await query<IncomingRow>(
      `SELECT o.id, o.contact_id, o.title, o.project_name, o.budget_max_aed, o.source,
              o.lead_score, o.bounce_count, o.created_at,
              c.full_name, c.phone_e164, c.language,
              q.reason
         FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id
         LEFT JOIN unassigned_queue q ON q.opportunity_id = o.id AND q.resolved_at IS NULL
        WHERE o.status = 'open' AND o.owner_user_id IS NULL
          AND o.deleted_at IS NULL AND c.deleted_at IS NULL
        ORDER BY o.created_at ASC
        LIMIT 200`,
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        contactId: row.contact_id,
        name: row.full_name,
        phone: row.phone_e164,
        language: row.language,
        project: row.project_name,
        budgetMaxAed: row.budget_max_aed,
        source: row.source,
        score: row.lead_score,
        bounceCount: Number(row.bounce_count),
        reason: row.reason,
        arrivedAt: row.created_at,
      })),
    });
  }),
);

/**
 * The count for the sidebar badge.
 *
 * Separate from the list because it is read on every page by everyone who can
 * see it, and the list is four joins. Agents get 0 rather than a 403: the
 * badge should simply not appear for them, and an error in the console on
 * every page load is how people learn to ignore the console.
 */
incomingRouter.get(
  '/count',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    if (user.role === 'agent') {
      res.json({ count: 0 });
      return;
    }
    const row = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities
        WHERE status = 'open' AND owner_user_id IS NULL AND deleted_at IS NULL`,
    );
    res.json({ count: Number(row?.n ?? 0) });
  }),
);

/**
 * The leads waiting for this agent to say "mine".
 *
 * Polled by the card that slides in on every screen. The seconds left are
 * worked out here rather than in the browser: a phone whose clock is two
 * minutes out would otherwise show a countdown that disagrees with the one
 * actually running, and the agent would watch it hit zero with time to spare
 * — or worse, think they had time they did not.
 */
incomingRouter.get(
  '/pending',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const { slaMinutes } = await routingSettings();

    const rows = await query<{
      id: string;
      contact_id: string;
      full_name: string | null;
      phone_e164: string | null;
      project_name: string | null;
      budget_max_aed: number | null;
      source: string | null;
      seconds_left: number;
    }>(
      `SELECT o.id, o.contact_id, c.full_name, c.phone_e164, o.project_name, o.budget_max_aed, o.source,
              TIMESTAMPDIFF(SECOND, NOW(3), DATE_ADD(o.assigned_at, INTERVAL ? MINUTE)) AS seconds_left
         FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id
        WHERE o.owner_user_id = ? AND o.status = 'open'
          AND o.deleted_at IS NULL AND c.deleted_at IS NULL
          AND o.accepted_at IS NULL AND o.assigned_at IS NOT NULL
        ORDER BY o.assigned_at ASC
        LIMIT 5`,
      [slaMinutes, user.id],
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        contactId: row.contact_id,
        name: row.full_name,
        phone: row.phone_e164,
        project: row.project_name,
        budgetMaxAed: row.budget_max_aed,
        source: row.source,
        // Negative means the clock has run out and the sweep has not caught
        // up yet; the card shows that honestly rather than counting backwards.
        secondsLeft: Number(row.seconds_left),
      })),
    });
  }),
);

const assignSchema = z.object({
  opportunityIds: z.array(z.string().min(1)).min(1).max(100),
  agentUserId: z.string().min(1),
});

/**
 * Hand leads to an agent.
 *
 * One lead or a hundred, the same path: a manager picking off a bounced lead
 * and a manager splitting an imported batch are the same action, and having
 * one of them take a different route is how the two drift apart.
 */
incomingRouter.post(
  '/assign',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Choose at least one lead and an agent.', parsed.error.issues);
    const { opportunityIds, agentUserId } = parsed.data;
    const actor = actorFrom(req);

    const agent = await queryOne<{ id: string; name: string; is_active: number }>(
      'SELECT id, name, is_active FROM users WHERE id = ?',
      [agentUserId],
    );
    if (!agent) throw notFound('That agent no longer exists.');
    if (!agent.is_active) throw badRequest(`${agent.name} is deactivated and cannot take leads.`);

    const assigned: string[] = [];
    for (const opportunityId of opportunityIds) {
      /*
       * One transaction per lead rather than one for the batch: a hundred
       * leads held in a single transaction locks every one of those rows
       * while agents are working, and one bad row would roll back the other
       * ninety-nine. A partial batch is reported honestly instead.
       */
      const done = await withRetryingTransaction(async (tx) => {
        const opportunity = await queryOne<{ id: string; contact_id: string; status: string; owner_user_id: string | null }>(
          'SELECT id, contact_id, status, owner_user_id FROM opportunities WHERE id = ? FOR UPDATE',
          [opportunityId],
          tx,
        );
        if (!opportunity || opportunity.status !== 'open') return null;

        await execute(
          'UPDATE opportunities SET owner_user_id = ?, assigned_at = NOW(3), accepted_at = NULL WHERE id = ?',
          [agentUserId, opportunityId],
          tx,
        );
        await execute(
          'UPDATE contacts SET owner_user_id = ? WHERE id = ?',
          [agentUserId, opportunity.contact_id],
          tx,
        );
        await execute(
          'UPDATE conversations SET assigned_user_id = ? WHERE contact_id = ?',
          [agentUserId, opportunity.contact_id],
          tx,
        );
        await execute(
          'UPDATE unassigned_queue SET resolved_at = NOW(3), resolved_by_user_id = ? WHERE opportunity_id = ? AND resolved_at IS NULL',
          [actor.userId, opportunityId],
          tx,
        );
        await recordAssignment(tx, {
          opportunityId,
          contactId: opportunity.contact_id,
          agentUserId,
          assignedByUserId: actor.userId,
        });
        await writeAudit(
          {
            actor,
            action: 'lead.assigned',
            entityType: 'opportunity',
            entityId: opportunityId,
            before: { ownerUserId: opportunity.owner_user_id },
            after: { ownerUserId: agentUserId },
          },
          tx,
        );
        return opportunity.contact_id;
      });

      if (done) {
        assigned.push(opportunityId);
        // The clock only starts once the lead is really theirs.
        await armSlaTimer({ opportunityId, contactId: done, assignedUserId: agentUserId, phase: 'accept' })
          .catch((err: unknown) => logger.warn('could not arm the accept timer', errorContext(err)));
        /* Recorded, then pushed. A phone that was face-down must not be the
           reason an agent never learns a lead is theirs. */
        await notify({
          userId: agentUserId,
          type: 'lead_assigned',
          title: 'New lead for you',
          body: 'Open it and call — you have a few minutes before it goes back.',
          link: `/contacts/${done}`,
          contactId: done,
          opportunityId,
          priority: 'high',
        }).catch(() => undefined);
      }
    }

    res.json({ assigned: assigned.length, skipped: opportunityIds.length - assigned.length });
  }),
);

/**
 * The agent says a lead is theirs.
 *
 * Any signed-in user may call it; `acceptLead` refuses unless the lead is
 * actually theirs, because that rule belongs on the server and not in the
 * button that happens to be on screen.
 */
incomingRouter.post(
  '/:id/accept',
  asyncHandler(async (req: Request, res: Response) => {
    const opportunityId = String(req.params.id);
    const actor = actorFrom(req);
    // `currentUser` rather than the actor's id: inside requireAuth there is
    // always a real person, and the audit actor's id is nullable for the
    // system's own writes.
    const agentUserId = currentUser(req).id;
    const { acceptedAt } = await acceptLead(actor, opportunityId);

    const opportunity = await queryOne<{ contact_id: string }>(
      'SELECT contact_id FROM opportunities WHERE id = ?',
      [opportunityId],
    );
    if (opportunity) {
      /*
       * A second clock, for actually doing something. Accepting a lead and
       * then leaving it is the behaviour this exists to catch.
       */
      await armSlaTimer({
        opportunityId,
        contactId: opportunity.contact_id,
        assignedUserId: agentUserId,
        phase: 'action',
      }).catch((err: unknown) => logger.warn('could not arm the action timer', errorContext(err)));
    }

    const { slaMinutes } = await routingSettings();
    res.json({ acceptedAt, actionDueInMinutes: slaMinutes });
  }),
);

/* ── Routing settings — owner's dials ─────────────────────────────────── */

incomingRouter.get(
  '/settings',
  requireManager,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await routingSettings());
  }),
);

const CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$/;

const settingsSchema = z.object({
  slaMinutes: z.number().int().optional(),
  reminderMinutes: z.number().int().optional(),
  autoAssign: z.boolean().optional(),
  bounceToOwner: z.boolean().optional(),
  emailOwnerOnNewLead: z.boolean().optional(),
  quietHours: z.boolean().optional(),
  /* Rejected here as well as normalised later: an owner who typed "9pm"
     should be told, not silently given ten at night. */
  quietStart: z.string().regex(CLOCK, 'Use a 24-hour time such as 22:00').optional(),
  quietEnd: z.string().regex(CLOCK, 'Use a 24-hour time such as 08:00').optional(),
});

incomingRouter.patch(
  '/settings',
  asyncHandler(async (req: Request, res: Response) => {
    // Owner only — these decide whether leads are answered in thirty seconds
    // or sit in a queue, which is not a manager's call to make.
    if (currentUser(req).role !== 'owner') throw badRequest('Only the owner can change lead routing.');
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('That is not a valid routing setting.', parsed.error.issues);
    res.json(await saveRoutingSettings(actorFrom(req), parsed.data));
  }),
);
