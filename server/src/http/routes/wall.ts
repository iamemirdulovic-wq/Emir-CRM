import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth, requirePermission,
} from '../middleware/auth.js';
import { notFound } from '../../lib/errors.js';
import { execute, query, queryOne } from '../../db/client.js';
import {
  addComment, createPost, deletePost, feed, giveKudos, kudosLeft, pinPost, pointsFor, toggleReaction,
} from '../../wall/wall.js';
import { levelFromPoints, streakFrom } from '../../wall/xp.js';
import { BADGES } from '../../profiles/badges.js';

/**
 * The Team Wall.
 *
 * Everybody signed in can read and post. The moderation — pinning, removing
 * somebody else's post, showing a deal's value — is owner and admin only.
 */
export const wallRouter = Router();
wallRouter.use(requireAuth, blockUntilPasswordChanged);

wallRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    res.json({ items: await feed(user.id, 30, before) });
  }),
);

const postSchema = z.object({
  body: z.string().max(4000).nullable().optional(),
  media: z.array(z.object({
    url: z.string().max(500),
    kind: z.string().max(20),
    name: z.string().max(200).optional(),
  })).max(8).nullable().optional(),
  poll: z.object({
    question: z.string().min(1).max(200),
    options: z.array(z.string().min(1).max(80)).min(2).max(6),
  }).nullable().optional(),
});

wallRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const id = await createPost(actorFrom(req), postSchema.parse(req.body));
    res.status(201).json({ id });
  }),
);

wallRouter.post(
  '/:id/react',
  asyncHandler(async (req: Request, res: Response) => {
    const emoji = z.object({ emoji: z.string().min(1).max(16) }).parse(req.body).emoji;
    const on = await toggleReaction(currentUser(req).id, String(req.params.id), emoji);
    res.json({ on });
  }),
);

wallRouter.post(
  '/:id/comments',
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ body: z.string().min(1).max(2000) }).parse(req.body).body;
    res.status(201).json({ id: await addComment(actorFrom(req), String(req.params.id), body) });
  }),
);

/** Every comment on one post, for when there are more than the feed shows. */
wallRouter.get(
  '/:id/comments',
  asyncHandler(async (req: Request, res: Response) => {
    const items = await query(
      `SELECT c.id, c.author_id, u.name AS author_name, c.body, c.created_at
         FROM wall_comments c
         LEFT JOIN users u ON u.id = c.author_id
        WHERE c.post_id = ? AND c.deleted_at IS NULL
        ORDER BY c.created_at ASC LIMIT 200`,
      [String(req.params.id)],
    );
    res.json({ items });
  }),
);

wallRouter.post(
  '/:id/vote',
  asyncHandler(async (req: Request, res: Response) => {
    const choice = z.object({ option: z.number().int().min(0).max(5) }).parse(req.body).option;
    const postId = String(req.params.id);
    const user = currentUser(req);

    const post = await queryOne<{ poll: unknown }>(
      "SELECT poll FROM wall_posts WHERE id = ? AND kind = 'poll' AND deleted_at IS NULL",
      [postId],
    );
    if (!post?.poll) throw notFound('That poll is gone');

    const poll = (typeof post.poll === 'string' ? JSON.parse(post.poll) : post.poll) as {
      question: string; options: string[]; votes: Record<string, number>;
    };
    if (choice >= poll.options.length) throw notFound('That option is not on the poll');

    /* One vote each, changeable: the record is who voted for what, so a
       second vote replaces the first rather than adding to it. */
    poll.votes = { ...poll.votes, [user.id]: choice };
    await execute('UPDATE wall_posts SET poll = ? WHERE id = ?', [JSON.stringify(poll), postId]);
    res.json({ ok: true });
  }),
);

wallRouter.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const ok = await deletePost(actorFrom(req), String(req.params.id));
    if (!ok) throw notFound('That post is already gone');
    res.json({ ok });
  }),
);

wallRouter.post(
  '/:id/pin',
  requirePermission('users:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const pinned = z.object({ pinned: z.boolean() }).parse(req.body).pinned;
    await pinPost(actorFrom(req), String(req.params.id), pinned);
    res.json({ ok: true });
  }),
);

/** Showing what a deal was worth. Off unless somebody turns it on. */
wallRouter.post(
  '/:id/show-value',
  requirePermission('users:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const show = z.object({ show: z.boolean() }).parse(req.body).show;
    await execute('UPDATE wall_posts SET show_value = ? WHERE id = ?', [show ? 1 : 0, String(req.params.id)]);
    res.json({ ok: true });
  }),
);

/* ── Kudos ──────────────────────────────────────────────────────────────── */

wallRouter.post(
  '/kudos',
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({
      toUserId: z.string().max(36),
      reason: z.string().min(3).max(400),
    }).parse(req.body);
    res.json(await giveKudos(actorFrom(req), body.toUserId, body.reason));
  }),
);

/* ── The sidebar ────────────────────────────────────────────────────────── */

/**
 * The leaderboard, who is on, what is coming up, and how many thank-yous
 * the viewer has left. One request, because four would mean four spinners.
 */
wallRouter.get(
  '/sidebar',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);

    const board = await query<{ id: string; name: string; points: number }>(
      `SELECT u.id, u.name, COALESCE(SUM(x.points), 0) AS points
         FROM users u
         LEFT JOIN xp_events x ON x.user_id = u.id
          AND x.created_at > DATE_SUB(NOW(3), INTERVAL 30 DAY)
        WHERE u.is_active = 1 AND u.role <> 'automation'
        GROUP BY u.id, u.name
        ORDER BY points DESC, u.name
        LIMIT 10`,
    );

    const online = await query<{ id: string; name: string }>(
      `SELECT DISTINCT u.id, u.name
         FROM users u JOIN sessions s ON s.user_id = u.id
        WHERE u.is_active = 1 AND s.expires_at > NOW(3)
          AND s.last_seen_at > DATE_SUB(NOW(3), INTERVAL 2 MINUTE)
        ORDER BY u.name LIMIT 20`,
    );

    const myPoints = await pointsFor(user.id);

    /* The days this person did something, for the streak. */
    const days = await query<{ day: string }>(
      `SELECT DISTINCT earned_on AS day FROM xp_events
        WHERE user_id = ? AND earned_on > DATE_SUB(CURDATE(), INTERVAL 120 DAY)
        ORDER BY day DESC`,
      [user.id],
    );

    const today = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const earned = await query<{ badge_key: string }>(
      'SELECT badge_key FROM user_badges WHERE user_id = ?',
      [user.id],
    );

    res.json({
      leaderboard: board.map((row) => ({ ...row, points: Number(row.points) })),
      online,
      me: {
        points: myPoints,
        level: levelFromPoints(myPoints),
        streak: streakFrom(days.map((row) => String(row.day).slice(0, 10)), today),
        kudosLeft: await kudosLeft(user.id),
        badges: earned.map((row) => row.badge_key),
      },
      badgeCount: BADGES.length,
    });
  }),
);

/** Badges earned but not yet celebrated, so the unlock is shown once. */
wallRouter.get(
  '/unseen-badges',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const rows = await query<{ badge_key: string }>(
      'SELECT badge_key FROM user_badges WHERE user_id = ? AND seen_at IS NULL',
      [user.id],
    );
    res.json({
      items: rows
        .map((row) => BADGES.find((badge) => badge.key === row.badge_key))
        .filter(Boolean)
        .map((badge) => ({ key: badge!.key, name: badge!.name, how: badge!.how, icon: badge!.icon })),
    });
  }),
);

wallRouter.post(
  '/unseen-badges/seen',
  asyncHandler(async (req: Request, res: Response) => {
    await execute(
      'UPDATE user_badges SET seen_at = NOW(3) WHERE user_id = ? AND seen_at IS NULL',
      [currentUser(req).id],
    );
    res.json({ ok: true });
  }),
);
