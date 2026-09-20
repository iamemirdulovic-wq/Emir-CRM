/**
 * Holding a document on disk while Emir AI reads it.
 *
 * The limit went from 14 MB to 400 MB at the owner's request, and the way the
 * file was handled did not survive that change. Every byte was buffered in
 * memory: one 400 MB brochure meant 400 MB of RAM, two at once meant the
 * process was killed — and the process is the whole CRM, so one large upload
 * would have taken the team's pipeline, inbox and WhatsApp down with it.
 *
 * So the request is streamed straight to a temporary file and never held whole.
 * It is deleted when the extraction finishes, whether or not it succeeded.
 */
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export type StoredDocument = {
  /** Where the bytes are. Never passed to a caller who might echo it. */
  filePath: string;
  bytes: number;
  /** Removes the file. Safe to call twice. */
  discard: () => Promise<void>;
};

function scratchDir(): string {
  return path.join(path.resolve(env().UPLOAD_DIR), 'scratch');
}

/**
 * Stream a request body to disk, stopping the moment it goes over the limit.
 *
 * Counted as it arrives rather than afterwards: a limit checked at the end has
 * already accepted the bytes it was meant to refuse.
 */
export async function storeDocument(
  source: Readable,
  limitBytes: number,
): Promise<StoredDocument> {
  const dir = scratchDir();
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${randomBytes(16).toString('hex')}.tmp`);

  let bytes = 0;
  let tooBig = false;

  const counter = async function* count(): AsyncGenerator<Buffer> {
    for await (const chunk of source) {
      bytes += (chunk as Buffer).length;
      if (bytes > limitBytes) {
        tooBig = true;
        // Stop reading: there is no reason to receive the rest of it.
        source.destroy();
        return;
      }
      yield chunk as Buffer;
    }
  };

  const discard = async () => {
    await unlink(filePath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') logger.warn('could not delete a scratch document', { code: err.code });
    });
  };

  try {
    await pipeline(counter(), createWriteStream(filePath, { mode: 0o600 }));
  } catch (err) {
    await discard();
    // A client that hung up mid-upload is not an error worth a stack trace.
    logger.debug('upload did not finish', { error: err instanceof Error ? err.message : String(err) });
    throw badRequest('The upload did not finish. Try again.');
  }

  if (tooBig) {
    await discard();
    throw badRequest(
      `That file is larger than ${Math.round(limitBytes / (1024 * 1024))} MB, which is past what the `
      + 'CRM will read. Ask the developer for the web version rather than the print master.',
    );
  }

  if (bytes === 0) {
    await discard();
    throw badRequest('That file is empty');
  }

  return { filePath, bytes, discard };
}

/** A stream of the stored bytes, for sending on without holding them. */
export function readDocument(document: StoredDocument): Readable {
  return createReadStream(document.filePath);
}

/**
 * The whole file in memory.
 *
 * Only for a document small enough that it is going inline anyway — the point
 * of this module is that a large one never gets loaded at all.
 */
export async function readWholeDocument(document: StoredDocument, maxBytes: number): Promise<Buffer> {
  const info = await stat(document.filePath);
  if (info.size > maxBytes) {
    throw new Error(`refusing to load ${info.size} bytes into memory`);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(document.filePath)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Scratch files left behind by a request that died mid-read.
 *
 * `discard` runs in a `finally`, so this should find nothing — but a process
 * killed between the write and the read leaves a file nobody will ever come
 * back for, and at 400 MB each that fills a disk quickly. Swept hourly.
 */
export async function purgeStaleDocuments(olderThanMs = 60 * 60 * 1000): Promise<number> {
  const { readdir } = await import('node:fs/promises');
  const dir = scratchDir();
  const files = await readdir(dir).catch(() => [] as string[]);

  let removed = 0;
  for (const name of files) {
    const full = path.join(dir, name);
    try {
      const info = await stat(full);
      if (Date.now() - info.mtimeMs < olderThanMs) continue;
      await unlink(full);
      removed += 1;
    } catch {
      // Gone already, or being written right now. Either is fine.
    }
  }
  return removed;
}
