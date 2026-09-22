import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from '../config/env.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { rateLimit } from './middleware/rate-limit.js';
import { cspForIndex } from './csp.js';
import { authRouter } from './routes/auth.js';
import { setupRouter } from './routes/setup.js';
import { webhookRouter } from './routes/webhooks.js';
import { contactsRouter } from './routes/contacts.js';
import { pipelineRouter } from './routes/pipeline.js';
import { inboxRouter } from './routes/inbox.js';
import { usersRouter } from './routes/users.js';
import { projectsRouter } from './routes/projects.js';
import { libraryRouter } from './routes/library.js';
import { aiRouter } from './routes/ai.js';
import { templatesRouter } from './routes/templates.js';
import { reportsRouter } from './routes/reports.js';
import { tasksRouter } from './routes/tasks.js';
import { automationsRouter } from './routes/automations.js';
import { importsRouter } from './routes/imports.js';
import { listsRouter } from './routes/lists.js';
import { campaignsRouter } from './routes/campaigns.js';
import { teamsRouter } from './routes/teams.js';
import { brochureRouter } from './routes/brochure.js';
import { offersRouter } from './routes/offers.js';
import { startHeartbeat } from '../realtime/hub.js';

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

  /*
   * The app shell is served from this process, so the security headers have to
   * come from here too — there is no CDN or edge in front of it on Hostinger.
   */
  const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'web', 'dist');
  const indexPath = join(webDist, 'index.html');
  const csp = cspForIndex(existsSync(indexPath) ? indexPath : null);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      /*
       * Six months, so a stray plain-http link cannot downgrade a session.
       *
       * Gated on the environment, never on COOKIE_SECURE: helmet sends HSTS by
       * default, so keying it to a flag that is off by default would *remove*
       * the header from exactly the deployment that needs it most — an HTTPS
       * site whose session cookie is not marked Secure. Off in development,
       * where a pin on localhost outlives the reason for it.
       */
      hsts: cfg.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    next();
  });

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

  /*
   * Also the keep-alive target. Managed hosting idles an application that sees
   * no traffic, and an idled application is one whose follow-ups never fire, so
   * a scheduled ping here is part of the deployment rather than a nicety. It
   * reports where the worker is running so that ping can tell.
   */
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'emir-crm',
      time: new Date().toISOString(),
      worker: cfg.WORKER_ENABLED ? (cfg.WORKER_IN_PROCESS ? 'in-process' : 'separate') : 'off',
    });
  });

  /*
   * Rate limits on the unauthenticated surface. Login also has a per-account
   * lockout and a per-IP failure budget in the database; this is the cheap
   * outer layer that sheds a flood before it reaches MySQL.
   */
  app.use('/api/auth/login', rateLimit({ max: 20, windowMs: 5 * 60 * 1000, message: 'Too many sign-in attempts. Please wait a few minutes.' }));
  // Meta bursts hard on retry; generous, but bounded.
  app.use('/webhooks', rateLimit({ max: 600, windowMs: 60 * 1000 }));
  app.use('/b', rateLimit({ max: 120, windowMs: 60 * 1000 }));

  // Unauthenticated by necessity, and only while the users table is empty.
  app.use('/api/setup', setupRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/pipeline', pipelineRouter);
  app.use('/api/inbox', inboxRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/projects', projectsRouter);
  /*
   * The library sits on its own path rather than under /api/projects: that
   * router is what the live WhatsApp replies read, and keeping the editing
   * surface separate means a change here cannot take the auto-replies down.
   */
  app.use('/api/library', libraryRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/automations', automationsRouter);
  app.use('/api/imports', importsRouter);
  app.use('/api/lists', listsRouter);
  app.use('/api/campaigns', campaignsRouter);
  app.use('/api/teams', teamsRouter);
  app.use('/api/offers', offersRouter);
  app.use('/webhooks', webhookRouter);
  // Public: leads open this straight from WhatsApp.
  app.use('/b', brochureRouter);

  // Keeps SSE connections alive through proxies that time out idle streams.
  startHeartbeat();

  /*
   * Serve the built SPA from the same origin as the API. That is what lets the
   * session cookie be httpOnly and SameSite=Lax without any CORS surface.
   * In development Vite proxies to this server instead.
   */
  if (existsSync(webDist)) {
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders: (res, path) => {
          // Hashed asset filenames can be cached hard; index.html cannot.
          if (path.includes(`${'/assets/'}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );

    // Client-side routing: anything that is not an API or webhook path renders
    // the app shell.
    app.get(/^(?!\/(api|webhooks|b|health)\b).*/, (_req, res, next) => {
      if (!existsSync(indexPath)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexPath);
    });
    logger.info('serving the web app', { from: webDist });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
