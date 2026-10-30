/**
 * Files and voice notes on a lead note.
 *
 * The voice note is the reason this exists. An agent has most to say in the
 * two minutes after a viewing — what the client stopped to look at, what they
 * went quiet about — and that is exactly when they are walking to a car with a
 * phone in one hand. Thirty seconds of talking gets recorded; the same thirty
 * seconds of typing does not, and the detail is gone.
 *
 * What may be stored and where it may live are decided in `lib/uploads.ts`.
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
import {
  AUDIO_TYPES, IMAGE_TYPES, baseContentType, extensionFor, insideUploadDir, uploadDir,
} from '../lib/uploads.js';

/** A note may carry what a task may carry, plus what a phone records. */
export const NOTE_FILE_TYPES = { ...IMAGE_TYPES, ...AUDIO_TYPES };
export const ALLOWED_TYPES = Object.keys(NOTE_FILE_TYPES);

export interface NoteFile {
  id: string;
  note_id: string;
  kind: 'file' | 'voice';
  filename: string;
  content_type: string;
  byte_size: number;
  duration_s: number | null;
  created_at: string;
}

export type StoredNoteFile = NoteFile & { storage_path: string; contact_id: string };

function notesDir(): string {
  return uploadDir('notes');
}

export interface SaveNoteFileInput {
  noteId: string;
  contactId: string;
  filename: string;
  contentType: string;
  body: Buffer;
  /** Seconds. Only meaningful for a voice note, and only the browser knows it. */
  durationSeconds?: number | null;
  uploadedByUserId: string | null;
}

export async function saveNoteFile(
  input: SaveNoteFileInput,
  exec: Executor = getPool(),
): Promise<NoteFile> {
  const extension = extensionFor(input.contentType, NOTE_FILE_TYPES);
  if (!extension) {
    throw badRequest(
      `${input.contentType} cannot be attached to a note. Images, PDF and voice recordings only.`,
    );
  }

  const limit = env().MAX_ATTACHMENT_MB * 1024 * 1024;
  if (input.body.length === 0) throw badRequest('That file is empty');
  if (input.body.length > limit) {
    throw badRequest(`That file is larger than the ${env().MAX_ATTACHMENT_MB} MB limit`);
  }

  const kind: NoteFile['kind'] = baseContentType(input.contentType) in AUDIO_TYPES ? 'voice' : 'file';

  const id = newId();
  const dir = notesDir();
  await mkdir(dir, { recursive: true });
  // Named after the row, never after what the uploader called it.
  const storagePath = path.join(dir, `${id}${extension}`);
  await writeFile(storagePath, input.body);

  /* A duration the browser could not measure is null rather than zero: zero
     would render as a 0:00 recording, which reads as broken. */
  const duration = kind === 'voice' && input.durationSeconds && input.durationSeconds > 0
    ? Math.min(Math.round(input.durationSeconds), 60 * 60)
    : null;

  await execute(
    `INSERT INTO note_files
       (id, note_id, contact_id, kind, filename, content_type, byte_size, duration_s, storage_path, uploaded_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.noteId, input.contactId, kind,
      input.filename.slice(0, 255), input.contentType.slice(0, 100),
      input.body.length, duration, storagePath, input.uploadedByUserId,
    ],
    exec,
  );

  return {
    id,
    note_id: input.noteId,
    kind,
    filename: input.filename.slice(0, 255),
    content_type: input.contentType,
    byte_size: input.body.length,
    duration_s: duration,
    created_at: new Date().toISOString(),
  };
}

/** Files for a set of notes, so a panel of notes costs one query, not one each. */
export async function filesForNotes(
  noteIds: string[],
  exec: Executor = getPool(),
): Promise<NoteFile[]> {
  if (noteIds.length === 0) return [];
  return query<NoteFile>(
    `SELECT id, note_id, kind, filename, content_type, byte_size, duration_s, created_at
       FROM note_files
      WHERE note_id IN (${noteIds.map(() => '?').join(',')})
      ORDER BY created_at ASC`,
    noteIds,
    exec,
  );
}

export async function findNoteFile(id: string, exec: Executor = getPool()): Promise<StoredNoteFile> {
  const row = await queryOne<StoredNoteFile>(
    `SELECT id, note_id, contact_id, kind, filename, content_type, byte_size, duration_s,
            storage_path, created_at
       FROM note_files WHERE id = ?`,
    [id],
    exec,
  );
  if (!row) throw notFound('That file does not exist');
  return row;
}

/** A readable stream of the file, once the caller has been shown to be allowed it. */
export async function openNoteFile(row: StoredNoteFile): Promise<Readable> {
  if (!insideUploadDir(row.storage_path)) {
    logger.warn('refusing to read a note file outside the upload directory', { noteFileId: row.id });
    throw notFound('That file is not available');
  }
  // Fail before the response starts rather than mid-stream, which would send a
  // 200 followed by nothing.
  await stat(row.storage_path).catch(() => {
    throw notFound('That file is no longer on disk');
  });
  return createReadStream(row.storage_path);
}

export async function deleteNoteFile(row: StoredNoteFile, exec: Executor = getPool()): Promise<void> {
  if (insideUploadDir(row.storage_path)) {
    await unlink(row.storage_path).catch((err: NodeJS.ErrnoException) => {
      // Already gone is fine; anything else is worth a line but must not stop
      // the row being removed, or the file becomes unreachable and permanent.
      if (err.code !== 'ENOENT') {
        logger.warn('could not delete a note file', { noteFileId: row.id, code: err.code });
      }
    });
  }
  await execute('DELETE FROM note_files WHERE id = ?', [row.id], exec);
}
