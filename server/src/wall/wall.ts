/**
 * The Team Wall.
 *
 * What makes it worth having in a tool people are paid to use, rather than
 * being a second Slack nobody opens: the CRM posts to it. A deal closes and
 * the wall says so before anybody has to type it, which means the wall is
 * always worth a look even on a quiet day.
 *
 * What stops it being resented: deal values are hidden unless somebody
 * deliberately shows them, and everything can be deleted by its author.
 */
import { randomUUID } from 'node:crypto';
import { execute, query, queryOne, type Executor, getPool } from '../db/client.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { logger, errorContext } from '../lib/logger.js';
import { notify } from '../messaging/notify.js';
import { findMentions } from '../leads/notes.js';
import { decideAward, weekOf, XP_RULES } from './xp.js';

export interface WallPostRow {
  id: string;
  author_id: string | null;
  author_name: string | null;
  kind: string;
  body: string | null;
  media: unknown;
  poll: unknown;
  subject_type: string | null;
  subject_id: string | null;
  show_value: number;
  pinned_at: string | null;
  created_at: string;
}

/* ── Posting ────────────────────────────────────────────────────────────── */

export async function createPost(
  actor: AuditActor,
  input: {
    body?: string | null;
    media?: Array<{ url: string; kind: string; name?: string }> | null;
    poll?: { question: string; options: string[] } | null;
    kind?: string;
  },
): Promise<string> {
  const body = (input.body ?? '').trim();
  if (!body && !input.media?.length && !input.poll) {
    throw Object.assign(new Error('A post needs something in it'), { status: 400 });
  }

  const team = await query<{ id: string; name: string }>(
    "SELECT id, name FROM users WHERE is_active = 1 AND role <> 'automation'",
  );
  const mentions = body ? findMentions(body, team) : [];

  const id = randomUUID();
  await execute(
    `INSERT INTO wall_posts (id, author_id, kind, body, media, poll, mentions)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      actor.userId,
      input.poll ? 'poll' : (input.kind ?? 'post'),
      body || null,
      input.media?.length ? JSON.stringify(input.media.slice(0, 8)) : null,
      input.poll
        ? JSON.stringify({
          question: input.poll.question.slice(0, 200),
          options: input.poll.options.slice(0, 6).map((text) => text.slice(0, 80)),
          votes: {},
        })
        : null,
      mentions.length ? JSON.stringify(mentions) : null,
    ],
  );

  for (const userId of mentions) {
    if (userId === actor.userId) continue;
    await notify({
      userId,
      type: 'mention',
      title: `${actor.label ?? 'Someone'} mentioned you on the wall`,
      body: body.slice(0, 160),
      link: '/wall',
    }).catch((err: unknown) => logger.warn('could not notify a wall mention', errorContext(err)));
  }

  await writeAudit({
    actor, action: 'wall.posted', entityType: 'wall_post', entityId: id,
    after: { kind: input.poll ? 'poll' : (input.kind ?? 'post') },
  });
  return id;
}

/**
 * A post written by the CRM rather than a person.
 *
 * Idempotent on the subject, so the deal that closes twice because a job was
 * retried does not appear on the wall twice.
 */
export async function autoPost(input: {
  kind: 'deal_won' | 'welcome' | 'birthday' | 'anniversary' | 'badge' | 'best_of_week';
  authorId: string | null;
  body: string;
  subjectType: string;
  subjectId: string;
}): Promise<string | null> {
  const already = await queryOne<{ id: string }>(
    `SELECT id FROM wall_posts
      WHERE kind = ? AND subject_type = ? AND subject_id = ? AND deleted_at IS NULL`,
    [input.kind, input.subjectType, input.subjectId],
  );
  if (already) return null;

  const id = randomUUID();
  await execute(
    `INSERT INTO wall_posts (id, author_id, kind, body, subject_type, subject_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.authorId, input.kind, input.body, input.subjectType, input.subjectId],
  );
  logger.info('the wall posted something itself', { kind: input.kind, subjectId: input.subjectId });
  return id;
}

/* ── Reading ────────────────────────────────────────────────────────────── */

export interface FeedPost extends WallPostRow {
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  comments: Array<{
    id: string; author_id: string | null; author_name: string | null;
    body: string; created_at: string;
  }>;
  commentCount: number;
}

export async function feed(viewerId: string, limit = 30, before?: string): Promise<FeedPost[]> {
  const posts = await query<WallPostRow>(
    `SELECT p.id, p.author_id, u.name AS author_name, p.kind, p.body, p.media, p.poll,
            p.subject_type, p.subject_id, p.show_value, p.pinned_at, p.created_at
       FROM wall_posts p
       LEFT JOIN users u ON u.id = p.author_id
      WHERE p.deleted_at IS NULL ${before ? 'AND p.created_at < ?' : ''}
      ORDER BY p.pinned_at IS NULL, p.pinned_at DESC, p.created_at DESC
      LIMIT ?`,
    before ? [before, limit] : [limit],
  );
  if (posts.length === 0) return [];

  const ids = posts.map((post) => post.id);
  const holes = ids.map(() => '?').join(',');

  /* Reactions and the first few comments in one query each, rather than two
     per post: a feed of thirty would otherwise be sixty round trips. */
  const reactions = await query<{ post_id: string; emoji: string; n: number; mine: number }>(
    `SELECT post_id, emoji, COUNT(*) AS n,
            MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine
       FROM wall_reactions WHERE post_id IN (${holes})
      GROUP BY post_id, emoji ORDER BY n DESC`,
    [viewerId, ...ids],
  );

  const comments = await query<{
    id: string; post_id: string; author_id: string | null; author_name: string | null;
    body: string; created_at: string;
  }>(
    `SELECT c.id, c.post_id, c.author_id, u.name AS author_name, c.body, c.created_at
       FROM wall_comments c
       LEFT JOIN users u ON u.id = c.author_id
      WHERE c.post_id IN (${holes}) AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC`,
    ids,
  );

  return posts.map((post) => {
    const mine = comments.filter((comment) => comment.post_id === post.id);
    return {
      ...post,
      reactions: reactions
        .filter((row) => row.post_id === post.id)
        .map((row) => ({ emoji: row.emoji, count: Number(row.n), mine: Number(row.mine) === 1 })),
      /* Three, then "show all" — a thread of forty comments on one post
         pushes everything else off the screen. */
      comments: mine.slice(-3).map(({ post_id: _ignored, ...rest }) => rest),
      commentCount: mine.length,
    };
  });
}

/* ── Reacting and commenting ────────────────────────────────────────────── */

/** On if it was off, off if it was on. */
export async function toggleReaction(userId: string, postId: string, emoji: string): Promise<boolean> {
  const removed = await execute(
    'DELETE FROM wall_reactions WHERE post_id = ? AND user_id = ? AND emoji = ?',
    [postId, userId, emoji],
  );
  if (removed.affectedRows > 0) return false;

  await execute(
    'INSERT IGNORE INTO wall_reactions (id, post_id, user_id, emoji) VALUES (?, ?, ?, ?)',
    [randomUUID(), postId, userId, emoji.slice(0, 16)],
  );
  return true;
}

export async function addComment(actor: AuditActor, postId: string, body: string): Promise<string> {
  const text = body.trim();
  if (!text) throw Object.assign(new Error('A comment needs something in it'), { status: 400 });

  const post = await queryOne<{ author_id: string | null }>(
    'SELECT author_id FROM wall_posts WHERE id = ? AND deleted_at IS NULL',
    [postId],
  );
  if (!post) throw Object.assign(new Error('That post is gone'), { status: 404 });

  const team = await query<{ id: string; name: string }>(
    "SELECT id, name FROM users WHERE is_active = 1 AND role <> 'automation'",
  );
  const mentions = findMentions(text, team);

  const id = randomUUID();
  await execute(
    'INSERT INTO wall_comments (id, post_id, author_id, body, mentions) VALUES (?, ?, ?, ?, ?)',
    [id, postId, actor.userId, text.slice(0, 2000), mentions.length ? JSON.stringify(mentions) : null],
  );

  /* The author hears about a reply, and anybody named hears about being
     named — but nobody hears twice. */
  const tell = new Set(mentions);
  if (post.author_id) tell.add(post.author_id);
  tell.delete(actor.userId ?? '');

  for (const userId of tell) {
    await notify({
      userId,
      type: 'mention',
      title: userId === post.author_id
        ? `${actor.label ?? 'Someone'} replied to your post`
        : `${actor.label ?? 'Someone'} mentioned you on the wall`,
      body: text.slice(0, 160),
      link: '/wall',
    }).catch((err: unknown) => logger.warn('could not notify a wall comment', errorContext(err)));
  }

  return id;
}

/* ── Moderation ─────────────────────────────────────────────────────────── */

export async function deletePost(actor: AuditActor, postId: string): Promise<boolean> {
  const post = await queryOne<{ author_id: string | null }>(
    'SELECT author_id FROM wall_posts WHERE id = ? AND deleted_at IS NULL',
    [postId],
  );
  if (!post) return false;

  const isAuthor = post.author_id && post.author_id === actor.userId;
  const isOwner = actor.role === 'owner' || actor.role === 'admin';
  if (!isAuthor && !isOwner) {
    throw Object.assign(new Error('Only the person who posted it, or an owner, can remove it'), { status: 403 });
  }

  await execute(
    'UPDATE wall_posts SET deleted_at = NOW(3), deleted_by_user_id = ? WHERE id = ?',
    [actor.userId, postId],
  );
  await writeAudit({
    actor, action: 'wall.post_deleted', entityType: 'wall_post', entityId: postId,
    before: { authorId: post.author_id },
  });
  return true;
}

export async function pinPost(actor: AuditActor, postId: string, pinned: boolean): Promise<void> {
  await execute(
    pinned
      ? 'UPDATE wall_posts SET pinned_at = NOW(3), pinned_by_user_id = ? WHERE id = ?'
      : 'UPDATE wall_posts SET pinned_at = NULL, pinned_by_user_id = NULL WHERE id = ?',
    pinned ? [actor.userId, postId] : [postId],
  );
  await writeAudit({
    actor, action: pinned ? 'wall.pinned' : 'wall.unpinned',
    entityType: 'wall_post', entityId: postId,
  });
}

/* ── Points ─────────────────────────────────────────────────────────────── */

/**
 * Pay somebody, if the rules allow it.
 *
 * The uniqueness is a key on the table, so two workers awarding the same
 * thing at the same instant produce one row, not two. The check here is the
 * explanation; the key is the lock.
 */
export async function awardXp(input: {
  userId: string;
  rule: string;
  subjectType: string;
  subjectId: string;
}): Promise<{ awarded: boolean; points: number }> {
  const definition = XP_RULES[input.rule];
  if (!definition) return { awarded: false, points: 0 };

  const today = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const counts = await queryOne<{ today_count: number; already: number }>(
    `SELECT
       SUM(CASE WHEN rule = ? AND earned_on = ? THEN 1 ELSE 0 END) AS today_count,
       SUM(CASE WHEN rule = ? AND subject_type = ? AND subject_id = ? THEN 1 ELSE 0 END) AS already
     FROM xp_events WHERE user_id = ?`,
    [input.rule, today, input.rule, input.subjectType, input.subjectId, input.userId],
  );

  const decision = decideAward(input.rule, {
    todayCount: Number(counts?.today_count ?? 0),
    alreadyAwarded: Number(counts?.already ?? 0) > 0,
  });
  if (!decision.award) return { awarded: false, points: 0 };

  const result = await execute(
    `INSERT IGNORE INTO xp_events (id, user_id, rule, points, subject_type, subject_id, earned_on)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), input.userId, input.rule, decision.points, input.subjectType, input.subjectId, today],
  );

  return { awarded: result.affectedRows > 0, points: result.affectedRows > 0 ? decision.points : 0 };
}

export async function pointsFor(userId: string, exec: Executor = getPool()): Promise<number> {
  const row = await queryOne<{ total: number }>(
    'SELECT COALESCE(SUM(points), 0) AS total FROM xp_events WHERE user_id = ?',
    [userId],
    exec,
  );
  return Number(row?.total ?? 0);
}

/* ── Kudos ──────────────────────────────────────────────────────────────── */

export async function giveKudos(
  actor: AuditActor,
  toUserId: string,
  reason: string,
): Promise<{ left: number }> {
  const fromUserId = actor.userId;
  if (!fromUserId) throw Object.assign(new Error('Not signed in'), { status: 401 });

  const week = weekOf(new Date());
  const counts = await queryOne<{ given: number; same: number }>(
    `SELECT COUNT(*) AS given,
            SUM(CASE WHEN to_user_id = ? THEN 1 ELSE 0 END) AS same
       FROM kudos WHERE from_user_id = ? AND week_of = ?`,
    [toUserId, fromUserId, week],
  );

  const { canGiveKudos } = await import('./xp.js');
  const decision = canGiveKudos({
    fromUserId,
    toUserId,
    givenThisWeek: Number(counts?.given ?? 0),
    alreadyThankedThisWeek: Number(counts?.same ?? 0) > 0,
  });
  if (!decision.allowed) throw Object.assign(new Error(decision.reason), { status: 400 });

  const id = randomUUID();
  await execute(
    'INSERT INTO kudos (id, from_user_id, to_user_id, reason, week_of) VALUES (?, ?, ?, ?, ?)',
    [id, fromUserId, toUserId, reason.trim().slice(0, 400), week],
  );

  await awardXp({ userId: toUserId, rule: 'kudos_received', subjectType: 'kudos', subjectId: id });

  await notify({
    userId: toUserId,
    type: 'kudos',
    title: `${actor.label ?? 'A colleague'} said thank you`,
    body: reason.trim().slice(0, 160),
    link: '/wall',
  }).catch((err: unknown) => logger.warn('could not notify kudos', errorContext(err)));

  await writeAudit({
    actor, action: 'kudos.given', entityType: 'user', entityId: toUserId,
    after: { reason: reason.slice(0, 120) },
  });

  return { left: decision.left };
}

export async function kudosLeft(userId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM kudos WHERE from_user_id = ? AND week_of = ?',
    [userId, weekOf(new Date())],
  );
  const { KUDOS_PER_WEEK } = await import('./xp.js');
  return Math.max(0, KUDOS_PER_WEEK - Number(row?.n ?? 0));
}
