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
import { fileURLToPath } from 'node:url';

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

// Schema first: a server must never serve against a database it has not migrated.
console.log('[start] applying migrations');
const migrated = run(process.execPath, [join('dist', 'db', 'migrate.js')], { cwd: join(root, 'server') });
if (migrated !== 0) {
  console.error('[start] migrations failed — refusing to start against an unmigrated database.');
  process.exit(migrated);
}

console.log('[start] starting the server');
// Replace this process rather than nest one, so the platform's signals and
// restarts reach the server directly.
const status = run(process.execPath, [serverEntry], { cwd: join(root, 'server') });
process.exit(status);
