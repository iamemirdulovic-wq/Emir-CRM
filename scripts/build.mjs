/**
 * Production build: `npm run build`.
 *
 * Why this is a script and not two chained npm commands.
 *
 * TypeScript and Vite are devDependencies — they build the app but are not
 * needed to run it. That is correct, and it breaks on managed hosting, because
 * npm omits devDependencies whenever NODE_ENV=production is set. The platform
 * then installs, sets NODE_ENV for the build too, and the build dies on
 * `tsc: command not found` — with everything configured exactly right.
 *
 * So: if the tools are missing, fetch them, then build. The check makes this a
 * no-op everywhere the dependencies are already installed, which is CI and any
 * ordinary checkout.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${root}/package.json`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args, env = {}) {
  const result = spawnSync(npm, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** Can the build tools actually be resolved from here? */
function toolsInstalled() {
  for (const tool of ['typescript', 'vite']) {
    try {
      require.resolve(`${tool}/package.json`);
    } catch {
      return false;
    }
  }
  return true;
}

if (!toolsInstalled()) {
  console.log('[build] TypeScript or Vite is missing — installing the build tools');
  // --include=dev overrides the NODE_ENV=production that caused the omission.
  // --no-save because this adds nothing to package.json; it restores what the
  // lockfile already describes.
  const status = run(['install', '--include=dev', '--no-save', '--no-audit', '--no-fund'], {
    NODE_ENV: 'development',
  });
  if (status !== 0) {
    console.error('[build] could not install the build tools.');
    process.exit(status);
  }
}

for (const workspace of ['server', 'web']) {
  console.log(`[build] building ${workspace}`);
  const status = run(['run', 'build', `--workspace=${workspace}`]);
  if (status !== 0) process.exit(status);
}

console.log('[build] done');
