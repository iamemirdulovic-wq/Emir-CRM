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
import { z } from 'zod';
import { getPool, query, queryOne, execute, type Executor, type SqlParam } from '../db/client.js';
import { badRequest, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';

export const MAX_BANNERS = 5;

export interface Banner {
  id: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  imagePath: string | null;
  startsAt: string | null;
  endsAt: string | null;
  position: number;
  isActive: boolean;
  createdAt: string;
}

const COLUMNS = `id, title, body, link_url AS linkUrl, image_path AS imagePath,
  starts_at AS startsAt, ends_at AS endsAt, position, is_active AS isActive,
  created_at AS createdAt`;

function shape(row: Record<string, unknown>): Banner {
  return { ...(row as unknown as Banner), isActive: Number(row.isActive) === 1 };
}

export async function listBanners(exec: Executor = getPool()): Promise<Banner[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT ${COLUMNS} FROM banners ORDER BY position, created_at`, [], exec,
  );
  return rows.map(shape);
}

export const bannerSchema = z.object({
  title: z.string().min(2).max(160),
  body: z.string().max(500).nullable().optional(),
  linkUrl: z.string().max(500).nullable().optional(),
  imagePath: z.string().max(500).nullable().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

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

  const id = newId();
  const last = await queryOne<{ n: number | null }>(
    'SELECT MAX(position) AS n FROM banners', [], exec,
  );

  await execute(
    `INSERT INTO banners
       (id, title, body, link_url, image_path, starts_at, ends_at, position, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.title.trim(), input.body?.trim() || null, input.linkUrl?.trim() || null,
      input.imagePath ?? null, input.startsAt ?? null, input.endsAt ?? null,
      Number(last?.n ?? 0) + 1, (input.isActive ?? true) ? 1 : 0, actor.userId,
    ],
    exec,
  );
  await writeAudit({
    actor, action: 'banner.created', entityType: 'banner', entityId: id,
    after: { title: input.title },
  }, exec);

  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${COLUMNS} FROM banners WHERE id = ?`, [id], exec,
  );
  return shape(row as Record<string, unknown>);
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

  const sets: string[] = [];
  const params: SqlParam[] = [];
  const put = (sql: string, value: SqlParam) => { sets.push(sql); params.push(value); };

  if (input.title !== undefined) put('title = ?', input.title.trim());
  if (input.body !== undefined) put('body = ?', input.body?.trim() || null);
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
      after: { title: input.title ?? before.title, isActive: input.isActive },
    }, exec);
  }

  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${COLUMNS} FROM banners WHERE id = ?`, [id], exec,
  );
  return shape(row as Record<string, unknown>);
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
