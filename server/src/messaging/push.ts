import { createSign } from 'node:crypto';
import { env } from '../config/env.js';
import { query, execute } from '../db/client.js';
import { logger, errorContext } from '../lib/logger.js';

/**
 * Firebase Cloud Messaging via the HTTP v1 API.
 *
 * We mint the OAuth token from the service account directly rather than pulling
 * in the Firebase Admin SDK, which is a large dependency for one endpoint.
 */

type TokenCache = { token: string; expiresAt: number };
let cachedToken: TokenCache | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

async function accessToken(): Promise<string | null> {
  const cfg = env();
  if (!cfg.FCM_CLIENT_EMAIL || !cfg.FCM_PRIVATE_KEY || !cfg.FCM_PROJECT_ID) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: cfg.FCM_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  // Service-account keys are stored with literal \n in the environment.
  const privateKey = cfg.FCM_PRIVATE_KEY.replace(/\\n/g, '\n');
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(privateKey, 'base64url');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!response.ok) {
    logger.error('failed to mint an FCM access token', { status: response.status });
    return null;
  }
  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;

  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

export type PushMessage = {
  title: string;
  body: string;
  /** Deep link into the CRM, e.g. /contacts/{id}. */
  link?: string;
  /** Click-to-call link, so the agent can dial from the notification. */
  tel?: string;
  data?: Record<string, string>;
  priority?: 'normal' | 'high';
};

/** Send to every device registered to a user. Returns how many were accepted. */
export async function pushToUser(userId: string, message: PushMessage): Promise<number> {
  const tokens = await query<{ id: string; token: string }>('SELECT id, token FROM push_tokens WHERE user_id = ?', [userId]);
  if (tokens.length === 0) {
    logger.debug('no push tokens registered for user', { userId });
    return 0;
  }

  const cfg = env();
  const oauth = await accessToken();
  if (!oauth) {
    // Push is a convenience; a lead is never lost because it did not fire.
    logger.warn('FCM is not configured; skipping push', { userId, title: message.title });
    return 0;
  }

  let delivered = 0;
  for (const row of tokens) {
    try {
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${cfg.FCM_PROJECT_ID}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${oauth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: row.token,
            notification: { title: message.title, body: message.body },
            data: {
              ...(message.link ? { link: message.link } : {}),
              ...(message.tel ? { tel: message.tel } : {}),
              ...(message.data ?? {}),
            },
            android: { priority: message.priority === 'high' ? 'HIGH' : 'NORMAL' },
            webpush: message.link ? { fcm_options: { link: `${cfg.APP_URL}${message.link}` } } : undefined,
          },
        }),
      });

      if (response.ok) {
        delivered += 1;
        await execute('UPDATE push_tokens SET last_used_at = NOW(3) WHERE id = ?', [row.id]);
        continue;
      }
      const json = (await response.json()) as { error?: { status?: string } };
      // A device that has uninstalled the app should not be retried forever.
      if (json.error?.status === 'NOT_FOUND' || json.error?.status === 'INVALID_ARGUMENT') {
        await execute('DELETE FROM push_tokens WHERE id = ?', [row.id]);
        logger.info('removed a dead push token', { userId });
      } else {
        logger.warn('push delivery failed', { userId, status: json.error?.status ?? response.status });
      }
    } catch (err) {
      logger.warn('push delivery threw', { userId, ...errorContext(err) });
    }
  }
  return delivered;
}

/** Alert every manager and admin — used for SLA breaches and the unassigned queue. */
export async function pushToManagers(message: PushMessage): Promise<number> {
  const managers = await query<{ id: string }>(
    `SELECT id FROM users WHERE is_active = 1 AND role IN ('manager','admin','owner')`,
  );
  let total = 0;
  for (const manager of managers) total += await pushToUser(manager.id, message);
  return total;
}
