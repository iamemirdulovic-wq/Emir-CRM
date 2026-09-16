import type { SessionUser } from '../auth/sessions.js';

declare global {
  namespace Express {
    interface Request {
      /** Populated by requireAuth. */
      user?: SessionUser;
      sessionToken?: string;
      /** Raw request body, kept for webhook signature verification. */
      rawBody?: Buffer;
      requestId?: string;
    }
  }
}

export {};
