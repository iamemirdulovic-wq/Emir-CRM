import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The documentation names the same variables the server actually reads.
 *
 * This exists because of what a wrong name costs. The owner is not a
 * programmer: he pastes what the handover file tells him to paste, presses
 * Restart, and reads the screen. A name that is nearly right — `EMAIL_API_KEY`
 * where the code says `BREVO_API_KEY` — produces no error anywhere. The CRM
 * starts, says email is not connected, and he has no way to tell that the
 * instruction was wrong rather than his typing.
 *
 * Step 17 found four of them, all written before the feature they described
 * was finished. A comment asking the next person to keep the docs in step is
 * not a check; this is.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');

const SCHEMA = readFileSync(path.join(HERE, 'env.ts'), 'utf8');

/** Every key of the Zod object, which is every variable the server reads. */
const DECLARED = new Set(
  [...SCHEMA.matchAll(/^ {2}([A-Z][A-Z0-9_]*):\s/gm)].map((m) => m[1] as string),
);

/**
 * Names that look like environment variables in prose but are not ours: DNS
 * record types, an acronym in a sentence. Kept short deliberately — the point
 * of the check is lost if anything awkward can be added to it.
 */
const NOT_OURS = new Set(['DMARC', 'SPF', 'DKIM', 'TXT', 'CNAME', 'JSON', 'HTTP', 'HTTPS']);

/** Secrets of the deployment itself, which live in GitHub, not in `.env`. */
const CI_SECRETS = /^(HOSTINGER_SSH_|DEPLOY_PATH$)/;

/** Read only by scripts and the test harness, so not part of the app schema. */
const TOOLING = new Set([
  'SEED_OWNER_EMAIL', 'SEED_OWNER_PASSWORD',
  'TEST_DB_HOST', 'TEST_DB_USER', 'TEST_DB_PASSWORD',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
]);

function read(relative: string): string {
  return readFileSync(path.join(REPO, relative), 'utf8');
}

describe('env.ts and the documentation agree', () => {
  it('.env.example lists every variable the server reads', () => {
    const example = read('.env.example');
    /* A commented-out line still documents the variable, which is how the
       either/or ones (DATABASE_URL) are written. */
    const present = new Set(
      [...example.matchAll(/^#?\s?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1] as string),
    );
    const missing = [...DECLARED].filter((name) => !present.has(name));
    expect(missing, `missing from .env.example: ${missing.join(', ')}`).toEqual([]);
  });

  it('.env.example invents nothing the server does not read', () => {
    const example = read('.env.example');
    const set = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1] as string);
    const unknown = set.filter((name) => !DECLARED.has(name));
    expect(unknown, `in .env.example but never read: ${unknown.join(', ')}`).toEqual([]);
  });

  it.each(['SETUP_NEEDED.md', 'README.md', 'docs/DEPLOYMENT.md', 'docs/NOTIFICATIONS.md'])(
    '%s names only real variables',
    (file) => {
      /* Backticks, because that is how a variable is written in these files
         and prose should not have to dodge the check. */
      const named = [...read(file).matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((m) => m[1] as string);
      const wrong = [...new Set(named)].filter(
        (name) => !DECLARED.has(name) && !NOT_OURS.has(name) && !TOOLING.has(name)
          && !CI_SECRETS.test(name),
      );
      expect(wrong, `${file} names variables that do not exist: ${wrong.join(', ')}`).toEqual([]);
    },
  );
});
