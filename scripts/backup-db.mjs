/**
 * Dump the database to a timestamped file before anything touches the schema.
 *
 * This runs on the server, from `npm start`, immediately before migrations.
 * That is the only place it can run: the database listens on localhost, so
 * nothing outside the box — including the machine this code was written on —
 * can reach it. A backup taken anywhere else would be a backup of nothing.
 *
 * It writes outside the repository so a dump can never be committed, keeps the
 * last `BACKUP_KEEP` files, and prints the path it wrote for `PROGRESS.md`.
 *
 * Run it by hand any time:  node scripts/backup-db.mjs
 */
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* Default is a sibling of the checkout: a deploy replaces the checkout, and a
   backup that a deploy can delete is not a backup. */
const dir = process.env.BACKUP_DIR ?? resolve(root, '..', 'crm-backups');
const keep = Number(process.env.BACKUP_KEEP ?? 14);

function stamp() {
  /* Dubai time, because that is the clock the person reading the filename is
     on. An hour's confusion matters when you are picking which dump to restore. */
  const now = new Date(Date.now() + 4 * 60 * 60 * 1000);
  return now.toISOString().replace('T', '-').replace(/:/g, '').slice(0, 15);
}

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export async function backup() {
  const database = env('DB_NAME');
  if (!database) return { ok: false, reason: 'DB_NAME is not set — nothing to dump.' };

  mkdirSync(dir, { recursive: true });
  const file = join(dir, `crm-${stamp()}.sql.gz`);

  const args = [
    `--host=${env('DB_HOST', '127.0.0.1')}`,
    `--port=${env('DB_PORT', '3306')}`,
    `--user=${env('DB_USER', 'root')}`,
    '--single-transaction', // a consistent snapshot without locking agents out
    '--quick',
    '--routines',
    '--triggers',
    '--default-character-set=utf8mb4',
    database,
  ];

  /*
   * The password goes in the child's environment, never in argv: anyone with
   * shell access can read another process's command line.
   */
  const child = spawnSync('mysqldump', args, {
    env: { ...process.env, MYSQL_PWD: env('DB_PASSWORD', '') },
    maxBuffer: 1024 * 1024 * 1024,
  });

  if (child.error || child.status !== 0) {
    const detail = child.error?.message ?? child.stderr?.toString().trim().split('\n').pop() ?? 'unknown error';
    return { ok: false, reason: `mysqldump failed: ${detail}` };
  }

  await new Promise((done, fail) => {
    const out = createWriteStream(file);
    const gzip = createGzip();
    gzip.pipe(out);
    out.on('error', fail);
    gzip.on('error', fail);
    out.on('close', done);
    gzip.end(child.stdout);
  });

  prune();
  return { ok: true, file, bytes: statSync(file).size };
}

/** Keep the newest `keep` dumps. Disk on a shared plan is not free. */
function prune() {
  if (!existsSync(dir) || keep <= 0) return;
  const dumps = readdirSync(dir)
    .filter((name) => name.startsWith('crm-') && name.endsWith('.sql.gz'))
    .sort()
    .reverse();
  for (const name of dumps.slice(keep)) {
    try {
      unlinkSync(join(dir, name));
    } catch {
      /* Another deploy may have taken it already; that is the outcome we wanted. */
    }
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const result = await backup();
  if (result.ok) {
    console.log(`[backup] wrote ${result.file} (${(result.bytes / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    console.error(`[backup] NO BACKUP TAKEN — ${result.reason}`);
    process.exit(1);
  }
}
