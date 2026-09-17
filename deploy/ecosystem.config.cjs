/**
 * PM2 process list for the live server: the API and the background worker.
 *
 * Both read their configuration from `shared/.env`, which lives on the server
 * and is never in git. PM2 has no notion of an env file, and the app
 * deliberately reads `process.env` only, so the file is parsed here and handed
 * over — one place, both processes, no dotenv dependency in the app.
 *
 * Paths are resolved from this file, which the deploy symlinks in as
 * `<deploy path>/current/deploy/ecosystem.config.cjs`.
 */
const { readFileSync } = require('node:fs');
const { resolve, join } = require('node:path');

const release = resolve(__dirname, '..');
const shared = resolve(release, '..', '..', 'shared');

/**
 * A deliberately small .env parser: `KEY=value`, `#` comments, optional
 * surrounding quotes. Anything fancier belongs in a config file, not here.
 */
function readEnvFile(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `No environment file at ${path}. Copy .env.example there and fill it in — ` +
          'the deploy never writes it, so your database password stays on this server.',
      );
    }
    throw err;
  }

  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const fileEnv = readEnvFile(join(shared, '.env'));

const env = {
  ...fileEnv,
  NODE_ENV: fileEnv.NODE_ENV ?? 'production',
  // Uploads must outlive a release, so they live in shared/ and the app is
  // pointed at them rather than at a directory inside the release it would
  // lose on the next deploy.
  UPLOAD_DIR: join(shared, 'var', 'uploads'),
};

module.exports = {
  apps: [
    {
      name: 'emir-api',
      // `current` rather than the release path, so a restart after a rollback
      // picks up whichever release the symlink points at now.
      cwd: join(release, 'server'),
      script: 'dist/index.js',
      env,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      // The API answers webhooks; if it dies it must come back, but a crash
      // loop should not hammer MySQL.
      restart_delay: 2000,
      max_restarts: 10,
      error_file: join(shared, 'logs', 'api.error.log'),
      out_file: join(shared, 'logs', 'api.out.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'emir-worker',
      cwd: join(release, 'server'),
      script: 'dist/jobs/worker-entry.js',
      env: {
        ...env,
        // Two processes polling the same jobs table need distinct ids so a
        // reclaim can tell whose lease went stale.
        WORKER_ID: env.WORKER_ID || 'worker-1',
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      restart_delay: 2000,
      max_restarts: 10,
      error_file: join(shared, 'logs', 'worker.error.log'),
      out_file: join(shared, 'logs', 'worker.out.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
