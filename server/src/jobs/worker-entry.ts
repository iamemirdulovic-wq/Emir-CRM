import { startWorker } from './worker.js';
import { closePool } from '../db/client.js';
import { logger, errorContext } from '../lib/logger.js';
import { env } from '../config/env.js';

/** Standalone worker process: `npm run worker`. */
const cfg = env();
if (!cfg.WORKER_ENABLED) {
  logger.warn('WORKER_ENABLED is false; exiting');
  process.exit(0);
}

const worker = startWorker();

const shutdown = (signal: string) => {
  logger.info('worker shutting down', { signal });
  worker
    .stop()
    .then(() => closePool())
    .catch((err) => logger.error('worker shutdown failed', errorContext(err)))
    .finally(() => process.exit(0));
  setTimeout(() => process.exit(1), 15_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
