import { api } from './api.js';

/**
 * Lead notifications on the phone.
 *
 * The server half of this was built long ago and has been sending into the
 * void: nothing ever asked the browser for permission or registered a device,
 * so `push_tokens` stayed empty and no agent was ever buzzed about a lead.
 * This is the missing half.
 *
 * Firebase is loaded only when someone actually turns notifications on. It is
 * a large library and most of a working day is spent on screens that never
 * need it; agents here are on phones, often on mobile data.
 */

export type PushState =
  /** The browser cannot do this at all — an iPhone in Safari, not installed. */
  | 'unsupported'
  /** Nobody has set the Firebase keys yet. */
  | 'not-configured'
  /** Never asked. */
  | 'off'
  /** Asked and refused. Only the phone's own settings can undo this. */
  | 'blocked'
  | 'on';

type PushConfig =
  | { configured: false }
  | {
    configured: true;
    vapidKey: string;
    firebase: {
      apiKey: string; authDomain: string; projectId: string;
      messagingSenderId: string; appId: string;
    };
  };

let cachedConfig: PushConfig | null = null;

async function config(): Promise<PushConfig> {
  if (!cachedConfig) cachedConfig = await api.get<PushConfig>('/api/users/me/push-config');
  return cachedConfig;
}

/** Everything the browser needs before any of this can work. */
export function supported(): boolean {
  return (
    typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
  );
}

/**
 * True when this is an iPhone that has not been added to the home screen.
 *
 * Worth singling out: iOS gives a Safari tab no notifications at all, and the
 * only cure is installing the app. Telling an agent "notifications are off"
 * when the real answer is "add this to your home screen first" would have them
 * hunting through iOS settings for a switch that is not there.
 */
export function iosNeedsInstall(): boolean {
  if (typeof window === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    // iPadOS 13+ reports itself as a Mac; a touch screen gives it away.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as { standalone?: boolean }).standalone === true;
  return ios && !installed;
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (!(await config()).configured) return 'not-configured';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  // Granted is not the same as registered: permission survives a sign-out,
  // the token does not.
  return localStorage.getItem(TOKEN_KEY) ? 'on' : 'off';
}

const TOKEN_KEY = 'emir-push-token';

/**
 * Ask for permission, get a token for this device and register it.
 * Returns the state afterwards, so the screen shows what actually happened
 * rather than what was hoped for.
 */
/**
 * Which step of turning alerts on was running when it failed.
 *
 * Four separate things can throw here and three of them can throw the very
 * same `TypeError: Failed to fetch`: downloading the Firebase code from our
 * own site, asking Google for this device's address, and sending that
 * address back to our own server. They are different faults with different
 * cures — a half-deployed site, a blocked route to Google, and a phone that
 * cannot reach the CRM — and for an evening on 15 Nov we could not tell them
 * apart, so the screen asserted it was Google. It might not have been.
 *
 * `step` is on the error, so the sentence names the right one.
 */
export class PushStepError extends Error {
  readonly step: 'download' | 'google' | 'crm';

  constructor(step: 'download' | 'google' | 'crm', cause: unknown) {
    const inner = cause as { message?: unknown; name?: unknown; code?: unknown };
    const detail = [inner?.code, inner?.name, inner?.message]
      .filter((v): v is string => typeof v === 'string' && v !== '')
      .join(': ') || 'unknown';
    super(`${step}: ${detail}`);
    this.name = 'PushStepError';
    this.step = step;
  }
}

const at = async <T>(step: 'download' | 'google' | 'crm', run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (cause) {
    throw new PushStepError(step, cause);
  }
};

export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const cfg = await config();
  if (!cfg.configured) return 'not-configured';

  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';

  const [{ initializeApp, getApps }, { getMessaging, getToken }] = await at('download', () => Promise.all([
    import('firebase/app'),
    import('firebase/messaging'),
  ]));

  const app = getApps()[0] ?? initializeApp(cfg.firebase);
  /*
   * Our own service worker, not Firebase's. Two service workers would both
   * answer the same push and the agent would get every lead twice.
   */
  const registration = await navigator.serviceWorker.ready;
  const token = await at('google', () => getToken(getMessaging(app), {
    vapidKey: cfg.vapidKey,
    serviceWorkerRegistration: registration,
  }));
  if (!token) return 'off';

  await at('crm', () => api.post('/api/users/me/push-tokens', { token, platform: 'web' }));
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ }
  return 'on';
}

/** Stop this device receiving. Other devices the agent uses are untouched. */
export async function disablePush(): Promise<PushState> {
  const token = (() => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  })();
  if (token) {
    await api.del('/api/users/me/push-tokens', { token }).catch(() => undefined);
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
  }
  return pushState();
}

/**
 * Re-register quietly on sign-in.
 *
 * A token can be rotated by the browser, and ours is cleared on sign-out. An
 * agent who already said yes should not have to say yes again every morning —
 * and must never be re-prompted, which is why this returns early unless
 * permission is already granted.
 */
export async function refreshPushRegistration(): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  if (!(await config()).configured) return;
  await enablePush().catch(() => undefined);
}
