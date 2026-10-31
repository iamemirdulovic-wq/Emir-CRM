import { Router, type Request, type Response } from 'express';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { rateLimit } from '../middleware/rate-limit.js';
import { badRequest } from '../../lib/errors.js';
import { IMAGE_TYPES, baseContentType, extensionFor, insideUploadDir, uploadDir } from '../../lib/uploads.js';
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

/* A photo is the first thing a client looks at on a business card, and until
   now there was no way to put one there: the column existed, the card rendered
   it, and nothing could set it. Agents fell back to their initials. */
const photoLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: 'Too many photo uploads in a short time. Please wait a minute.',
});

/** Four megabytes — a phone photo, not a print file. It is resized on the card. */
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

function photoDir(): string {
  return uploadDir('profile-photos');
}

/** This person's photo on disk, whatever extension it was uploaded with. */
async function findPhoto(userId: string): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(photoDir());
  } catch {
    return null;
  }
  const match = names.find((name) => new RegExp(`^${userId}\\.(png|jpg|webp|gif)$`).test(name));
  return match ? path.join(photoDir(), match) : null;
}

async function removePhotos(userId: string): Promise<void> {
  const existing = await findPhoto(userId);
  if (existing && insideUploadDir(existing)) await rm(existing, { force: true });
}

profilesRouter.post(
  '/:userId/photo',
  photoLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const me = currentUser(req);
    const userId = String(req.params.userId);
    if (userId !== me.id && me.role !== 'owner' && me.role !== 'admin') {
      throw forbidden('You can only change your own photo');
    }

    const contentType = baseContentType(req.get('content-type') ?? '');
    const extension = extensionFor(contentType, IMAGE_TYPES);
    if (!extension || extension === '.pdf') {
      throw badRequest(`${contentType || 'That file'} is not an image. PNG, JPG or WebP.`);
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_PHOTO_BYTES) throw badRequest('That photo is larger than 4 MB.');
      chunks.push(chunk as Buffer);
    }
    if (size === 0) throw badRequest('That file is empty.');

    await mkdir(photoDir(), { recursive: true });
    /* One photo per person, so a replacement in another format does not leave
       the old one on disk for the card to find first. */
    await removePhotos(userId);
    await writeFile(path.join(photoDir(), `${userId}${extension}`), Buffer.concat(chunks));

    /* The version is what makes a browser — and a client's mail client —
       fetch the new photo rather than the cached old one. */
    const url = `/api/profiles/${userId}/photo?v=${Date.now()}`;
    await updateProfile(actorFrom(req), userId, { photoUrl: url });
    res.status(201).json({ photoUrl: url });
  }),
);

/* Public by design, like the company logo: it is on a business card that
   people without an account open, and in the signature of client emails. It
   is registered on the public router below for that reason. */
export const publicProfileRouter = Router();

publicProfileRouter.get(
  '/:userId/photo',
  asyncHandler(async (req: Request, res: Response) => {
    const file = await findPhoto(String(req.params.userId));
    if (!file) throw notFound('No photo has been uploaded.');

    const type = Object.entries(IMAGE_TYPES).find(([, ext]) => ext === path.extname(file))?.[0];
    res.setHeader('Content-Type', type ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', 'inline');
    res.send(await readFile(file));
  }),
);

profilesRouter.delete(
  '/:userId/photo',
  asyncHandler(async (req: Request, res: Response) => {
    const me = currentUser(req);
    const userId = String(req.params.userId);
    if (userId !== me.id && me.role !== 'owner' && me.role !== 'admin') {
      throw forbidden('You can only change your own photo');
    }
    await removePhotos(userId);
    await updateProfile(actorFrom(req), userId, { photoUrl: null });
    res.json({ ok: true });
  }),
);
