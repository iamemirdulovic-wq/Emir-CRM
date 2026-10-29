import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { execute, query } from '../db/client.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { UNDO_WINDOW_HOURS } from './run.js';

/**
 * Uploaded import files are working copies, not records. Once the rows are
 * staged in `import_rows` nothing reads the file again — the failed-rows CSV is
 * rebuilt from the database — so keeping it only costs disk. A 100k-row xlsx is
 * tens of megabytes and Hostinger's disk is finite.
 *
 * We keep a file until the import's undo window has closed, so that an import
 * being reviewed or undone still has its source to hand, and we keep abandoned
 * uploads (someone who opened the wizard and walked away) for a week.
 */
const ABANDONED_DAYS = 7;

/** Guard: only ever unlink inside the configured upload directory. */
function insideUploadDir(filePath: string): boolean {
  const root = path.resolve(env().UPLOAD_DIR);
  const resolved = path.resolve(filePath);
  return resolved === root ? false : resolved.startsWith(root + path.sep);
}

export async function purgeExpiredUploads(): Promise<number> {
  const rows = await query<{ id: string; file_path: string }>(
    `SELECT id, file_path FROM imports
      WHERE file_path IS NOT NULL
        AND (
          (status IN ('completed','undone','failed') AND COALESCE(finished_at, created_at) < DATE_SUB(NOW(3), INTERVAL ? HOUR))
          OR (status IN ('uploaded','mapping','validating','ready') AND created_at < DATE_SUB(NOW(3), INTERVAL ? DAY))
        )
      LIMIT 500`,
    [UNDO_WINDOW_HOURS, ABANDONED_DAYS],
  );

  let removed = 0;
  for (const row of rows) {
    if (!insideUploadDir(row.file_path)) {
      logger.warn('refusing to delete an import file outside the upload directory', { importId: row.id });
      continue;
    }
    try {
      await unlink(row.file_path);
    } catch (err) {
      // Already gone is the normal case on a second sweep; anything else is
      // worth a line but must not stop the rest.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logger.warn('could not delete an import file', { importId: row.id, code });
        continue;
      }
    }
    // Clearing the column is what marks it done, so the sweep does not retry
    // the same rows every hour forever.
    await execute('UPDATE imports SET file_path = NULL WHERE id = ?', [row.id]);
    removed += 1;
  }
  return removed;
}
