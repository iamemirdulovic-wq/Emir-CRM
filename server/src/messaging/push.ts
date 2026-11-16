import { createSign } from 'node:crypto';
import { env } from '../config/env.js';
import { refuseOutbound } from '../config/test-copy.js';
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

/**
 * Forget the minted OAuth token. Test helper, like `resetRateLimits`.
 *
 * The token is cached for an hour and keyed on nothing, so a suite that
 * changes `FCM_PRIVATE_KEY` between cases would otherwise keep sending with
 * the token the previous case minted — and every "the key is broken" test
 * would pass as "sent". In production the keys do not change without a
 * restart, which clears this anyway.
 */
export function forgetFcmToken(): void {
  cachedToken = null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * The service-account key, however the hosting panel mangled it.
 *
 * Emir pasted a correct key into Hostinger on 15 Nov and the server logged
 * "FCM_PRIVATE_KEY cannot be used to sign" on every send for a day. The value
 * was right; the line breaks were not. A one-line environment field can hand
 * back the literal two characters `\n`, real newlines, or nothing at all
 * where the newlines were — and OpenSSL rejects the third outright.
 *
 * So the base64 is taken out and the PEM rebuilt, which is the same key
 * whichever way it arrived.
 */
export function pemFromEnv(raw: string): string {
  const withBreaks = raw.replace(/\\n/g, '\n').trim();
  if (withBreaks.includes('\n')) return withBreaks;
  const body = withBreaks
    .replace(/-----(BEGIN|END)[A-Z ]*-----/g, '')
    .replace(/\s+/g, '');
  const header = /BEGIN RSA/.test(withBreaks) ? 'RSA PRIVATE KEY' : 'PRIVATE KEY';
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${header}-----\n${lines.join('\n')}\n-----END ${header}-----\n`;
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
  const privateKey = pemFromEnv(cfg.FCM_PRIVATE_KEY);
  /*
   * A key pasted wrong is the likeliest Firebase mistake there is — it is one
   * long base64 block copied out of a JSON file into a hosting panel — and
   * OpenSSL answers it by throwing, not by returning. Left unhandled that
   * came out of the "Send a test" endpoint as "Internal server error", which
   * tells the owner nothing about the thing he just pasted. Treated as "no
   * token": the caller reports a failure, and the sentence it writes names
   * the Firebase values.
   */
  let signature: string;
  try {
    signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(privateKey, 'base64url');
  } catch (err) {
    logger.error('FCM_PRIVATE_KEY cannot be used to sign', {
      /* The reason, never the key, not even its length. */
      reason: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }

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

/**
 * Whether the server holds the credentials that let it send a push at all.
 *
 * The one definition of it. There used to be three copies of this expression —
 * here, in `health-checks.ts` and in `integration-status.ts` — and three copies
 * of "is the key set" is how a settings screen ends up disagreeing with the
 * health page about whether anything can be delivered.
 *
 * It reads the environment only, because `FCM_PRIVATE_KEY` is an environment
 * variable by design: it is the one value that authorises sending, and it is
 * deliberately not pasteable into a screen.
 */
export function pushConfigured(): boolean {
  const cfg = env();
  return Boolean(cfg.FCM_PROJECT_ID && cfg.FCM_CLIENT_EMAIL && cfg.FCM_PRIVATE_KEY);
}

/**
 * Why a push did or did not arrive.
 *
 * A count of devices is not enough on its own: zero devices reached has four
 * entirely different causes, with four different people who have to do
 * something about it. An owner who is told "it did not work" goes looking in
 * Firebase; an owner who is told "no phone is registered for you yet" taps one
 * card and is done.
 */
export type PushOutcome =
  /** At least one device accepted it. */
  | 'sent'
  /** No Firebase credentials on the server, so nothing can reach any device. */
  | 'no-credentials'
  /** Credentials are set; this person has registered no device. */
  | 'no-device'
  /** A device was registered and Firebase says the token is dead. Removed. */
  | 'token-rejected'
  /** Firebase itself refused or could not be reached. */
  | 'failed'
  /** The test copy of the CRM, which never sends to a real device. */
  | 'test-copy';

export interface PushResult {
  outcome: PushOutcome;
  /** Devices that accepted it. */
  delivered: number;
  /** Devices registered to this person when we tried. */
  registered: number;
  /** Devices dropped because Firebase said the token is no longer valid. */
  removed: number;
}

/** Send to every device registered to a user. Returns how many were accepted. */
export async function pushToUser(userId: string, message: PushMessage): Promise<number> {
  return (await pushToUserDetailed(userId, message)).delivered;
}

/**
 * The same send, with the reason it went nowhere.
 *
 * This is the one push path — `pushToUser` is this function with the reason
 * thrown away. Anything that wants to tell a person what happened (the "Send
 * a test" button on the notification settings panel) calls this; everything that
 * only wants a lead alert on a phone keeps calling `pushToUser`.
 */
export async function pushToUserDetailed(userId: string, message: PushMessage): Promise<PushResult> {
  const none = { delivered: 0, registered: 0, removed: 0 };

  /* A phone registered against the real CRM is the same phone here: the test
     copy must not make it buzz. See config/test-copy.ts. */
  if (refuseOutbound('push', userId)) return { ...none, outcome: 'test-copy' };

  /* Credentials before the database, and before the network. "No key is set"
     is true however many phones are registered, and it is a different job for
     a different person than "nobody has registered a phone" — the same order,
     and the same two states, that `measureNotifications` reports on the
     health page. Reading the environment costs nothing, so checking it first
     also saves a pointless query and a pointless token mint. */
  if (!pushConfigured()) {
    logger.warn('FCM is not configured; skipping push', { userId, title: message.title });
    return { ...none, outcome: 'no-credentials' };
  }

  const tokens = await query<{ id: string; token: string }>('SELECT id, token FROM push_tokens WHERE user_id = ?', [userId]);
  if (tokens.length === 0) {
    logger.debug('no push tokens registered for user', { userId });
    return { ...none, outcome: 'no-device' };
  }

  const cfg = env();
  const oauth = await accessToken();
  if (!oauth) {
    // Push is a convenience; a lead is never lost because it did not fire.
    logger.warn('could not mint an FCM access token; skipping push', { userId, title: message.title });
    return { ...none, registered: tokens.length, outcome: 'failed' };
  }

  let delivered = 0;
  let removed = 0;
  let failed = 0;
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
      const json = (await response.json().catch(() => ({}))) as { error?: { status?: string } };
      // A device that has uninstalled the app should not be retried forever.
      if (json.error?.status === 'NOT_FOUND' || json.error?.status === 'INVALID_ARGUMENT') {
        await execute('DELETE FROM push_tokens WHERE id = ?', [row.id]);
        removed += 1;
        logger.info('removed a dead push token', { userId });
      } else {
        failed += 1;
        logger.warn('push delivery failed', { userId, status: json.error?.status ?? response.status });
      }
    } catch (err) {
      failed += 1;
      logger.warn('push delivery threw', { userId, ...errorContext(err) });
    }
  }

  /*
   * One device accepting it is a working notification, whatever the others
   * did. Below that, the reason the owner needs is whichever thing happened:
   * a token Firebase has disowned is the person's own phone to re-register,
   * and anything else is Firebase's end.
   */
  const outcome: PushOutcome = delivered > 0
    ? 'sent'
    : failed > 0 || removed === 0 ? 'failed' : 'token-rejected';

  return { outcome, delivered, registered: tokens.length, removed };
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
