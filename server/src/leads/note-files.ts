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

/**
 * The folders on the lead page's Files tab.
 *
 * `design/web/lead.html` names four of them — All, Passport & ID, Booking
 * forms, WhatsApp screenshots — and adds a fifth in its empty state:
 * "Payment receipts also get their own folder when you add the first one."
 * `other` is where every file uploaded before migration 0038 sits, which is
 * All, which is where it has always been.
 */
export const FILE_FOLDERS = ['photo', 'id', 'booking', 'whatsapp', 'receipt', 'other'] as const;
export type FileFolder = (typeof FILE_FOLDERS)[number];

export const FOLDER_LABELS: Record<FileFolder, string> = {
  photo: 'Photos',
  id: 'Passport & ID',
  booking: 'Booking forms',
  whatsapp: 'WhatsApp screenshots',
  receipt: 'Payment receipts',
  other: 'Other files',
};

/**
 * Folders only the agent who holds the lead and the owners may open.
 *
 * The design says it in words on the tab: "IDs and passports: only you and
 * owners see them. Every view is logged." The second half is `view_count`,
 * below; the first half is enforced where the file is served.
 */
export const PRIVATE_FOLDERS = new Set<FileFolder>(['id']);

export function isFileFolder(value: unknown): value is FileFolder {
  return typeof value === 'string' && (FILE_FOLDERS as readonly string[]).includes(value);
}

export interface NoteFile {
  id: string;
  note_id: string;
  kind: 'file' | 'voice';
  filename: string;
  content_type: string;
  byte_size: number;
  duration_s: number | null;
  created_at: string;
  folder?: FileFolder;
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
  /** Which of the Files tab's folders it belongs in. */
  folder?: FileFolder | null;
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
       (id, note_id, contact_id, kind, filename, content_type, byte_size, duration_s, storage_path,
        uploaded_by_user_id, folder)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.noteId, input.contactId, kind,
      input.filename.slice(0, 255), input.contentType.slice(0, 100),
      input.body.length, duration, storagePath, input.uploadedByUserId,
      isFileFolder(input.folder) ? input.folder : 'other',
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
    folder: isFileFolder(input.folder) ? input.folder : 'other',
  };
}

export interface LeadFile extends NoteFile {
  folder: FileFolder;
  /** How many times somebody has opened it. The design prints this. */
  view_count: number;
  last_viewed_at: string | null;
  added_by: string | null;
  private: boolean;
}

/**
 * Every file on one lead, for the Files tab.
 *
 * Read off `note_files.contact_id` rather than by walking the notes, which is
 * what that column was put there for.
 */
export async function filesForContact(
  contactId: string,
  exec: Executor = getPool(),
): Promise<LeadFile[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT f.id, f.note_id, f.kind, f.filename, f.content_type, f.byte_size, f.duration_s,
            f.folder, f.view_count, f.last_viewed_at, f.created_at, u.name AS added_by
       FROM note_files f
       LEFT JOIN users u ON u.id = f.uploaded_by_user_id
       JOIN lead_notes n ON n.id = f.note_id AND n.deleted_at IS NULL
      WHERE f.contact_id = ?
      ORDER BY f.created_at DESC`,
    [contactId],
    exec,
  );

  return rows.map((row) => {
    const folder = isFileFolder(row.folder) ? row.folder : 'other';
    return {
      id: String(row.id),
      note_id: String(row.note_id),
      kind: row.kind === 'voice' ? 'voice' : 'file',
      filename: String(row.filename),
      content_type: String(row.content_type),
      byte_size: Number(row.byte_size),
      duration_s: row.duration_s === null ? null : Number(row.duration_s),
      created_at: new Date(row.created_at as string).toISOString(),
      folder,
      view_count: Number(row.view_count ?? 0),
      last_viewed_at: row.last_viewed_at
        ? new Date(row.last_viewed_at as string).toISOString()
        : null,
      added_by: (row.added_by as string | null) ?? null,
      private: PRIVATE_FOLDERS.has(folder),
    };
  });
}

/**
 * "Every view is logged."
 *
 * Counted on the row as well as written to `audit_log`, because the design
 * prints the number on the file ("viewed 2 times") and counting audit rows
 * for that would mean a JSON scan of the whole log on every page load.
 */
export async function recordFileView(id: string, exec: Executor = getPool()): Promise<void> {
  await execute(
    'UPDATE note_files SET view_count = view_count + 1, last_viewed_at = NOW(3) WHERE id = ?',
    [id],
    exec,
  );
}

/** Files for a set of notes, so a panel of notes costs one query, not one each. */
export async function filesForNotes(
  noteIds: string[],
  exec: Executor = getPool(),
): Promise<NoteFile[]> {
  if (noteIds.length === 0) return [];
  return query<NoteFile>(
    `SELECT id, note_id, kind, filename, content_type, byte_size, duration_s, folder, created_at
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
            storage_path, folder, created_at
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
