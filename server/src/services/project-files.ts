/**
 * Photos and documents belonging to a project.
 *
 * The same two rules as task attachments, for the same reasons.
 *
 * **What may be stored.** An allow-list, not a block-list. SVG is excluded
 * although it is an image: an SVG is a document that can carry script, and
 * serving one from the CRM's own origin would run that script with the session
 * cookie in scope. HTML is excluded for the same reason.
 *
 * **Where it may live.** The file on disk is named after its row id, never
 * after anything the uploader typed, and every read or delete checks the
 * resolved path is inside `UPLOAD_DIR` first.
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
import { writeAudit, type AuditActor } from '../audit/audit.js';

/** A photo. PDFs go in documents, not here. */
const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** A document. Images allowed too: a price list is often a photographed page. */
const DOCUMENT_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const PHOTO_CONTENT_TYPES = Object.keys(PHOTO_TYPES);
export const DOCUMENT_CONTENT_TYPES = Object.keys(DOCUMENT_TYPES);

export const DOCUMENT_KINDS = [
  'developer_offer', 'brochure_en', 'brochure_ar', 'price_list', 'floor_plan_pack',
  'master_plan', 'payment_plan_sheet', 'rera_certificate', 'commission_agreement',
  'spa_template', 'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type ProjectPhoto = {
  id: string;
  project_id: string;
  filename: string | null;
  content_type: string | null;
  byte_size: number | null;
  caption: string | null;
  is_cover: number;
  sort_order: number;
  created_at: string;
};

export type ProjectDocument = {
  id: string;
  project_id: string;
  kind: DocumentKind;
  filename: string;
  content_type: string;
  byte_size: number;
  created_at: string;
};

function filesDir(): string {
  return path.join(path.resolve(env().UPLOAD_DIR), 'projects');
}

/** Only ever touch a file that resolves inside the upload directory. */
function insideUploadDir(filePath: string): boolean {
  const root = path.resolve(env().UPLOAD_DIR);
  const resolved = path.resolve(filePath);
  return resolved !== root && resolved.startsWith(root + path.sep);
}

function checkSize(bytes: number): void {
  const limit = env().MAX_ATTACHMENT_MB * 1024 * 1024;
  if (bytes === 0) throw badRequest('That file is empty');
  if (bytes > limit) throw badRequest(`That file is larger than the ${env().MAX_ATTACHMENT_MB} MB limit`);
}

async function store(id: string, extension: string, body: Buffer): Promise<string> {
  const dir = filesDir();
  await mkdir(dir, { recursive: true });
  // Named after the row, never after what the uploader called it.
  const storagePath = path.join(dir, `${id}${extension}`);
  await writeFile(storagePath, body);
  return storagePath;
}

/* ── Photos ─────────────────────────────────────────────────────────────── */

export async function savePhoto(
  actor: AuditActor,
  input: { projectId: string; filename: string; contentType: string; body: Buffer; caption?: string | null },
  exec: Executor = getPool(),
): Promise<ProjectPhoto> {
  const extension = PHOTO_TYPES[input.contentType];
  if (!extension) {
    throw badRequest(`${input.contentType} is not a photo the CRM can store. JPEG, PNG or WebP.`);
  }
  checkSize(input.body.length);

  const id = newId();
  const storagePath = await store(id, extension, input.body);

  /*
   * The first photo becomes the cover, because a project card with no picture
   * is the one an agent scrolls past. Later ones do not take it over.
   */
  const existing = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM project_media WHERE project_id = ? AND kind = 'photo'",
    [input.projectId],
    exec,
  );
  const isCover = Number(existing?.n ?? 0) === 0 ? 1 : 0;

  await execute(
    `INSERT INTO project_media
       (id, project_id, kind, storage_path, filename, content_type, byte_size, caption, is_cover, sort_order)
     VALUES (?, ?, 'photo', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.projectId, storagePath, input.filename.slice(0, 255), input.contentType,
      input.body.length, input.caption?.slice(0, 255) ?? null, isCover, Number(existing?.n ?? 0),
    ],
    exec,
  );

  await writeAudit({
    actor,
    action: 'project.photo_added',
    entityType: 'project',
    entityId: input.projectId,
    after: { photoId: id, filename: input.filename, bytes: input.body.length },
  });

  return {
    id,
    project_id: input.projectId,
    filename: input.filename.slice(0, 255),
    content_type: input.contentType,
    byte_size: input.body.length,
    caption: input.caption ?? null,
    is_cover: isCover,
    sort_order: Number(existing?.n ?? 0),
    created_at: new Date().toISOString(),
  };
}

export async function listPhotos(projectId: string, exec: Executor = getPool()): Promise<ProjectPhoto[]> {
  return query<ProjectPhoto>(
    `SELECT id, project_id, filename, content_type, byte_size, caption, is_cover, sort_order, created_at
       FROM project_media
      WHERE project_id = ? AND kind = 'photo' AND storage_path IS NOT NULL
      ORDER BY is_cover DESC, sort_order ASC, created_at ASC`,
    [projectId],
    exec,
  );
}

/** Exactly one cover, set in a transaction so a failure cannot leave none. */
export async function setCover(
  actor: AuditActor,
  photoId: string,
  exec: Executor = getPool(),
): Promise<void> {
  const row = await queryOne<{ project_id: string }>(
    'SELECT project_id FROM project_media WHERE id = ?', [photoId], exec,
  );
  if (!row) throw notFound('That photo does not exist');

  await execute('UPDATE project_media SET is_cover = 0 WHERE project_id = ?', [row.project_id], exec);
  await execute('UPDATE project_media SET is_cover = 1 WHERE id = ?', [photoId], exec);

  await writeAudit({
    actor, action: 'project.cover_set', entityType: 'project', entityId: row.project_id,
    after: { photoId },
  });
}

/* ── Documents ──────────────────────────────────────────────────────────── */

export async function saveDocument(
  actor: AuditActor,
  input: {
    projectId: string; kind: DocumentKind; filename: string; contentType: string;
    body: Buffer; uploadedByUserId: string | null;
  },
  exec: Executor = getPool(),
): Promise<ProjectDocument> {
  const extension = DOCUMENT_TYPES[input.contentType];
  if (!extension) {
    throw badRequest(`${input.contentType} cannot be stored. PDF, or a photo of the page (JPEG, PNG, WebP).`);
  }
  checkSize(input.body.length);

  const id = newId();
  const storagePath = await store(id, extension, input.body);

  await execute(
    `INSERT INTO project_documents
       (id, project_id, kind, filename, storage_path, content_type, byte_size, uploaded_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.projectId, input.kind, input.filename.slice(0, 255), storagePath,
      input.contentType, input.body.length, input.uploadedByUserId],
    exec,
  );

  await writeAudit({
    actor,
    action: 'project.document_added',
    entityType: 'project',
    entityId: input.projectId,
    after: { documentId: id, kind: input.kind, filename: input.filename, bytes: input.body.length },
  });

  return {
    id,
    project_id: input.projectId,
    kind: input.kind,
    filename: input.filename.slice(0, 255),
    content_type: input.contentType,
    byte_size: input.body.length,
    created_at: new Date().toISOString(),
  };
}

export async function listDocuments(projectId: string, exec: Executor = getPool()): Promise<ProjectDocument[]> {
  return query<ProjectDocument>(
    `SELECT id, project_id, kind, filename, content_type, byte_size, created_at
       FROM project_documents WHERE project_id = ? ORDER BY created_at ASC`,
    [projectId],
    exec,
  );
}

/* ── Reading and removing, for either kind ──────────────────────────────── */

export type StoredFile = {
  id: string;
  project_id: string;
  filename: string;
  content_type: string;
  storage_path: string;
};

export async function findPhoto(id: string, exec: Executor = getPool()): Promise<StoredFile> {
  const row = await queryOne<StoredFile>(
    `SELECT id, project_id, COALESCE(filename, 'photo') AS filename,
            COALESCE(content_type, 'application/octet-stream') AS content_type, storage_path
       FROM project_media WHERE id = ? AND storage_path IS NOT NULL`,
    [id], exec,
  );
  if (!row) throw notFound('That photo does not exist');
  return row;
}

export async function findDocument(id: string, exec: Executor = getPool()): Promise<StoredFile> {
  const row = await queryOne<StoredFile>(
    'SELECT id, project_id, filename, content_type, storage_path FROM project_documents WHERE id = ?',
    [id], exec,
  );
  if (!row) throw notFound('That document does not exist');
  return row;
}

/** A readable stream of the file, once the caller has been shown to be allowed it. */
export async function openFile(row: StoredFile): Promise<Readable> {
  if (!insideUploadDir(row.storage_path)) {
    logger.warn('refusing to read a project file outside the upload directory', { fileId: row.id });
    throw notFound('That file is not available');
  }
  // Fail before the response starts rather than mid-stream, which would send a
  // 200 followed by nothing.
  await stat(row.storage_path).catch(() => {
    throw notFound('That file is no longer on disk');
  });
  return createReadStream(row.storage_path);
}

async function removeFile(storagePath: string, id: string): Promise<void> {
  if (!insideUploadDir(storagePath)) return;
  await unlink(storagePath).catch((err: NodeJS.ErrnoException) => {
    // Already gone is fine; anything else is worth a line but must not stop
    // the row being removed, or the file becomes unreachable and permanent.
    if (err.code !== 'ENOENT') logger.warn('could not delete a project file', { fileId: id, code: err.code });
  });
}

export async function deletePhoto(actor: AuditActor, row: StoredFile, exec: Executor = getPool()): Promise<void> {
  const wasCover = await queryOne<{ is_cover: number }>(
    'SELECT is_cover FROM project_media WHERE id = ?', [row.id], exec,
  );
  await removeFile(row.storage_path, row.id);
  await execute('DELETE FROM project_media WHERE id = ?', [row.id], exec);

  // A project must not be left with photos and no cover.
  if (Number(wasCover?.is_cover ?? 0) === 1) {
    const next = await queryOne<{ id: string }>(
      `SELECT id FROM project_media
        WHERE project_id = ? AND kind = 'photo' AND storage_path IS NOT NULL
        ORDER BY sort_order ASC, created_at ASC LIMIT 1`,
      [row.project_id], exec,
    );
    if (next) await execute('UPDATE project_media SET is_cover = 1 WHERE id = ?', [next.id], exec);
  }

  await writeAudit({
    actor, action: 'project.photo_removed', entityType: 'project', entityId: row.project_id,
    before: { photoId: row.id, filename: row.filename },
  });
}

export async function deleteDocument(actor: AuditActor, row: StoredFile, exec: Executor = getPool()): Promise<void> {
  await removeFile(row.storage_path, row.id);
  await execute('DELETE FROM project_documents WHERE id = ?', [row.id], exec);
  await writeAudit({
    actor, action: 'project.document_removed', entityType: 'project', entityId: row.project_id,
    before: { documentId: row.id, filename: row.filename },
  });
}
