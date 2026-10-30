import { ApiError } from './api.js';

/**
 * Uploading a file or a voice note onto a note.
 *
 * The body is the file itself with its name in a header, matching the task and
 * import uploads — no multipart parser on either side, and nothing buffers the
 * request twice. `fetch` is used directly rather than through `api` because
 * that wrapper is built for JSON.
 */

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

export async function uploadNoteFile(
  noteId: string,
  file: Blob,
  options: { filename: string; durationSeconds?: number | null },
): Promise<NoteFile> {
  const response = await fetch(`/api/notes/item/${noteId}/files`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      // A filename can hold anything, including newlines, which would split
      // the header. Encoded here and read back as one value on the server.
      'X-Filename': encodeURIComponent(options.filename).slice(0, 255),
      ...(options.durationSeconds
        ? { 'X-Duration-Seconds': String(Math.round(options.durationSeconds)) }
        : {}),
    },
    body: file,
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(response.status, error?.code ?? 'error', error?.message ?? 'Upload failed');
  }
  return payload as NoteFile;
}

export async function deleteNoteFile(fileId: string): Promise<void> {
  await fetch(`/api/notes/files/${fileId}`, { method: 'DELETE', credentials: 'same-origin' });
}

/** Group a flat file list by the note it belongs to. */
export function byNote(files: NoteFile[]): Map<string, NoteFile[]> {
  const out = new Map<string, NoteFile[]>();
  for (const file of files) {
    const bucket = out.get(file.note_id);
    if (bucket) bucket.push(file);
    else out.set(file.note_id, [file]);
  }
  return out;
}

/** The name a voice note gets, since the browser does not give it one. */
export function voiceFilename(mimeType: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  return `voice-note-${stamp}.${extension}`;
}
