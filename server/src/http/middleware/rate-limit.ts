import type { NextFunction, Request, Response } from 'express';
import { tooManyRequests } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { clientIp } from './auth.js';

/**
 * In-memory fixed-window rate limiting.
 *
 * Deliberately not backed by the database: the point is to shed load cheaply
 * before it reaches MySQL. With several API processes each keeps its own
 * counters, so the effective limit is per process — which is fine, because this
 * is a blunt safety net against a runaway loop or a scraper, not a billing
 * control. The real idempotency guarantees live in the unique keys.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Stop the map growing without bound on a long-lived process. */
function sweep(now: number): void {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitOptions = {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
  /** Defaults to the client IP. */
  keyFor?: (req: Request) => string;
  message?: string;
};

export function rateLimit(options: RateLimitOptions) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();
    sweep(now);

    const key = `${options.keyFor ? options.keyFor(req) : (clientIp(req) ?? 'unknown')}:${req.baseUrl}${req.path}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      logger.warn('rate limit exceeded', { path: req.path, method: req.method });
      next(tooManyRequests(options.message ?? 'Too many requests. Please slow down.'));
      return;
    }
    next();
  };
}

/** Test helper. */
export function resetRateLimits(): void {
  buckets.clear();
}
