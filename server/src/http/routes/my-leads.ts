import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth,
} from '../middleware/auth.js';
import { ownerPredicate, visibleUserIds } from '../../auth/scope.js';
import { query, queryOne } from '../../db/client.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { leadBrief, refreshNotesDigest } from '../../ai/lead-review.js';
import { isLeadTab, TABS, LEAD_TABS, type LeadTab } from '../../leads/tabs.js';
import {
  LEAD_ACTIONS, LOST_REASONS, PROBLEM_REASONS, runLeadAction,
} from '../../leads/actions.js';

/**
 * My Leads: the screen an agent lives in.
 *
 * Every query is fenced to what the signed-in person may see, in SQL, by the
 * same `ownerPredicate` the rest of the CRM uses. An agent asking for the
 * "all" tab gets all of *theirs*; there is no parameter that widens it.
 */
export const myLeadsRouter = Router();
myLeadsRouter.use(requireAuth, blockUntilPasswordChanged);

const listSchema = z.object({
  tab: z.string().optional(),
  search: z.string().max(120).optional(),
  /* Manager+ only; an agent asking for someone else's leads is ignored
     rather than refused, because the fence below makes it moot anyway. */
  agent: z.string().max(36).optional(),
  stage: z.string().max(48).optional(),
  source: z.string().max(48).optional(),
  project: z.string().max(160).optional(),
  band: z.enum(['hot', 'warm', 'cold']).optional(),
  /* `namespace:value`, e.g. `batch:expo-2026-30oct-a3f2` — how one upload is
     found again after the fact. */
  tag: z.string().max(160).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(30),
});

interface Filters {
  where: string[];
  args: Array<string | number>;
}

/** The filters that apply whichever tab is open. */
function buildFilters(params: z.infer<typeof listSchema>, visible: string[] | null): Filters {
  const scope = ownerPredicate('o.owner_user_id', visible);
  const where = [scope.sql];
  const args: Array<string | number> = [...scope.params];

  if (params.search) {
    where.push('(c.full_name LIKE ? OR c.phone_e164 LIKE ? OR c.email LIKE ? OR o.project_name LIKE ?)');
    const like = `%${params.search}%`;
    args.push(like, like, like, like);
  }
  /* A manager narrowing to one of their agents. The scope above already
     limits which agents that can be, so no extra check is needed. */
  if (params.agent) {
    where.push('o.owner_user_id = ?');
    args.push(params.agent);
  }
  if (params.stage) {
    where.push('o.stage_key = ?');
    args.push(params.stage);
  }
  if (params.source) {
    where.push('o.source = ?');
    args.push(params.source);
  }
  if (params.project) {
    where.push('o.project_name = ?');
    args.push(params.project);
  }
  if (params.band) {
    where.push('o.score_band = ?');
    args.push(params.band);
  }
  /*
   * EXISTS rather than a join: a contact can carry a dozen tags, and joining
   * would multiply every lead by its tag count before the DISTINCT that would
   * then be needed to undo it.
   */
  if (params.tag) {
    const [namespace, ...rest] = params.tag.split(':');
    const value = rest.join(':');
    if (namespace && value) {
      where.push(
        'EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id'
        + ' WHERE ct.contact_id = c.id AND t.namespace = ? AND t.value = ?)',
      );
      args.push(namespace, value);
    }
  }
  return { where, args };
}

const SELECT = `
  SELECT o.id, o.contact_id, o.stage_key, o.sub_status, o.status, o.project_name, o.source,
         o.budget_min_aed, o.budget_max_aed, o.lead_score, o.score_band, o.score_reason,
         o.next_step_type, o.next_step_at, o.next_step_note, o.last_contact_at,
         o.no_answer_count, o.created_at, o.owner_user_id, o.unit_type, o.preferred_location,
         c.full_name, c.phone_e164, c.email, c.language, c.dnc, c.last_inbound_at,
         u.name AS owner_name
    FROM opportunities o
    JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
    LEFT JOIN users u ON u.id = o.owner_user_id`;

/**
 * The next lead to work after this one.
 *
 * Emir, 10 Nov 2026: "next in the right should be button, next leads, so it
 * will be going next leads, so it's easy." An agent with forty leads was
 * going back to the list and finding their place again after every single
 * call, which is forty detours a day.
 *
 * Oldest first among the open leads this person can see, skipping the one
 * they are on. Oldest because that is the one going coldest, which is the
 * order Incoming uses and the order an agent would pick by hand.
 *
 * Scoped with `visibleUserIds`, the same rule as the list itself, and not
 * `owner_user_id = me`. I wrote it the narrow way first and the button
 * simply never appeared for Emir: an owner personally holds almost no leads,
 * so "the next one of mine" was empty every time while the screen behind it
 * showed hundreds. An agent still gets only their own, because that is what
 * `visibleUserIds` returns for an agent.
 */
/*
 * How far "Next lead" will walk before it stops offering one.
 *
 * Nobody presses the button four thousand times, and an unbounded window
 * over every lead in the CRM is the kind of query that took the site down
 * on 10 Nov.
 */
const WALK_LIMIT = 4000;

myLeadsRouter.get(
  '/:id/next',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const here = String(req.params.id);
    const visible = await visibleUserIds(user);
    const scope = ownerPredicate('o.owner_user_id', visible);

    /*
     * The one AFTER this one, in the order of the list the agent came from.
     *
     * The first version asked for "the oldest open lead that is not this
     * one", which is not a next at all: from the oldest you get the second,
     * and from the second you get the oldest again. Emir's agents, 11 Nov:
     * "it's just repeating only first two leads all over again." They were
     * right, and it had been doing that since the button was built.
     *
     * So it walks the real list. Same tab, same filters, same ORDER BY as
     * My Leads, and `o.id` last so the order is settled: a file of six
     * hundred imported leads shares a `created_at` to the second, and
     * without a tiebreaker MySQL may hand them back in a different order
     * each time -- which on its own is enough to make a walk go in circles.
     *
     * Bounded at WALK_LIMIT. An agent is not pressing this four thousand
     * times, and an unbounded window over every lead in the CRM is the kind
     * of query that took the site down on 10 Nov.
     */
    const tab: LeadTab = isLeadTab(req.query.tab) ? req.query.tab : 'all';
    const definition = TABS[tab];
    const args: (string | number)[] = [...scope.params];

    let clause = `${scope.sql} AND ${definition.where} AND o.owner_user_id IS NOT NULL`;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      clause += ' AND (c.full_name LIKE ? OR c.phone_e164 LIKE ? OR c.email LIKE ? OR o.project_name LIKE ?)';
      const like = `%${search}%`;
      args.push(like, like, like, like);
    }

    const next = await queryOne<{ id: string; contact_id: string; full_name: string | null }>(
      `WITH walk AS (
         SELECT o.id, o.contact_id, c.full_name,
                ROW_NUMBER() OVER (ORDER BY ${definition.orderBy}, o.id ASC) AS seat
           FROM opportunities o
           JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
          WHERE ${clause}
          ORDER BY ${definition.orderBy}, o.id ASC
          LIMIT ${WALK_LIMIT}
       )
       SELECT id, contact_id, full_name FROM walk
        WHERE seat > COALESCE((SELECT seat FROM walk WHERE id = ?), 0)
        ORDER BY seat ASC
        LIMIT 1`,
      [...args, here],
    );

    /* Null rather than a 404: "nothing left" is an answer the button shows,
       not an error it has to handle. */
    res.json({ next: next ?? null });
  }),
);

myLeadsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const params = listSchema.parse(req.query);
    const tab: LeadTab = isLeadTab(params.tab) ? params.tab : 'today';
    const visible = await visibleUserIds(user);
    const { where, args } = buildFilters(params, visible);

    const definition = TABS[tab];
    const clause = [definition.where, ...where].join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const items = await query(
      `${SELECT} WHERE ${clause} ORDER BY ${definition.orderBy} LIMIT ${params.pageSize} OFFSET ${offset}`,
      args,
    );
    const total = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
        WHERE ${clause}`,
      args,
    );

    res.json({
      tab,
      items,
      page: params.page,
      pageSize: params.pageSize,
      total: Number(total?.n ?? 0),
      empty: { title: definition.emptyTitle, hint: definition.emptyHint },
    });
  }),
);

/**
 * The number on each tab.
 *
 * One query with a CASE per tab rather than six round trips: this runs every
 * time the screen opens, and six COUNT(*) over the same rows is five more
 * table scans than the answer needs.
 */
myLeadsRouter.get(
  '/counts',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const params = listSchema.parse(req.query);
    const visible = await visibleUserIds(user);
    const { where, args } = buildFilters(params, visible);

    const counted = LEAD_TABS.filter((tab) => tab !== 'all');
    const row = await queryOne<Record<string, number>>(
      `SELECT ${counted.map((tab) => `SUM(${TABS[tab].where}) AS \`${tab}\``).join(', ')},
              COUNT(*) AS \`all\`
         FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
        WHERE ${where.join(' AND ')}`,
      args,
    );

    res.json(Object.fromEntries(LEAD_TABS.map((tab) => [tab, Number(row?.[tab] ?? 0)])));
  }),
);

const actionSchema = z.object({
  action: z.enum(LEAD_ACTIONS),
  reason: z.string().max(60).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  nextStep: z.object({
    type: z.enum(['call', 'whatsapp', 'email', 'meeting', 'viewing', 'other']),
    at: z.string().min(4),
    note: z.string().max(255).nullable().optional(),
  }).nullable().optional(),
  meetingAt: z.string().nullable().optional(),
  meetingKind: z.string().max(60).nullable().optional(),
  meetingWhere: z.string().max(200).nullable().optional(),
  wonProject: z.string().max(160).nullable().optional(),
  wonUnit: z.string().max(60).nullable().optional(),
});

/**
 * One of the nine buttons.
 *
 * The permission check is "can I see this lead", because an agent acting on
 * their own lead is the normal case and a manager acting on their team's is
 * the other one. Anything outside that is already invisible to them.
 */
myLeadsRouter.post(
  '/:id/action',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const opportunityId = String(req.params.id);
    const parsed = actionSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('That is not an action this lead can take.', parsed.error.issues);

    const visible = await visibleUserIds(user);
    const scope = ownerPredicate('o.owner_user_id', visible);
    const allowed = await queryOne<{ id: string }>(
      `SELECT o.id FROM opportunities o WHERE o.id = ? AND o.deleted_at IS NULL AND ${scope.sql}`,
      [opportunityId, ...scope.params],
    );
    if (!allowed) throw badRequest('That lead is not yours to work.');

    if (parsed.data.action === 'lost' && parsed.data.reason
      && !(LOST_REASONS as readonly string[]).includes(parsed.data.reason)) {
      throw badRequest('That is not one of the reasons a deal is lost.');
    }
    if (parsed.data.action === 'problem' && parsed.data.reason
      && !(PROBLEM_REASONS as readonly string[]).includes(parsed.data.reason)) {
      throw badRequest('That is not one of the problems a lead can have.');
    }

    res.json(await runLeadAction(actorFrom(req), { opportunityId, ...parsed.data }));
  }),
);

const nextStepSchema = z.object({
  type: z.enum(['call', 'whatsapp', 'email', 'meeting', 'viewing', 'other']),
  at: z.string().min(4),
  note: z.string().max(255).nullable().optional(),
});

/** Setting or changing what is owed next, on its own. */
myLeadsRouter.post(
  '/:id/next-step',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const opportunityId = String(req.params.id);
    const body = nextStepSchema.parse(req.body);

    const visible = await visibleUserIds(user);
    const scope = ownerPredicate('o.owner_user_id', visible);
    const allowed = await queryOne<{ id: string; contact_id: string }>(
      `SELECT o.id, o.contact_id FROM opportunities o
        WHERE o.id = ? AND o.deleted_at IS NULL AND ${scope.sql}`,
      [opportunityId, ...scope.params],
    );
    if (!allowed) throw badRequest('That lead is not yours to work.');

    const result = await runLeadAction(actorFrom(req), {
      opportunityId,
      /* Recorded as a callback being set rather than a silent field edit:
         who promised what, and when, is worth keeping. */
      action: 'call_back',
      nextStep: body,
    });
    res.json(result);
  }),
);

/**
 * The brief at the top of the lead page: what the notes add up to, what the AI
 * makes of the lead, and what to do next.
 *
 * A plain read — no model call — so opening a lead is never slower because of
 * it. The notes summary is whatever was last worked out, with a `stale` flag
 * when somebody has added a note since; the screen offers a Refresh button
 * rather than spending a model call on every page load.
 */
myLeadsRouter.get(
  '/:id/brief',
  asyncHandler(async (req: Request, res: Response) => {
    const opportunityId = String(req.params.id);
    await assertLeadIsVisible(req, opportunityId);
    const brief = await leadBrief(opportunityId);
    if (!brief) throw notFound('That lead no longer exists.');
    res.json(brief);
  }),
);

/** Re-read the notes. Rate-limited, because each one is a model call. */
myLeadsRouter.post(
  '/:id/brief',
  rateLimit({ windowMs: 60_000, max: 10, keyFor: (req: Request) => `brief:${currentUser(req).id}` }),
  asyncHandler(async (req: Request, res: Response) => {
    const opportunityId = String(req.params.id);
    await assertLeadIsVisible(req, opportunityId);
    const digest = await refreshNotesDigest(opportunityId, { force: true });
    const brief = await leadBrief(opportunityId);
    res.json({ ...brief, refreshed: digest !== null });
  }),
);

/**
 * The same fence as everything else on this screen, in one place: an agent can
 * only reach their own leads, a manager their team's.
 */
async function assertLeadIsVisible(req: Request, opportunityId: string): Promise<void> {
  const visible = await visibleUserIds(currentUser(req));
  const scope = ownerPredicate('o.owner_user_id', visible);
  const allowed = await queryOne<{ id: string }>(
    `SELECT o.id FROM opportunities o WHERE o.id = ? AND o.deleted_at IS NULL AND ${scope.sql}`,
    [opportunityId, ...scope.params],
  );
  if (!allowed) throw badRequest('That lead is not yours to work.');
}
