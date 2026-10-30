/**
 * Production entrypoint: `npm start`.
 *
 * Managed hosting varies in what it runs for you. Some platforms run a build
 * step; some only run `npm install` and then `npm start`. Rather than depend on
 * which, this checks whether the build is there and makes it if it is not, then
 * applies any pending migrations, then starts the server.
 *
 * Every step is safe to repeat: the build is skipped when it is current, and
 * migrations are forward-only and recorded in `schema_migrations`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = join(root, 'server', 'dist', 'index.js');
const webIndex = join(root, 'web', 'dist', 'index.html');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!existsSync(serverEntry) || !existsSync(webIndex)) {
  console.log('[start] no build found — building');
  const status = run(npm, ['run', 'build']);
  if (status !== 0) {
    console.error(
      '[start] the build failed. On managed hosting this is usually because dev ' +
        'dependencies were skipped: TypeScript and Vite are needed to build, even ' +
        'though they are not needed to run. Install without --production, or set a ' +
        'build command of "npm ci && npm run build".',
    );
    process.exit(status);
  }
}

/*
 * A dump before the schema is touched. It runs here because this is the only
 * place with a route to the database — it listens on localhost, so no machine
 * but this one can take it.
 *
 * A failed backup does not stop the server. Seven agents losing the CRM
 * because a dump tool is missing is a worse outcome than a start without a
 * fresh dump, and migrations are additive-only by policy — enforced by
 * `migrations.safety.test.ts`, which fails the build on destructive DDL. The
 * warning is loud so it is noticed and fixed.
 */
const { backup } = await import(pathToFileURL(join(root, 'scripts', 'backup-db.mjs')).href);
const dump = await backup().catch((err) => ({ ok: false, reason: err?.message ?? String(err) }));
if (dump.ok) {
  console.log(`[start] backup ${dump.file} (${(dump.bytes / 1024 / 1024).toFixed(1)} MB)`);
} else {
  console.warn(`[start] ⚠ NO BACKUP TAKEN — ${dump.reason}`);
  console.warn('[start] ⚠ see SETUP_NEEDED.md, "Make sure backups are running".');
}

// Schema first: a server must never serve against a database it has not migrated.
console.log('[start] applying migrations');
const migrated = run(process.execPath, [join('dist', 'db', 'migrate.js')], { cwd: join(root, 'server') });
if (migrated !== 0) {
  console.error('[start] migrations failed — refusing to start against an unmigrated database.');
  process.exit(migrated);
}

/*
 * The pipeline, stages, workflows and tags are what the product is made of, not
 * the owner's data, and nothing works without them: an import into a database
 * that has no pipeline fails every single row. Seeded on every start rather
 * than from a command someone has to remember, which is safe because each step
 * is idempotent.
 */
console.log('[start] checking the reference data');
const seeded = run(process.execPath, [join('dist', 'db', 'reference.js')], { cwd: join(root, 'server') });
if (seeded !== 0) {
  console.error('[start] could not seed the reference data — refusing to start without a pipeline.');
  process.exit(seeded);
}

console.log('[start] starting the server');
/*
 * Imported rather than spawned, so the server IS this process.
 *
 * A spawned child would leave a wrapper in front of it, and a platform that
 * sends SIGTERM to the process it started would stop the wrapper while the
 * server kept running — which on managed hosting means a restart that never
 * restarts. The server resolves its own paths from `import.meta.url`, so it
 * does not care that the working directory is the repository root.
 */
await import(pathToFileURL(serverEntry).href);
