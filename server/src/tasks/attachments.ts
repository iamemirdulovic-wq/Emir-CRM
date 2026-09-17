/**
 * Files attached to a task: property photos, a floor plan, a screenshot of a
 * portal listing.
 *
 * Two rules shape everything here, and both are about serving a file back that
 * a user uploaded.
 *
 * **What may be stored.** An allow-list of types, not a block-list. SVG is
 * excluded although it is an image, because an SVG is a document that can carry
 * script, and serving one from the CRM's own origin would run that script with
 * the session cookie in scope. HTML is excluded for the same reason.
 *
 * **Where it may live.** The file on disk is named after its row id, never
 * after anything the uploader typed, and every read or delete checks the
 * resolved path is inside `UPLOAD_DIR` before touching it.
 */
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { execute, getPool, query, queryOne, type Executor } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { badRequest, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * What a task may carry. Photos, because that is the point, and PDF because a
 * floor plan or a reservation form usually is one.
 */
const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

export const ALLOWED_TYPES = Object.keys(ALLOWED);

/** Is this something a browser can be trusted to render inline? */
export function isInlineSafe(contentType: string): boolean {
  return contentType.startsWith('image/') && contentType in ALLOWED;
}

export type Attachment = {
  id: string;
  task_id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  created_at: string;
};

function attachmentsDir(): string {
  return path.join(path.resolve(env().UPLOAD_DIR), 'tasks');
}

/** Only ever touch a file that resolves inside the upload directory. */
function insideUploadDir(filePath: string): boolean {
  const root = path.resolve(env().UPLOAD_DIR);
  const resolved = path.resolve(filePath);
  return resolved !== root && resolved.startsWith(root + path.sep);
}

export type SaveInput = {
  taskId: string;
  filename: string;
  contentType: string;
  body: Buffer;
  uploadedByUserId: string | null;
};

export async function saveAttachment(input: SaveInput, exec: Executor = getPool()): Promise<Attachment> {
  const extension = ALLOWED[input.contentType];
  if (!extension) {
    throw badRequest(
      `${input.contentType} cannot be attached. Images (JPEG, PNG, WebP, GIF) and PDF only.`,
    );
  }
  const limit = env().MAX_ATTACHMENT_MB * 1024 * 1024;
  if (input.body.length === 0) throw badRequest('That file is empty');
  if (input.body.length > limit) {
    throw badRequest(`That file is larger than the ${env().MAX_ATTACHMENT_MB} MB limit`);
  }

  const id = newId();
  const dir = attachmentsDir();
  await mkdir(dir, { recursive: true });
  // Named after the row, never after what the uploader called it.
  const storagePath = path.join(dir, `${id}${extension}`);
  await writeFile(storagePath, input.body);

  await execute(
    `INSERT INTO task_attachments (id, task_id, filename, content_type, byte_size, storage_path, uploaded_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.taskId,
      input.filename.slice(0, 255),
      input.contentType,
      input.body.length,
      storagePath,
      input.uploadedByUserId,
    ],
    exec,
  );

  return {
    id,
    task_id: input.taskId,
    filename: input.filename.slice(0, 255),
    content_type: input.contentType,
    byte_size: input.body.length,
    created_at: new Date().toISOString(),
  };
}

/** Attachments for a set of tasks, so a list of cards costs one query, not one each. */
export async function attachmentsFor(taskIds: string[], exec: Executor = getPool()): Promise<Attachment[]> {
  if (taskIds.length === 0) return [];
  return query<Attachment>(
    `SELECT id, task_id, filename, content_type, byte_size, created_at
       FROM task_attachments
      WHERE task_id IN (${taskIds.map(() => '?').join(',')})
      ORDER BY created_at ASC`,
    taskIds,
    exec,
  );
}

export type StoredAttachment = Attachment & { storage_path: string };

export async function findAttachment(id: string, exec: Executor = getPool()): Promise<StoredAttachment> {
  const row = await queryOne<StoredAttachment>(
    `SELECT id, task_id, filename, content_type, byte_size, storage_path, created_at
       FROM task_attachments WHERE id = ?`,
    [id],
    exec,
  );
  if (!row) throw notFound('That attachment does not exist');
  return row;
}

/** A readable stream of the file, once the caller has been shown to be allowed it. */
export async function openAttachment(row: StoredAttachment): Promise<Readable> {
  if (!insideUploadDir(row.storage_path)) {
    logger.warn('refusing to read an attachment outside the upload directory', { attachmentId: row.id });
    throw notFound('That attachment is not available');
  }
  // Fail before the response starts rather than mid-stream, which would send a
  // 200 followed by nothing.
  await stat(row.storage_path).catch(() => {
    throw notFound('That attachment is no longer on disk');
  });
  return createReadStream(row.storage_path);
}

export async function deleteAttachment(row: StoredAttachment, exec: Executor = getPool()): Promise<void> {
  if (insideUploadDir(row.storage_path)) {
    await unlink(row.storage_path).catch((err: NodeJS.ErrnoException) => {
      // Already gone is fine; anything else is worth a line but must not stop
      // the row being removed, or the file becomes unreachable and permanent.
      if (err.code !== 'ENOENT') logger.warn('could not delete an attachment file', { attachmentId: row.id, code: err.code });
    });
  }
  await execute('DELETE FROM task_attachments WHERE id = ?', [row.id], exec);
}

/**
 * Files whose rows have gone — a deleted task cascades the row away and leaves
 * the bytes behind. Run from the hourly maintenance job.
 */
export async function purgeOrphanedAttachments(exec: Executor = getPool()): Promise<number> {
  const { readdir } = await import('node:fs/promises');
  const dir = attachmentsDir();
  const files = await readdir(dir).catch(() => [] as string[]);
  if (files.length === 0) return 0;

  const ids = files.map((file) => path.parse(file).name);
  const alive = new Set(
    (
      await query<{ id: string }>(
        `SELECT id FROM task_attachments WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids,
        exec,
      )
    ).map((row) => row.id),
  );

  let removed = 0;
  for (const file of files) {
    if (alive.has(path.parse(file).name)) continue;
    const full = path.join(dir, file);
    if (!insideUploadDir(full)) continue;
    await unlink(full).catch(() => undefined);
    removed += 1;
  }
  return removed;
}
