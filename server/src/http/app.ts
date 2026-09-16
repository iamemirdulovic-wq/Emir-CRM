import express, { type Express, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from '../config/env.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';

/**
 * Webhook routes need the exact bytes that were signed, so we stash the raw
 * body while JSON parsing.
 */
const rawBodySaver = (req: Request, _res: Response, buf: Buffer): void => {
  if (buf?.length) req.rawBody = Buffer.from(buf);
};

export function createApp(): Express {
  const app = express();
  const cfg = env();

  if (cfg.TRUST_PROXY) app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false, // the SPA sets its own policy at the edge
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(express.json({ limit: '2mb', verify: rawBodySaver }));
  app.use(express.urlencoded({ extended: true, limit: '1mb', verify: rawBodySaver }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    req.requestId = newId();
    res.setHeader('x-request-id', req.requestId);
    const startedAt = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
      logger[level]('request', {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
      });
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'emir-crm', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
