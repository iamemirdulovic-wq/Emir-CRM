/**
 * Where the CRM keeps the things that must outlive a deploy.
 *
 * Two of them: the encryption key that reads the stored API keys, and the
 * uploaded files — import spreadsheets, task attachments, project photographs
 * and developers' documents.
 *
 * Both used to default to `./var`, which is *inside the application folder*.
 * On a host that replaces that folder on every deploy — Hostinger's own git
 * deployment does — the effect is that every deploy generates a fresh
 * encryption key, the stored Gemini key can no longer be decrypted, and the
 * owner finds Emir AI disconnected again. The uploaded photographs go the same
 * way, silently.
 *
 * So the default is now the home directory of the user the app runs as, which
 * a deploy does not touch. `EMIR_STATE_DIR` overrides it; so do `KEY_FILE` and
 * `UPLOAD_DIR` individually, and a deployment that already points them at a
 * shared directory keeps working exactly as it did.
 */
import { accessSync, constants, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const FOLDER = '.emir-crm';

/*
 * Where the old defaults put things, relative to wherever the app is run.
 *
 * Resolved when asked, not when this module loads: a path captured at import
 * time is a path resolved against whatever the working directory happened to
 * be then, which is not necessarily the one the caller means. A test moved a
 * real key file out of the repository proving exactly that.
 */
const legacyKeyFile = () => path.resolve('./var/emir-crm.key');
const legacyUploadDir = () => path.resolve('./var/uploads');

let cached: string | null = null;

/**
 * The directory for state that survives a deploy.
 *
 * Falls back to `./var` when there is no usable home directory — a container
 * running as a user without one, say. That is the old behaviour, which is
 * worse but is not a crash, and the startup log says which one is in use.
 */
export function stateDir(): string {
  if (cached) return cached;

  const configured = process.env.EMIR_STATE_DIR?.trim();
  if (configured) {
    cached = path.resolve(configured);
    return cached;
  }

  const home = homedir();
  if (home && home !== '/' && isWritable(home)) {
    cached = path.join(home, FOLDER);
    return cached;
  }

  cached = path.resolve('./var');
  return cached;
}

export function defaultKeyFile(): string {
  return path.join(stateDir(), 'emir-crm.key');
}

export function defaultUploadDir(): string {
  return path.join(stateDir(), 'uploads');
}

function isWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export type StateMove = { what: string; from: string; to: string };

/**
 * Move anything still sitting in the old `./var` to where it will survive.
 *
 * Only ever moves *into* an empty or absent destination: if both exist the new
 * one wins and the old is left alone, because guessing which copy is current
 * is how data gets lost. Within one filesystem this is a rename and costs
 * nothing; across filesystems it fails, which is reported rather than swallowed.
 */
export function migrateState(
  keyFile: string,
  uploadDir: string,
): { moved: StateMove[]; failed: { what: string; reason: string }[] } {
  const moved: StateMove[] = [];
  const failed: { what: string; reason: string }[] = [];

  const jobs: { what: string; from: string; to: string }[] = [
    { what: 'the encryption key', from: legacyKeyFile(), to: path.resolve(keyFile) },
    { what: 'uploaded files', from: legacyUploadDir(), to: path.resolve(uploadDir) },
  ];

  for (const job of jobs) {
    if (job.from === job.to) continue;            // already where it belongs
    if (!existsSync(job.from)) continue;          // nothing to move
    if (existsSync(job.to) && !isEmptyDir(job.to)) continue;   // the new one is in use

    try {
      mkdirSync(path.dirname(job.to), { recursive: true });
      if (existsSync(job.to)) {
        // An empty directory in the way: rename cannot replace it on every
        // platform, so move the contents instead.
        for (const entry of readdirSync(job.from)) {
          renameSync(path.join(job.from, entry), path.join(job.to, entry));
        }
      } else {
        renameSync(job.from, job.to);
      }
      moved.push(job);
    } catch (err) {
      failed.push({ what: job.what, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { moved, failed };
}

function isEmptyDir(target: string): boolean {
  try {
    return readdirSync(target).length === 0;
  } catch {
    return false;   // a file, not a directory: treat it as in use
  }
}

/** Test helper. */
export function resetStateDirCache(): void {
  cached = null;
}
