import { createApp } from './http/app.js';
import { env } from './config/env.js';
import { logger, errorContext } from './lib/logger.js';
import { closePool } from './db/client.js';

async function main(): Promise<void> {
  const cfg = env();
  const app = createApp();
  const server = app.listen(cfg.PORT, () => {
    logger.info('emir-crm api listening', { port: cfg.PORT, env: cfg.NODE_ENV });
  });

  const shutdown = (signal: string) => {
    logger.info('shutting down', { signal });
    server.close(() => {
      closePool()
        .catch((err) => logger.error('pool close failed', errorContext(err)))
        .finally(() => process.exit(0));
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('failed to start', errorContext(err));
  process.exit(1);
});
