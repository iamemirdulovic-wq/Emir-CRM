import type { Response } from 'express';
import { logger, errorContext } from './logger.js';

/**
 * Do the work after the caller has been answered.
 *
 * Every intake endpoint owes its caller a fast 200: Meta retries a webhook it
 * thinks failed, and a buyer staring at a form does not wait while a WhatsApp
 * template renders. The processing is not less important for happening after
 * — it is simply not the caller's business.
 *
 * Nothing here can reject: a failure in the work must never become an
 * unhandled rejection that takes the process down a second after the response
 * went out.
 */
export function processAfterResponse(res: Response, work: () => Promise<void>): void {
  const run = () => {
    work().catch((err) => logger.error('work after the response failed', errorContext(err)));
  };
  if (res.writableEnded) setImmediate(run);
  else res.on('finish', run);
}
