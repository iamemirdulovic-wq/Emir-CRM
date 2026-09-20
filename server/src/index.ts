import { createApp } from './http/app.js';
import { env } from './config/env.js';
import { logger, errorContext } from './lib/logger.js';
import { closePool } from './db/client.js';
import { startWorker, type WorkerHandle } from './jobs/worker.js';
import { migrateState, stateDir } from './config/state.js';

async function main(): Promise<void> {
  const cfg = env();

  /*
   * Rescue anything still under the old `./var`, which sits inside the
   * application folder and is therefore deleted by any host that replaces that
   * folder on deploy. Doing it here, before anything reads a key or a file,
   * means an existing install keeps its encryption key — and with it the
   * stored API keys — across the upgrade that introduced this.
   */
  const { moved, failed } = migrateState(cfg.KEY_FILE, cfg.UPLOAD_DIR);
  for (const move of moved) logger.warn('moved state somewhere a deploy will not delete it', move);
  for (const problem of failed) {
    logger.error('could not move state out of the application folder', {
      ...problem,
      note: 'Move it by hand, or set EMIR_STATE_DIR to a directory outside the app.',
    });
  }
  logger.info('state directory', {
    dir: stateDir(),
    keyFile: cfg.KEY_FILE,
    uploads: cfg.UPLOAD_DIR,
    note: 'These must survive a deploy. If they are inside the app folder, every deploy loses them.',
  });

  const app = createApp();
  const server = app.listen(cfg.PORT, cfg.HOST, () => {
    logger.info('emir-crm api listening', { host: cfg.HOST, port: cfg.PORT, env: cfg.NODE_ENV });
  });

  /*
   * On hosting that runs one process per application there is nowhere to put a
   * second one, so the worker rides along here. `npm run worker` is still the
   * better shape where two processes are possible; both may run at once
   * without fighting, because claimJobs takes its rows FOR UPDATE SKIP LOCKED.
   */
  let worker: WorkerHandle | null = null;
  if (cfg.WORKER_IN_PROCESS && cfg.WORKER_ENABLED) {
    worker = startWorker();
    logger.info('background worker is running inside the api process');
  }

  const shutdown = (signal: string) => {
    logger.info('shutting down', { signal });
    server.close(() => {
      // Let the worker finish the job in its hand before the pool goes away,
      // or it will be retried on the next boot for no reason.
      (worker ? worker.stop() : Promise.resolve())
        .then(() => closePool())
        .catch((err) => logger.error('shutdown failed', errorContext(err)))
        .finally(() => process.exit(0));
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 15_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('failed to start', errorContext(err));
  process.exit(1);
});
