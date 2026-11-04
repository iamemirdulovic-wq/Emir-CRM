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
import { findWallMedia, saveWallMedia, WALL_IMAGE_TYPES } from '../../wall/media.js';
import { decodeFilename } from './tasks.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { env } from '../../config/env.js';
import { badRequest } from '../../lib/errors.js';
import { createReadStream } from 'node:fs';
import { BADGES } from '../../profiles/badges.js';

/**
 * The Team Wall.
 *
 * Everybody signed in can read and post. The moderation — pinning, removing
 * somebody else's post, showing a deal's value — is owner and admin only.
 */
export const wallRouter = Router();
wallRouter.use(requireAuth, blockUntilPasswordChanged);

const mediaLimit = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyFor: (req) => `wall-media:${currentUser(req).id}`,
  message: 'Too many uploads in a short time. Please wait a minute.',
});

/**
 * Put a picture or a GIF on the server, and get back the descriptor that goes
 * in a post's media list.
 *
 * The body is the file itself with its name and type in headers, the same
 * shape task attachments and imports use: no multipart parser, and the
 * request is not buffered twice.
 */
wallRouter.post(
  '/media',
  mediaLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const contentType = (req.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (!WALL_IMAGE_TYPES[contentType]) {
      throw badRequest(`${contentType || 'That file'} cannot go on the wall. JPEG, PNG, WebP or GIF.`);
    }

    const limit = env().MAX_ATTACHMENT_MB * 1024 * 1024;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > limit) throw badRequest(`That file is larger than the ${env().MAX_ATTACHMENT_MB} MB limit`);
      chunks.push(chunk as Buffer);
    }

    /* The same decoder every other upload in this CRM uses: it survives a
       malformed percent-sequence and strips the control characters, rather
       than throwing a 500 at somebody whose phone named a file oddly. */
    const filename = decodeFilename(req.get('x-filename'));

    res.status(201).json(await saveWallMedia({
      filename: filename === 'attachment' ? 'image' : filename,
      contentType,
      body: Buffer.concat(chunks),
      uploadedByUserId: user.id,
    }));
  }),
);

/** Serve one back. Everybody signed in can see the wall, so no extra check. */
wallRouter.get(
  '/media/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const row = await findWallMedia(String(req.params.id));
    if (!row) throw notFound('That image is no longer here');
    res.type(row.content_type);
    /* Immutable: the id names the bytes, and the bytes never change. */
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    createReadStream(row.storage_path).pipe(res);
  }),
);

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
/**
 * Who is actually posting.
 *
 * Deliberately not the XP leaderboard beside it: that counts deals and calls,
 * this counts turning up on the wall. A quiet closer and a loud newcomer are
 * two different kinds of good and the floor should see both.
 */
wallRouter.get(
  '/top-posters',
  asyncHandler(async (_req: Request, res: Response) => {
    const items = await query<{ id: string; name: string; photo_url: string | null; posts: number }>(
      `SELECT u.id, u.name, u.photo_url, COUNT(*) AS posts
         FROM wall_posts p
         JOIN users u ON u.id = p.author_id
        WHERE p.deleted_at IS NULL
          AND p.kind = 'post'
          AND p.created_at > DATE_SUB(NOW(3), INTERVAL 7 DAY)
        GROUP BY u.id, u.name, u.photo_url
        ORDER BY posts DESC, u.name
        LIMIT 5`,
    );
    res.json({ items: items.map((row) => ({ ...row, posts: Number(row.posts) })) });
  }),
);

/**
 * The floor, as people.
 *
 * Work details only, on purpose (Emir, Nov 4, 2026: "of coures not mean,
 * where is from, not burtdhay day date, mean also shoild pricevacy"). What a
 * colleague needs to know to hand a lead to the right person: what they do,
 * what they sell, what they speak. No birthday, no home city, no personal
 * number, no email. Anyone who wants to reach them has the CRM.
 */
wallRouter.get(
  '/team',
  asyncHandler(async (_req: Request, res: Response) => {
    const items = await query<{
      id: string; name: string; role: string; job_title: string | null;
      photo_url: string | null; headline: string | null;
      languages: unknown; specialities: unknown;
    }>(
      `SELECT u.id, u.name, u.role, u.job_title, u.photo_url,
              a.headline, a.languages, a.specialities
         FROM users u
         LEFT JOIN agent_profiles a ON a.user_id = u.id
        WHERE u.is_active = 1 AND u.role <> 'automation'
        ORDER BY u.name`,
    );

    const list = (value: unknown): string[] => {
      const raw = typeof value === 'string' ? ((): unknown => {
        try { return JSON.parse(value); } catch { return []; }
      })() : value;
      return Array.isArray(raw) ? raw.map(String).filter(Boolean).slice(0, 8) : [];
    };

    res.json({
      items: items.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        jobTitle: row.job_title,
        photoUrl: row.photo_url,
        headline: row.headline,
        languages: list(row.languages),
        specialities: list(row.specialities),
      })),
    });
  }),
);

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
