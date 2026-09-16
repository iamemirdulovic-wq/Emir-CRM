import { describe, expect, it, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit, resetRateLimits } from './rate-limit.js';
import { AppError } from '../../lib/errors.js';

const request = (ip = '1.2.3.4', path = '/webhooks/website'): Request =>
  ({
    baseUrl: '',
    path,
    method: 'POST',
    ip,
    socket: { remoteAddress: ip },
    get: () => undefined,
  }) as unknown as Request;

const run = (middleware: ReturnType<typeof rateLimit>, req: Request): AppError | null => {
  let captured: AppError | null = null;
  const next: NextFunction = (err?: unknown) => {
    if (err instanceof AppError) captured = err;
  };
  middleware(req, {} as Response, next);
  return captured;
};

describe('rateLimit', () => {
  beforeEach(() => resetRateLimits());

  it('allows requests up to the limit', () => {
    const limiter = rateLimit({ max: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i += 1) {
      expect(run(limiter, request()), `request ${i + 1}`).toBeNull();
    }
  });

  it('rejects the request past the limit with 429', () => {
    const limiter = rateLimit({ max: 2, windowMs: 60_000 });
    run(limiter, request());
    run(limiter, request());
    const error = run(limiter, request());
    expect(error).not.toBeNull();
    expect(error?.status).toBe(429);
  });

  it('counts each client separately', () => {
    const limiter = rateLimit({ max: 1, windowMs: 60_000 });
    expect(run(limiter, request('1.1.1.1'))).toBeNull();
    expect(run(limiter, request('2.2.2.2'))).toBeNull();
    expect(run(limiter, request('1.1.1.1'))).not.toBeNull();
  });

  it('counts each path separately', () => {
    const limiter = rateLimit({ max: 1, windowMs: 60_000 });
    expect(run(limiter, request('1.1.1.1', '/webhooks/website'))).toBeNull();
    expect(run(limiter, request('1.1.1.1', '/webhooks/google'))).toBeNull();
  });

  it('lets the window expire', async () => {
    const limiter = rateLimit({ max: 1, windowMs: 30 });
    expect(run(limiter, request())).toBeNull();
    expect(run(limiter, request())).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(run(limiter, request())).toBeNull();
  });

  it('supports a custom key, so one tenant cannot starve another', () => {
    const limiter = rateLimit({ max: 1, windowMs: 60_000, keyFor: () => 'shared' });
    expect(run(limiter, request('1.1.1.1'))).toBeNull();
    expect(run(limiter, request('9.9.9.9'))).not.toBeNull();
  });
});
