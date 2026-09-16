import { hostname } from 'node:os';
import { env } from '../config/env.js';
import { logger, errorContext } from '../lib/logger.js';
import { newToken } from '../lib/ids.js';
import { claimJobs, completeJob, failJob } from './queue.js';
import { HANDLERS } from './handlers.js';
import { runDueCrons } from './cron.js';

/**
 * The worker: poll the `jobs` table, run what is due, retry with backoff.
 *
 * Several workers can run at once — `FOR UPDATE SKIP LOCKED` in claimJobs means
 * they never fight over the same job.
 */

export type WorkerHandle = { stop: () => Promise<void> };

export function startWorker(): WorkerHandle {
  const cfg = env();
  const workerId = cfg.WORKER_ID ?? `${hostname()}-${newToken(4)}`;
  let running = true;
  let idle: Promise<void> = Promise.resolve();

  logger.info('worker started', { workerId, pollMs: cfg.WORKER_POLL_MS, batchSize: cfg.WORKER_BATCH_SIZE });

  const loop = async (): Promise<void> => {
    while (running) {
      let processed = 0;
      try {
        await runDueCrons();
        const jobs = await claimJobs(workerId, cfg.WORKER_BATCH_SIZE);
        processed = jobs.length;

        for (const job of jobs) {
          if (!running) break;
          const startedAt = Date.now();
          try {
            const handler = HANDLERS[job.type];
            if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);

            const result = await handler(job.payload);
            await completeJob(job.id, result);
            logger.debug('job done', { type: job.type, jobId: job.id, durationMs: Date.now() - startedAt });
          } catch (err) {
            logger.warn('job failed', {
              type: job.type,
              jobId: job.id,
              attempt: job.attempts,
              maxAttempts: job.maxAttempts,
              ...errorContext(err),
            });
            await failJob(job.id, err);
          }
        }
      } catch (err) {
        // A database blip must not kill the worker.
        logger.error('worker loop error', errorContext(err));
      }

      // Only sleep when there was nothing to do, so a backlog drains fast.
      if (running && processed === 0) {
        await new Promise((resolve) => setTimeout(resolve, cfg.WORKER_POLL_MS));
      }
    }
  };

  idle = loop();

  return {
    stop: async () => {
      running = false;
      await idle;
      logger.info('worker stopped', { workerId });
    },
  };
}
