import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../lib/errors.js';
import { logger, errorContext } from '../../lib/logger.js';

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
};

export const errorHandler: ErrorRequestHandler = (err, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_failed',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) logger.error('request failed', { path: req.path, ...errorContext(err) });
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }

  logger.error('unhandled error', { path: req.path, method: req.method, ...errorContext(err) });

  /*
   * The owner can see what actually broke; nobody else can.
   *
   * This exists because the calendar returned "Internal server error" for
   * every person on the live site for days, and the real reason was written
   * only to a server log that neither the owner nor I can read. Two fixes
   * were shipped on reasoning alone and both were wrong. A message a person
   * can read off their own screen and quote back is worth more than another
   * round of guessing.
   *
   * Owner and admin only, so an agent — or anyone who gets hold of an agent's
   * session — still sees nothing. The message alone, never the stack and
   * never the SQL parameters, because those carry client phone numbers.
   */
  const detail = req.user?.role === 'owner' || req.user?.role === 'admin'
    ? (err instanceof Error ? err.message : String(err)).slice(0, 300)
    : null;
  res.status(500).json({
    error: {
      code: 'server_error',
      message: detail ? `Internal server error — ${detail}` : 'Internal server error',
    },
  });
};

/** Wrap an async handler so rejected promises reach the error handler. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
