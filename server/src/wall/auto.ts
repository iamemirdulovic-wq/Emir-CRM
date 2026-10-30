/**
 * The posts the CRM writes itself.
 *
 * This is what makes the wall worth opening. A wall that only has what people
 * typed is empty on a Tuesday; one that says "Layla closed Emaar Beachfront"
 * the moment it happens is worth a look every morning.
 *
 * Every one of these is idempotent on its subject, so a retried job does not
 * congratulate somebody twice.
 */
import { randomUUID } from 'node:crypto';
import { execute, query, queryOne } from '../db/client.js';
import { logger, errorContext } from '../lib/logger.js';
import { notify } from '../messaging/notify.js';
import { autoPost, awardXp, pointsFor } from './wall.js';
import { BADGES, badgesFor, type BadgeStats } from '../profiles/badges.js';

/** A deal closed. The one post nobody minds seeing. */
export async function postDealWon(opportunityId: string): Promise<void> {
  const deal = await queryOne<{
    owner_user_id: string | null; name: string | null; project_name: string | null;
  }>(
    `SELECT o.owner_user_id, u.name, o.project_name
       FROM opportunities o LEFT JOIN users u ON u.id = o.owner_user_id
      WHERE o.id = ?`,
    [opportunityId],
  );
  if (!deal?.owner_user_id || !deal.name) return;

  /* The project, never the value. What a colleague earned is not everybody's
     business, and an owner can turn the figure on for one post if they want
     to. */
  const body = deal.project_name
    ? `${deal.name} just closed a deal at ${deal.project_name}.`
    : `${deal.name} just closed a deal.`;

  await autoPost({
    kind: 'deal_won',
    authorId: deal.owner_user_id,
    body,
    subjectType: 'opportunity',
    subjectId: opportunityId,
  });

  await awardXp({
    userId: deal.owner_user_id,
    rule: 'deal_won',
    subjectType: 'opportunity',
    subjectId: opportunityId,
  });

  await checkBadges(deal.owner_user_id);
}

/** Somebody's first day. */
export async function postWelcome(userId: string): Promise<void> {
  const user = await queryOne<{ name: string; job_title: string | null }>(
    'SELECT name, job_title FROM users WHERE id = ?',
    [userId],
  );
  if (!user) return;

  await autoPost({
    kind: 'welcome',
    authorId: null,
    body: `${user.name} has joined the team${user.job_title ? ` as ${user.job_title}` : ''}. Say hello.`,
    subjectType: 'user',
    subjectId: userId,
  });
}

/**
 * Work anniversaries, run daily.
 *
 * Birthdays are deliberately not here: the CRM does not hold a date of birth,
 * and asking for one so the wall can post about it is not a reason to start
 * holding it.
 */
export async function postAnniversaries(now: Date = new Date()): Promise<number> {
  const dubai = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const month = dubai.getUTCMonth() + 1;
  const day = dubai.getUTCDate();
  const year = dubai.getUTCFullYear();

  const people = await query<{ id: string; name: string; years: number }>(
    `SELECT id, name, TIMESTAMPDIFF(YEAR, created_at, NOW(3)) AS years
       FROM users
      WHERE is_active = 1 AND role <> 'automation'
        AND MONTH(created_at) = ? AND DAY(created_at) = ?
        AND TIMESTAMPDIFF(YEAR, created_at, NOW(3)) >= 1`,
    [month, day],
  );

  let posted = 0;
  for (const person of people) {
    const years = Number(person.years);
    const id = await autoPost({
      kind: 'anniversary',
      authorId: person.id,
      body: `${person.name} has been with us ${years} ${years === 1 ? 'year' : 'years'} today.`,
      subjectType: 'user_year',
      /* The year is part of the subject, so next year posts again. */
      subjectId: `${person.id}:${year}`,
    });
    if (id) posted += 1;
  }
  return posted;
}

/* ── Badges ─────────────────────────────────────────────────────────────── */

/**
 * Work out what somebody has earned and record anything new.
 *
 * Called after the things that could earn one. The unique key on
 * (user, badge) means a double-run awards nothing twice.
 */
export async function checkBadges(userId: string): Promise<string[]> {
  const stats = await badgeStatsFor(userId);
  const earned = badgesFor(stats).filter((badge) => badge.earned);

  const already = await query<{ badge_key: string }>(
    'SELECT badge_key FROM user_badges WHERE user_id = ?',
    [userId],
  );
  const have = new Set(already.map((row) => row.badge_key));
  const fresh = earned.filter((badge) => !have.has(badge.key));

  for (const badge of fresh) {
    await execute(
      'INSERT IGNORE INTO user_badges (id, user_id, badge_key) VALUES (?, ?, ?)',
      [randomUUID(), userId, badge.key],
    );
    await notify({
      userId,
      type: 'badge_earned',
      title: `You earned "${badge.name}"`,
      body: badge.how,
      link: '/profile',
    }).catch((err: unknown) => logger.warn('could not notify a badge', errorContext(err)));
  }

  if (fresh.length > 0) {
    logger.info('badges earned', { userId, badges: fresh.map((badge) => badge.key) });
  }
  return fresh.map((badge) => badge.key);
}

async function badgeStatsFor(userId: string): Promise<BadgeStats> {
  const row = await queryOne<{
    won: number; appointments: number; contacted: number; notes: number;
    open: number; with_step: number; months: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM opportunities WHERE owner_user_id = ? AND status = 'won' AND deleted_at IS NULL) AS won,
       (SELECT COUNT(*) FROM activities WHERE user_id = ? AND type = 'meeting_booked') AS appointments,
       (SELECT COUNT(DISTINCT contact_id) FROM activities WHERE user_id = ?
         AND type IN ('call_logged','whatsapp_sent','email_sent','message_sent')) AS contacted,
       (SELECT COUNT(*) FROM lead_notes WHERE author_id = ? AND deleted_at IS NULL) AS notes,
       (SELECT COUNT(*) FROM opportunities WHERE owner_user_id = ? AND status = 'open' AND deleted_at IS NULL) AS open,
       (SELECT COUNT(*) FROM opportunities WHERE owner_user_id = ? AND status = 'open'
         AND deleted_at IS NULL AND next_step_at IS NOT NULL) AS with_step,
       (SELECT TIMESTAMPDIFF(MONTH, created_at, NOW(3)) FROM users WHERE id = ?) AS months`,
    [userId, userId, userId, userId, userId, userId, userId],
  );

  const speeds = await query<{ seconds: number }>(
    `SELECT TIMESTAMPDIFF(SECOND, created_at, last_contact_at) AS seconds
       FROM opportunities
      WHERE owner_user_id = ? AND last_contact_at IS NOT NULL
        AND last_contact_at >= created_at
        AND created_at > DATE_SUB(NOW(3), INTERVAL 90 DAY)
      ORDER BY seconds`,
    [userId],
  );

  const days = await query<{ day: string }>(
    `SELECT DISTINCT earned_on AS day FROM xp_events
      WHERE user_id = ? AND earned_on > DATE_SUB(CURDATE(), INTERVAL 120 DAY)`,
    [userId],
  );
  const { streakFrom } = await import('./xp.js');
  const today = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const open = Number(row?.open ?? 0);
  return {
    dealsWon: Number(row?.won ?? 0),
    appointments: Number(row?.appointments ?? 0),
    leadsContacted: Number(row?.contacted ?? 0),
    speedToLeadSeconds: speeds.length
      ? Number(speeds[Math.floor(speeds.length / 2)]?.seconds ?? 0)
      : null,
    streakDays: streakFrom(days.map((d) => String(d.day).slice(0, 10)), today),
    monthsHere: Number(row?.months ?? 0),
    tidiness: open === 0 ? 1 : Number(row?.with_step ?? 0) / open,
    notesWritten: Number(row?.notes ?? 0),
  };
}

/* ── Best of the week ───────────────────────────────────────────────────── */

/**
 * Monday morning: who did the most last week.
 *
 * One post, naming up to three people, with what they actually did rather
 * than a score. "Most points" means nothing to anybody; "closed two deals"
 * does.
 */
export async function postBestOfWeek(now: Date = new Date()): Promise<string | null> {
  const { weekOf } = await import('./xp.js');
  const lastWeek = weekOf(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));

  const top = await query<{
    id: string; name: string; points: number; deals: number; meetings: number;
  }>(
    `SELECT u.id, u.name,
            COALESCE(SUM(x.points), 0) AS points,
            SUM(CASE WHEN x.rule = 'deal_won' THEN 1 ELSE 0 END) AS deals,
            SUM(CASE WHEN x.rule = 'meeting_happened' THEN 1 ELSE 0 END) AS meetings
       FROM users u
       JOIN xp_events x ON x.user_id = u.id
      WHERE u.is_active = 1 AND u.role <> 'automation'
        AND x.earned_on >= ? AND x.earned_on < DATE_ADD(?, INTERVAL 7 DAY)
      GROUP BY u.id, u.name
      HAVING points > 0
      ORDER BY points DESC
      LIMIT 3`,
    [lastWeek, lastWeek],
  );

  /* A quiet week gets no post rather than a post about nobody. */
  if (top.length === 0) return null;

  const lines = top.map((person, index) => {
    const bits: string[] = [];
    if (Number(person.deals) > 0) {
      bits.push(`${person.deals} ${Number(person.deals) === 1 ? 'deal' : 'deals'}`);
    }
    if (Number(person.meetings) > 0) {
      bits.push(`${person.meetings} ${Number(person.meetings) === 1 ? 'viewing' : 'viewings'}`);
    }
    const crown = index === 0 ? '👑 ' : '';
    return bits.length > 0
      ? `${crown}${person.name} — ${bits.join(', ')}`
      : `${crown}${person.name}`;
  });

  return autoPost({
    kind: 'best_of_week',
    authorId: null,
    body: `Best of the week\n\n${lines.join('\n')}`,
    subjectType: 'week',
    subjectId: lastWeek,
  });
}

/** Everything the daily wall job does. */
export async function runWallDaily(now: Date = new Date()): Promise<{ anniversaries: number; bestOf: boolean }> {
  const anniversaries = await postAnniversaries(now).catch((err: unknown) => {
    logger.warn('could not post anniversaries', errorContext(err));
    return 0;
  });

  /* Monday in Dubai, and only then. */
  const dubai = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const bestOf = dubai.getUTCDay() === 1 ? Boolean(await postBestOfWeek(now)) : false;

  return { anniversaries, bestOf };
}

export { pointsFor };
