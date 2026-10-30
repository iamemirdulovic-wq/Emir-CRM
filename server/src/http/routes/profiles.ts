import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth,
} from '../middleware/auth.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { query, queryOne } from '../../db/client.js';
import {
  getOrCreateProfile, loadProfile, profileStats, updateProfile,
} from '../../profiles/profiles.js';
import { COVERS } from '../../profiles/covers.js';
import { badgesFor, levelFor, type BadgeStats } from '../../profiles/badges.js';

/**
 * An agent's own page.
 *
 * Anybody signed in can look at a colleague's profile — that is the point of
 * having one. Only the person themselves, and an owner or admin, can change
 * it. A manager cannot rewrite somebody's bio.
 */
export const profilesRouter = Router();
profilesRouter.use(requireAuth, blockUntilPasswordChanged);

/** The parts of the badge stats that are not already in profileStats. */
async function badgeStatsFor(userId: string, base: Awaited<ReturnType<typeof profileStats>>): Promise<BadgeStats> {
  const extra = await queryOne<{ contacted: number; notes: number; open: number; with_step: number }>(
    `SELECT
       (SELECT COUNT(DISTINCT contact_id) FROM activities
         WHERE user_id = ? AND type IN ('call_logged','whatsapp_sent','email_sent','message_sent')) AS contacted,
       (SELECT COUNT(*) FROM lead_notes WHERE author_id = ? AND deleted_at IS NULL) AS notes,
       (SELECT COUNT(*) FROM opportunities
         WHERE owner_user_id = ? AND status = 'open' AND deleted_at IS NULL) AS open,
       (SELECT COUNT(*) FROM opportunities
         WHERE owner_user_id = ? AND status = 'open' AND deleted_at IS NULL
           AND next_step_at IS NOT NULL) AS with_step`,
    [userId, userId, userId, userId],
  );

  /* Days in a row with at least one lead contacted, counted back from today
     in Dubai. Stops at the first gap. */
  const days = await query<{ day: string }>(
    `SELECT DISTINCT DATE(CONVERT_TZ(created_at, '+00:00', '+04:00')) AS day
       FROM activities
      WHERE user_id = ? AND type IN ('call_logged','whatsapp_sent','email_sent','message_sent')
        AND created_at > DATE_SUB(NOW(3), INTERVAL 120 DAY)
      ORDER BY day DESC`,
    [userId],
  );

  let streak = 0;
  const cursor = new Date(Date.now() + 4 * 60 * 60 * 1000);
  for (const row of days) {
    const want = cursor.toISOString().slice(0, 10);
    const have = String(row.day).slice(0, 10);
    if (have === want) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } else if (have < want) {
      /* Today may simply not have happened yet, so one missing day at the
         very start does not break a streak built up to yesterday. */
      if (streak === 0) {
        cursor.setUTCDate(cursor.getUTCDate() - 1);
        if (have === cursor.toISOString().slice(0, 10)) {
          streak += 1;
          cursor.setUTCDate(cursor.getUTCDate() - 1);
          continue;
        }
      }
      break;
    }
  }

  const open = Number(extra?.open ?? 0);
  return {
    dealsWon: base.dealsWon,
    appointments: base.appointments,
    leadsContacted: Number(extra?.contacted ?? 0),
    speedToLeadSeconds: base.speedToLeadSeconds,
    streakDays: streak,
    monthsHere: base.monthsHere,
    tidiness: open === 0 ? 1 : Number(extra?.with_step ?? 0) / open,
    notesWritten: Number(extra?.notes ?? 0),
  };
}

/** The covers on offer, for the picker. */
profilesRouter.get(
  '/covers',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ items: COVERS.map(({ key, name }) => ({ key, name })) });
  }),
);

profilesRouter.get(
  '/me',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const profile = await getOrCreateProfile(user.id);
    if (!profile) throw notFound('No profile');

    const stats = await profileStats(user.id);
    const badges = badgesFor(await badgeStatsFor(user.id, stats));

    res.json({ profile, stats, badges, level: levelFor(badges), editable: true });
  }),
);

profilesRouter.get(
  '/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    const me = currentUser(req);
    const userId = String(req.params.userId);
    const profile = userId === me.id ? await getOrCreateProfile(userId) : await loadProfile(userId);
    if (!profile) throw notFound('That person does not have a profile');

    const stats = await profileStats(userId);
    const badges = badgesFor(await badgeStatsFor(userId, stats));

    res.json({
      profile,
      stats,
      badges,
      level: levelFor(badges),
      /* Only the person themselves, or an owner or admin. A manager cannot
         rewrite somebody's bio. */
      editable: userId === me.id || me.role === 'owner' || me.role === 'admin',
    });
  }),
);

const patchSchema = z.object({
  headline: z.string().max(160).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
  coverKey: z.string().max(40).optional(),
  languages: z.array(z.string().max(40)).max(12).optional(),
  specialities: z.array(z.string().max(60)).max(12).optional(),
  publicPhone: z.string().max(32).nullable().optional(),
  publicEmail: z.string().max(255).nullable().optional(),
  whatsapp: z.string().max(32).nullable().optional(),
  instagram: z.string().max(120).nullable().optional(),
  linkedin: z.string().max(160).nullable().optional(),
  isPublic: z.boolean().optional(),
  jobTitle: z.string().max(120).nullable().optional(),
  brn: z.string().max(40).nullable().optional(),
  photoUrl: z.string().max(500).nullable().optional(),
});

profilesRouter.patch(
  '/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    const me = currentUser(req);
    const userId = String(req.params.userId);
    if (userId !== me.id && me.role !== 'owner' && me.role !== 'admin') {
      throw forbidden('You can only change your own profile');
    }
    await updateProfile(actorFrom(req), userId, patchSchema.parse(req.body));
    res.json({ ok: true });
  }),
);
