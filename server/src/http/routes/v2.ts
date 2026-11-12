import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth, requireRole,
} from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { agentHome, ownerHome, type Home } from '../../v2/home.js';
import { acceptVip, refuseVip } from '../../v2/vip.js';
import {
  answerTap, callQueue, CALL_OUTCOMES, finishCall, logTap, startCall, TAP_RESULTS,
} from '../../v2/calls.js';
import {
  agentsWithLoad, cameBack, freeLeads, shareLeads, takeLead,
} from '../../v2/incoming.js';
import { queryOne } from '../../db/client.js';
import { visibleUserIds } from '../../auth/scope.js';
import { leadTabCounts } from '../../leads/counts.js';

/**
 * The v2 screens' own endpoints.
 *
 * Mounted at `/api/v2` and deliberately separate from the live routes: the
 * CRM ten people use today keeps answering exactly as it did, and nothing
 * here can change that by accident. Where a v2 screen needs the same data as
 * a live one it calls the same service, not a copy of the query.
 */
export const v2Router = Router();
v2Router.use(requireAuth, blockUntilPasswordChanged);

/**
 * The address the office is seen from.
 *
 * The LAST entry of X-Forwarded-For, not the first: behind one reverse proxy
 * the last is the one the proxy appended and the only one a browser cannot
 * set itself. Same reading as `attendance.ts`, and for the same reason.
 */
function networkIp(req: Request): string | null {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((part) => part.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return req.ip ?? req.socket.remoteAddress ?? null;
}

/**
 * Home, shaped by who is asking.
 *
 * An agent gets their day; an owner gets the company's. Which one is decided
 * here from the session, never from a query parameter — there is no way to
 * ask for the owner's figures as an agent.
 */
v2Router.get(
  '/home',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const ip = networkIp(req);
    const home: Home = user.role === 'agent'
      ? await agentHome(user, ip)
      : await ownerHome(user, ip);
    res.json(home);
  }),
);

/* ── VIP leads ─────────────────────────────────────────────────────────── */

const vipLimit = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyFor: (req) => `vip:${currentUser(req).id}`,
  message: 'Too many taps in a minute. Please wait a moment.',
});

/** "I have it." Stops the clock and tells whoever gave it. */
v2Router.post(
  '/vip/:id/accept',
  vipLimit,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await acceptVip(actorFrom(req), String(req.params.id), currentUser(req).id));
  }),
);

const refuseSchema = z.object({ note: z.string().max(500).nullable().optional() });

/**
 * "I can't take it." The lead goes back to the giver's Incoming.
 *
 * A note is optional but asked for on screen: "busy with a viewing" is what
 * makes the owner's next decision a good one, and an unexplained refusal is
 * the thing that makes them stop handing leads over personally at all.
 */
v2Router.post(
  '/vip/:id/refuse',
  vipLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const { note } = refuseSchema.parse(req.body ?? {});
    res.json(await refuseVip(
      actorFrom(req), String(req.params.id), currentUser(req).id, note ?? null,
    ));
  }),
);

/* ── calling ───────────────────────────────────────────────────────────── */

/** The day's queue: the Today list, VIP first. */
v2Router.get(
  '/queue',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ items: await callQueue(currentUser(req)) });
  }),
);

const startSchema = z.object({
  opportunityId: z.string().min(1).max(36),
  source: z.enum(['lead', 'dialler', 'followup', 'incoming', 'other']).optional(),
  /*
   * The browser says whether the agent went ahead without checking in. It is
   * not trusted as a claim of innocence -- the server can only ever be told
   * "I was not checked in", never "I was" -- but it is the only place that
   * knows the agent pressed "Call anyway", and the owner is shown it.
   */
  notCheckedIn: z.boolean().optional(),
});

v2Router.post(
  '/calls',
  rateLimit({
    windowMs: 60_000,
    max: 60,
    keyFor: (req) => `call:${currentUser(req).id}`,
    message: 'That is a lot of calls in a minute. Please wait a moment.',
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = startSchema.parse(req.body);
    res.json(await startCall(actorFrom(req), currentUser(req), input));
  }),
);

const outcomeSchema = z.object({
  outcome: z.enum(CALL_OUTCOMES),
  note: z.string().max(500).nullable().optional(),
  callBackAt: z.string().min(4).max(40).nullable().optional(),
  reason: z.string().max(60).nullable().optional(),
});

/** What happened on the call. This is also what moves the lead. */
v2Router.patch(
  '/calls/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const input = outcomeSchema.parse(req.body);
    res.json(await finishCall(actorFrom(req), currentUser(req), String(req.params.id), input));
  }),
);

const tapSchema = z.object({
  opportunityId: z.string().min(1).max(36),
  app: z.enum(['whatsapp', 'telegram']),
  templateKey: z.string().max(80).nullable().optional(),
  text: z.string().max(4000).nullable().optional(),
});

/**
 * The agent tapped WhatsApp or Telegram.
 *
 * Recorded as a tap, never as a message sent: the CRM hands the agent over to
 * the real app and has no way of knowing what happened there. Asking
 * afterwards is the honest version, and it is what the design asks for.
 */
v2Router.post(
  '/taps',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await logTap(currentUser(req), tapSchema.parse(req.body)));
  }),
);

const answerSchema = z.object({
  result: z.enum(TAP_RESULTS),
  note: z.string().max(500).nullable().optional(),
});

v2Router.patch(
  '/taps/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const input = answerSchema.parse(req.body);
    res.json(await answerTap(actorFrom(req), currentUser(req), String(req.params.id), input));
  }),
);

/* ── incoming ──────────────────────────────────────────────────────────── */

/**
 * The free-lead queue.
 *
 * Both roles see the same leads; an owner also gets the people to hand them
 * to and the ones that bounced back to them. An agent is never sent the team
 * list — who else holds how many leads is not their business, and it is the
 * sort of thing that leaks into a conversation.
 */
v2Router.get(
  '/incoming',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const free = await freeLeads();
    if (user.role === 'agent') {
      res.json({ role: 'agent', free });
      return;
    }
    const [agents, back] = await Promise.all([agentsWithLoad(), cameBack(user.id)]);
    res.json({ role: 'owner', free, agents, cameBack: back });
  }),
);

/** "Take this lead." */
v2Router.post(
  '/incoming/:id/take',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await takeLead(actorFrom(req), currentUser(req), String(req.params.id)));
  }),
);

const shareSchema = z.object({
  opportunityIds: z.array(z.string().min(1).max(36)).min(1).max(500),
  agentUserIds: z.array(z.string().min(1).max(36)).min(1).max(50),
});

/** "Share the normal leads equally." VIP leads are never in the share. */
v2Router.post(
  '/incoming/share',
  requireRole('owner', 'admin', 'manager'),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await shareLeads(actorFrom(req), shareSchema.parse(req.body)));
  }),
);

/* ── the numbers on the menu ───────────────────────────────────────────── */

/**
 * Every badge in the sidebar, in one answer.
 *
 * Five separate endpoints polled from five components is five requests per
 * page per person per minute, and the sidebar is on every screen. One row of
 * counts costs one round trip.
 *
 * Each number means the same thing the screen behind it shows, because they
 * are the same queries. A badge that says 3 over a list of 5 is worse than no
 * badge at all (docs/v2/rules.md S-25).
 */
v2Router.get(
  '/badges',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const isAgent = user.role === 'agent';
    const visible = await visibleUserIds(user);
    const [counts, free, transfers, tasks, leave] = await Promise.all([
      leadTabCounts(visible),
      queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM opportunities
          WHERE status = 'open' AND owner_user_id IS NULL AND deleted_at IS NULL`,
      ),
      queryOne<{ n: number }>(
        isAgent
          ? "SELECT COUNT(*) AS n FROM lead_transfers WHERE to_user_id = ? AND status = 'pending'"
          : "SELECT COUNT(*) AS n FROM lead_transfers WHERE status = 'needs_approval'",
        isAgent ? [user.id] : [],
      ),
      queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM tasks
          WHERE assigned_user_id = ? AND completed_at IS NULL AND due_at < NOW(3)`,
        [user.id],
      ),
      isAgent
        ? Promise.resolve({ n: 0 })
        : queryOne<{ n: number }>(
          "SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'",
        ),
    ]);

    res.json({
      incoming: Number(free?.n ?? 0),
      followups: counts.overdue,
      transfers: Number(transfers?.n ?? 0),
      tasks: Number(tasks?.n ?? 0),
      leave: Number(leave?.n ?? 0),
    });
  }),
);
