/**
 * Pictures and GIFs on the team wall.
 *
 * `wall_posts.media` has always been there and the API has always accepted
 * it; what was missing was a way to get a file onto the server. This is it,
 * built on the same two rules every upload in this CRM follows (lib/uploads):
 * an allow-list of types, never a block-list, and a stored file named after
 * its own id so nothing an uploader typed ever reaches the file system.
 *
 * A wall image is not a task attachment. It is posted to the whole floor
 * rather than attached to one record, so it gets its own folder and its own
 * row: deleting a post should be able to take its pictures with it one day,
 * without reaching into somebody's task.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execute, queryOne, type Executor, getPool } from '../db/client.js';
import { env } from '../config/env.js';
import { newId } from '../lib/ids.js';
import { badRequest } from '../lib/errors.js';
import { extensionFor, insideUploadDir, uploadDir } from '../lib/uploads.js';

/** No PDF here: a wall post is something you look at, not a document. */
export const WALL_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export function wallMediaDir(): string {
  return uploadDir('wall');
}

export interface WallMedia {
  id: string;
  url: string;
  kind: 'image';
  name: string;
  contentType: string;
}

export interface SaveWallMedia {
  filename: string;
  contentType: string;
  body: Buffer;
  uploadedByUserId: string;
}

export async function saveWallMedia(
  input: SaveWallMedia,
  exec: Executor = getPool(),
): Promise<WallMedia> {
  const extension = extensionFor(input.contentType, WALL_IMAGE_TYPES);
  if (!extension) {
    throw badRequest(
      `${input.contentType || 'That file'} cannot go on the wall. JPEG, PNG, WebP or GIF.`,
    );
  }
  /* A GIF is the point of half of this, and a good one is heavy, so the wall
     gets its own ceiling rather than the attachment one. */
  const limit = env().MAX_ATTACHMENT_MB * 1024 * 1024;
  if (input.body.length === 0) throw badRequest('That file is empty');
  if (input.body.length > limit) {
    throw badRequest(`That file is larger than the ${env().MAX_ATTACHMENT_MB} MB limit`);
  }

  const id = newId();
  const dir = wallMediaDir();
  await mkdir(dir, { recursive: true });
  /* Named after the row, never after what the uploader called it. */
  const storagePath = path.join(dir, `${id}${extension}`);
  await writeFile(storagePath, input.body);

  await execute(
    `INSERT INTO wall_media (id, storage_path, content_type, filename, bytes, uploaded_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, storagePath, input.contentType, input.filename.slice(0, 255), input.body.length, input.uploadedByUserId],
    exec,
  );

  return {
    id,
    url: `/api/wall/media/${id}`,
    kind: 'image',
    name: input.filename.slice(0, 255),
    contentType: input.contentType,
  };
}

export interface StoredWallMedia {
  id: string;
  storage_path: string;
  content_type: string;
  filename: string;
}

/**
 * Find a stored file, refusing anything that resolved outside the upload
 * directory. Without that check a stored path of `../../etc/passwd` is a file
 * this CRM would happily open and serve.
 */
export async function findWallMedia(
  id: string,
  exec: Executor = getPool(),
): Promise<StoredWallMedia | null> {
  const row = await queryOne<StoredWallMedia>(
    'SELECT id, storage_path, content_type, filename FROM wall_media WHERE id = ?',
    [id],
    exec,
  );
  if (!row) return null;
  if (!insideUploadDir(row.storage_path)) return null;
  return row;
}
