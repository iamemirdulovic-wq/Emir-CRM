/**
 * The two rules every uploaded file in the CRM obeys.
 *
 * **What may be stored.** An allow-list of content types, never a block-list.
 * SVG is excluded although it is an image, because an SVG is a document that
 * can carry script, and serving one from the CRM's own origin would run that
 * script with the session cookie in scope. HTML is excluded for the same
 * reason.
 *
 * **Where it may live.** A stored file is named after its row id, never after
 * anything the uploader typed, and every read or delete checks the resolved
 * path is inside `UPLOAD_DIR` first. Without that check a stored path of
 * `../../etc/passwd` is a file the CRM will happily open and serve.
 *
 * Both rules used to live inside the task attachment module. They are here so
 * that the next thing that accepts a file cannot quietly get them wrong, and
 * so they can be tested without a database.
 */
import path from 'node:path';
import { env } from '../config/env.js';

/** Photos, because that is usually the point, and PDF for a floor plan. */
export const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

/**
 * What a phone actually records.
 *
 * Safari gives `audio/mp4`, Chrome and Android give `audio/webm`, and both
 * append a codecs parameter — `audio/webm;codecs=opus` — which must be
 * stripped before the type is looked up or every voice note is refused.
 */
export const AUDIO_TYPES: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
};

/** `audio/webm;codecs=opus` and `AUDIO/WEBM` are both `audio/webm`. */
export function baseContentType(contentType: string): string {
  return (contentType.split(';')[0] ?? '').trim().toLowerCase();
}

/** The file extension for a type, or null when it may not be stored at all. */
export function extensionFor(
  contentType: string,
  allowed: Record<string, string>,
): string | null {
  return allowed[baseContentType(contentType)] ?? null;
}

/** Is this something a browser can be trusted to render inline? */
export function isInlineSafe(contentType: string, allowed: Record<string, string>): boolean {
  const base = baseContentType(contentType);
  if (!(base in allowed)) return false;
  return base.startsWith('image/') || base.startsWith('audio/');
}

/** The folder a kind of upload lives in, always under `UPLOAD_DIR`. */
export function uploadDir(kind: string): string {
  return path.join(path.resolve(env().UPLOAD_DIR), kind);
}

/**
 * Only ever touch a file that resolves inside the upload directory.
 *
 * The root itself is not a file, so it is excluded too.
 */
export function insideUploadDir(filePath: string): boolean {
  const root = path.resolve(env().UPLOAD_DIR);
  const resolved = path.resolve(filePath);
  return resolved !== root && resolved.startsWith(root + path.sep);
}
