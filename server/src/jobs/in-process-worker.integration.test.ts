import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, describeWithDb, prepareTestDatabase, query, resetTables,
} from '../testing/db.js';
import { loadEnv, setEnvForTesting } from '../config/env.js';
import { enqueue } from './queue.js';
import { startWorker, type WorkerHandle } from './worker.js';

/**
 * Managed Node hosting runs one process per application, so on Hostinger Cloud
 * the worker has to live inside the API. This proves the loop actually drains
 * the queue when started that way — the failure it guards against is silent:
 * the site would work, and no follow-up would ever be sent.
 */
let worker: WorkerHandle | null = null;

async function waitForJob(jobId: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await query<{ status: string }>('SELECT status FROM jobs WHERE id = ?', [jobId]);
    const status = rows[0]?.status;
    if (status && status !== 'pending' && status !== 'running') return status;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return 'timed-out';
}

describeWithDb('the worker running inside the api process', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    setEnvForTesting({ ...loadEnv(process.env), WORKER_IN_PROCESS: true, WORKER_POLL_MS: 200, WORKER_ID: 'embedded-test' });
  });

  afterAll(async () => {
    if (worker) await worker.stop();
    setEnvForTesting(null);
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetTables();
  });

  it('drains a job that was queued after it started', async () => {
    worker = startWorker();
    const { id, enqueued } = await enqueue('maintenance.cleanup', {}, { dedupeKey: 'embedded-1' });
    expect(enqueued).toBe(true);
    expect(await waitForJob(id as string)).toBe('done');
  });

  it('stops cleanly, so a restart does not leave a job half-run', async () => {
    const handle = startWorker();
    await expect(handle.stop()).resolves.toBeUndefined();
  });
});
