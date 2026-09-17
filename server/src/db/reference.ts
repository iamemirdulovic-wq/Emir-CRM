/**
 * Bring the CRM's own configuration up to date, then exit.
 *
 * Run on every start, before the server listens. It deliberately does not touch
 * accounts: the first one is created in the browser, and `npm run seed` is for
 * a command-line install that wants an owner too.
 */
import { seedReferenceData } from './seed.js';
import { closePool } from './client.js';
import { logger, errorContext } from '../lib/logger.js';
import { isEntrypoint } from '../lib/entrypoint.js';

if (isEntrypoint(import.meta.url)) {
  seedReferenceData()
    .then(async () => {
      logger.info('reference data is up to date');
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error('could not seed the reference data', errorContext(err));
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
