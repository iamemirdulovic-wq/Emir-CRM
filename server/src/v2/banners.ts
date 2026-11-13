/**
 * The banners at the top of every agent's My Day.
 *
 * `design/web/home-banners.html`. Up to five, they rotate, and the owner
 * writes them. The table has been there since migration 0036 and My Day has
 * been reading it; this is the screen that fills it.
 *
 * The five is enforced here rather than only on screen. Six banners rotating
 * is not five banners plus one — it is a carousel nobody waits through, and
 * the sixth is the one nobody ever sees.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getPool, query, queryOne, execute, type Executor, type SqlParam } from '../db/client.js';
import { badRequest, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { extensionFor, insideUploadDir, uploadDir } from '../lib/uploads.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';

export const MAX_BANNERS = 5;

/** How often they change, which the page tells the owner. */
export const BANNER_ROTATE_SECONDS = 4.5;

/** The five labels the design offers above the headline. */
export const BANNER_LABELS = [
  'From Emir', 'Office', 'Project', 'Best of Homes', 'Training',
] as const;

/** Where the button goes. A place in the CRM, or a web address. */
export const BANNER_OPENS = [
  'Project page', 'Best of Homes', 'Team wall', 'A web link',
] as const;

export const BANNER_AUDIENCES = ['everyone', 'agents', 'desk'] as const;

export type BannerAudience = (typeof BANNER_AUDIENCES)[number];

/** Live / Scheduled / Ended — the chip on each row. */
export type BannerState = 'Live' | 'Scheduled' | 'Ended';

export interface Banner {
  id: string;
  title: string;
  label: string;
  body: string | null;
  buttonText: string | null;
  opens: string;
  audience: BannerAudience;
  deskId: string | null;
  deskName: string | null;
  linkUrl: string | null;
  imagePath: string | null;
  startsAt: string | null;
  endsAt: string | null;
  position: number;
  isActive: boolean;
  createdAt: string;
  /** Live / Scheduled / Ended, worked out from the dates. */
  state: BannerState;
  /** How many of the people it is for have seen it, and how many that is. */
  seenBy: number;
  audienceSize: number;
}

const COLUMNS = `b.id, b.title, b.label, b.body, b.button_text AS buttonText, b.opens,
  b.audience, b.desk_id AS deskId, d.name AS deskName,
  b.link_url AS linkUrl, b.image_path AS imagePath,
  b.starts_at AS startsAt, b.ends_at AS endsAt, b.position, b.is_active AS isActive,
  b.created_at AS createdAt,
  (SELECT COUNT(*) FROM banner_views v WHERE v.banner_id = b.id) AS seenBy`;

const FROM = 'FROM banners b LEFT JOIN desks d ON d.id = b.desk_id';

/** A date only, for comparing days rather than instants. */
function day(value: unknown): string | null {
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(at.getTime()) ? null : at.toISOString().slice(0, 10);
}

export function bannerState(
  startsAt: unknown, endsAt: unknown, isActive: boolean, today: string,
): BannerState {
  if (!isActive) return 'Ended';
  const ends = day(endsAt);
  const starts = day(startsAt);
  if (ends && ends < today) return 'Ended';
  if (starts && starts > today) return 'Scheduled';
  return 'Live';
}

function shape(row: Record<string, unknown>, sizes: Map<string, number>, today: string): Banner {
  const isActive = Number(row.isActive) === 1;
  const audience = (row.audience as BannerAudience) ?? 'everyone';
  const key = audience === 'desk' ? `desk:${String(row.deskId ?? '')}` : audience;
  return {
    ...(row as unknown as Banner),
    isActive,
    audience,
    label: (row.label as string) || 'From Emir',
    opens: (row.opens as string) || 'Project page',
    state: bannerState(row.startsAt, row.endsAt, isActive, today),
    seenBy: Number(row.seenBy ?? 0),
    audienceSize: sizes.get(key) ?? 0,
  };
}

/**
 * How many people each audience is.
 *
 * "seen by 9 of 10" needs the denominator, and the denominator is different
 * for "everyone", "agents" and one desk. Counted once for the whole list.
 */
async function audienceSizes(exec: Executor): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  const all = await queryOne<{ everyone: number; agents: number }>(
    `SELECT COUNT(*) AS everyone,
            SUM(role = 'agent') AS agents
       FROM users WHERE is_active = 1 AND role <> 'automation'`,
    [], exec,
  );
  sizes.set('everyone', Number(all?.everyone ?? 0));
  sizes.set('agents', Number(all?.agents ?? 0));

  const desks = await query<{ desk_id: string; n: number }>(
    `SELECT dm.desk_id, COUNT(*) AS n
       FROM desk_members dm JOIN users u ON u.id = dm.user_id
      WHERE u.is_active = 1
      GROUP BY dm.desk_id`,
    [], exec,
  );
  for (const row of desks) sizes.set(`desk:${row.desk_id}`, Number(row.n));
  return sizes;
}

/** Dubai is UTC+4 all year, so a fixed offset is right and a library is not. */
function dubaiToday(): string {
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}

export async function listBanners(exec: Executor = getPool()): Promise<Banner[]> {
  const [rows, sizes] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT ${COLUMNS} ${FROM} ORDER BY b.position, b.created_at`, [], exec,
    ),
    audienceSizes(exec),
  ]);
  const today = dubaiToday();
  return rows.map((row) => shape(row, sizes, today));
}

export const bannerSchema = z.object({
  title: z.string().min(2).max(48),
  label: z.enum(BANNER_LABELS).optional(),
  body: z.string().max(90).nullable().optional(),
  buttonText: z.string().max(22).nullable().optional(),
  opens: z.enum(BANNER_OPENS).optional(),
  audience: z.enum(BANNER_AUDIENCES).optional(),
  deskId: z.string().max(36).nullable().optional(),
  linkUrl: z.string().max(500).nullable().optional(),
  imagePath: z.string().max(500).nullable().optional(),
  /** `YYYY-MM-DD`, which is what the design's two date fields give. */
  startsAt: z.string().max(30).nullable().optional(),
  endsAt: z.string().max(30).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * The rules the design's own form checks before it will publish.
 *
 * Checked here as well as on screen: a banner with an "until" before its
 * "from" never appears, and a banner whose button says "Open calendar" and
 * points nowhere is a dead tap on every agent's morning.
 */
export function bannerProblem(
  input: Partial<z.infer<typeof bannerSchema>>,
  isNew: boolean,
  today = dubaiToday(),
): string | null {
  const from = input.startsAt ? day(input.startsAt) : null;
  const until = input.endsAt ? day(input.endsAt) : null;
  if (from && until && until < from) {
    return '“Until” is before “Show from”. Choose a later day.';
  }
  if (isNew && from && from < today) return 'The start day is in the past.';
  if (input.opens === 'A web link' && !/^https:\/\/\S+\.\S+/.test(input.linkUrl ?? '')) {
    return 'Write the full web link. It starts with https://';
  }
  if (input.audience === 'desk' && !input.deskId) return 'Choose a desk.';
  return null;
}

export async function createBanner(
  actor: AuditActor,
  input: z.infer<typeof bannerSchema>,
  exec: Executor = getPool(),
): Promise<Banner> {
  const live = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM banners WHERE is_active = 1', [], exec,
  );
  if (Number(live?.n ?? 0) >= MAX_BANNERS && (input.isActive ?? true)) {
    throw badRequest(
      `There are already ${MAX_BANNERS} banners showing. Switch one off before adding another.`,
    );
  }

  const wrong = bannerProblem(input, true);
  if (wrong) throw badRequest(wrong);

  const id = newId();
  const last = await queryOne<{ n: number | null }>(
    'SELECT MAX(position) AS n FROM banners', [], exec,
  );

  await execute(
    `INSERT INTO banners
       (id, title, label, body, button_text, opens, audience, desk_id,
        link_url, image_path, starts_at, ends_at, position, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.title.trim(), input.label ?? 'From Emir', input.body?.trim() || null,
      input.buttonText?.trim() || null, input.opens ?? 'Project page',
      input.audience ?? 'everyone', input.audience === 'desk' ? input.deskId ?? null : null,
      input.linkUrl?.trim() || null,
      input.imagePath ?? null, input.startsAt ?? null, input.endsAt ?? null,
      Number(last?.n ?? 0) + 1, (input.isActive ?? true) ? 1 : 0, actor.userId,
    ],
    exec,
  );
  await writeAudit({
    actor, action: 'banner.created', entityType: 'banner', entityId: id,
    after: {
      title: input.title, label: input.label ?? 'From Emir',
      audience: input.audience ?? 'everyone', opens: input.opens ?? 'Project page',
    },
  }, exec);

  return oneBanner(id, exec);
}

/** One banner, shaped the same way the list shapes them. */
export async function oneBanner(id: string, exec: Executor = getPool()): Promise<Banner> {
  const [row, sizes] = await Promise.all([
    queryOne<Record<string, unknown>>(`SELECT ${COLUMNS} ${FROM} WHERE b.id = ?`, [id], exec),
    audienceSizes(exec),
  ]);
  if (!row) throw notFound('That banner does not exist.');
  return shape(row, sizes, dubaiToday());
}

export async function updateBanner(
  actor: AuditActor,
  id: string,
  input: Partial<z.infer<typeof bannerSchema>>,
  exec: Executor = getPool(),
): Promise<Banner> {
  const before = await queryOne<{ title: string; is_active: number }>(
    'SELECT title, is_active FROM banners WHERE id = ?', [id], exec,
  );
  if (!before) throw notFound('That banner does not exist.');

  /* Switching one back on counts against the five, the same as making one. */
  if (input.isActive === true && before.is_active === 0) {
    const live = await queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM banners WHERE is_active = 1', [], exec,
    );
    if (Number(live?.n ?? 0) >= MAX_BANNERS) {
      throw badRequest(
        `There are already ${MAX_BANNERS} banners showing. Switch one off before switching this on.`,
      );
    }
  }

  const wrong = bannerProblem(input, false);
  if (wrong) throw badRequest(wrong);

  const sets: string[] = [];
  const params: SqlParam[] = [];
  const put = (sql: string, value: SqlParam) => { sets.push(sql); params.push(value); };

  if (input.title !== undefined) put('title = ?', input.title.trim());
  if (input.label !== undefined) put('label = ?', input.label);
  if (input.body !== undefined) put('body = ?', input.body?.trim() || null);
  if (input.buttonText !== undefined) put('button_text = ?', input.buttonText?.trim() || null);
  if (input.opens !== undefined) put('opens = ?', input.opens);
  if (input.audience !== undefined) {
    put('audience = ?', input.audience);
    /* A desk id left behind on a banner switched back to "everyone" is a
       filter waiting to be applied by accident. */
    put('desk_id = ?', input.audience === 'desk' ? input.deskId ?? null : null);
  } else if (input.deskId !== undefined) {
    put('desk_id = ?', input.deskId ?? null);
  }
  if (input.linkUrl !== undefined) put('link_url = ?', input.linkUrl?.trim() || null);
  if (input.imagePath !== undefined) put('image_path = ?', input.imagePath ?? null);
  if (input.startsAt !== undefined) put('starts_at = ?', input.startsAt ?? null);
  if (input.endsAt !== undefined) put('ends_at = ?', input.endsAt ?? null);
  if (input.isActive !== undefined) put('is_active = ?', input.isActive ? 1 : 0);

  if (sets.length > 0) {
    await execute(`UPDATE banners SET ${sets.join(', ')} WHERE id = ?`, [...params, id], exec);
    await writeAudit({
      actor, action: 'banner.updated', entityType: 'banner', entityId: id,
      before: { title: before.title, isActive: before.is_active === 1 },
      after: { title: input.title ?? before.title, isActive: input.isActive, ...input },
    }, exec);
  }

  return oneBanner(id, exec);
}

/**
 * "seen by 9 of 10".
 *
 * Written the first time somebody is shown a banner and never again, so the
 * number is how many people read it rather than how often it rotated past
 * them. `INSERT IGNORE` makes the repeat a no-op rather than a round trip and
 * an error.
 */
export async function recordBannerViews(
  userId: string,
  bannerIds: string[],
  exec: Executor = getPool(),
): Promise<void> {
  if (bannerIds.length === 0) return;
  await execute(
    `INSERT IGNORE INTO banner_views (banner_id, user_id)
     VALUES ${bannerIds.map(() => '(?, ?)').join(', ')}`,
    bannerIds.flatMap((id) => [id, userId]),
    exec,
  );
}

export async function deleteBanner(
  actor: AuditActor,
  id: string,
  exec: Executor = getPool(),
): Promise<{ deleted: true }> {
  const before = await queryOne<{ title: string }>(
    'SELECT title FROM banners WHERE id = ?', [id], exec,
  );
  if (!before) throw notFound('That banner does not exist.');

  await execute('DELETE FROM banners WHERE id = ?', [id], exec);
  await writeAudit({
    actor, action: 'banner.deleted', entityType: 'banner', entityId: id,
    before: { title: before.title },
  }, exec);
  return { deleted: true };
}

/** Drag-to-reorder: the whole order at once, so there is no half-applied state. */
export async function reorderBanners(
  actor: AuditActor,
  ids: string[],
  exec: Executor = getPool(),
): Promise<Banner[]> {
  await Promise.all(ids.map((id, index) =>
    execute('UPDATE banners SET position = ? WHERE id = ?', [index + 1, id], exec)));
  await writeAudit({
    actor, action: 'banner.reordered', entityType: 'banner', entityId: ids[0] ?? 'none',
    after: { order: ids },
  }, exec);
  return listBanners(exec);
}

/* ── the picture ───────────────────────────────────────────────────────── */

/**
 * The banner's own photograph.
 *
 * `banners.image_path` has been in the schema since migration 0036 and
 * nothing could fill it: the design's form has an Upload button beside the
 * five cover styles, and there was no endpoint behind it. A banner with a
 * real photograph of the project is the difference between an announcement
 * somebody reads and a coloured rectangle they scroll past.
 *
 * 1200 × 500 is what the design asks for and what the card is drawn at. The
 * file is stored as given and the card crops it, because resizing on the
 * server means an image library on the deploy path of a live CRM.
 */
export const BANNER_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** Four megabytes. A banner photograph larger than that is a mistake. */
export const MAX_BANNER_IMAGE_BYTES = 4 * 1024 * 1024;

export async function saveBannerImage(
  actor: AuditActor,
  id: string,
  contentType: string,
  body: Buffer,
  exec: Executor = getPool(),
): Promise<Banner> {
  const found = await queryOne<{ id: string }>('SELECT id FROM banners WHERE id = ?', [id], exec);
  if (!found) throw notFound('That banner does not exist.');

  const extension = extensionFor(contentType, BANNER_IMAGE_TYPES);
  if (!extension) {
    throw badRequest(`${contentType || 'That file'} is not a picture. PNG, JPG or WebP.`);
  }
  if (body.length === 0) throw badRequest('That file is empty.');
  if (body.length > MAX_BANNER_IMAGE_BYTES) throw badRequest('That picture is larger than 4 MB.');

  const dir = uploadDir('banners');
  await mkdir(dir, { recursive: true });
  /* Named after the row, never after what the uploader called it. */
  const name = `${id}${extension}`;
  await writeFile(path.join(dir, name), body);
  await execute('UPDATE banners SET image_path = ? WHERE id = ?', [name, id], exec);

  await writeAudit({
    actor, action: 'banner.image_changed', entityType: 'banner', entityId: id,
    after: { bytes: body.length, contentType },
  }, exec);

  return oneBanner(id, exec);
}

/** The file back, for the preview and for My Day. */
export async function bannerImage(
  id: string,
  exec: Executor = getPool(),
): Promise<{ file: string; contentType: string }> {
  const row = await queryOne<{ image_path: string | null }>(
    'SELECT image_path FROM banners WHERE id = ?', [id], exec,
  );
  if (!row?.image_path) throw notFound('That banner has no picture.');

  const file = path.join(uploadDir('banners'), path.basename(row.image_path));
  if (!insideUploadDir(file)) throw notFound('That banner has no picture.');
  const extension = path.extname(file);
  const contentType = Object.entries(BANNER_IMAGE_TYPES)
    .find(([, ext]) => ext === extension)?.[0] ?? 'application/octet-stream';
  return { file, contentType };
}
