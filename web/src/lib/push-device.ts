import { useCallback, useEffect, useState } from 'react';
import {
  disablePush, enablePush, iosNeedsInstall, pushState, type PushState,
} from './push.js';

/**
 * One reading of "can this device get alerts, and what do I press".
 *
 * Three screens ask the same question and each had its own answer: the live
 * `components/PhoneApp.tsx` panel, the v2 `settings/PhoneApp.tsx` guide (which
 * asked the browser for permission and never registered a device, so it said
 * "This computer will show alerts" and delivered none), and the "Turn on
 * notifications" card on My Day. On 15 Nov that mattered: the owner had
 * dismissed the My Day card once, long before any Firebase key existed, and
 * from then on **v2 had no route at all to registering a phone** — the only
 * caller of `enablePush()` in the whole of v2 was that one self-destructing
 * card.
 *
 * So the reasoning is here, once, and each screen draws it in its own clothes.
 *
 * The one rule: this reports what the *browser and the server* say, never a
 * stored preference. A switch that remembers being pressed is a switch that
 * tells somebody their phone is registered after they cleared their browser.
 */

/**
 * Why turning alerts on failed, in words plus the browser's own short code.
 *
 * Both screens used to catch the error and say "That did not work" — the same
 * failure as the test button that said "it works", only the other way round:
 * a sentence that tells nobody anything. On 15 Nov the owner pressed Turn on,
 * got that line, and there was no way for either of us to find out which of
 * six things had happened; the keys were right, the service worker was right,
 * and the error that would have said so was thrown away.
 *
 * The code is kept on the end on purpose. It is not for him to read — it is so
 * that a screenshot of the card is enough to diagnose it without a laptop and
 * a USB cable.
 */
export function whyPushFailed(err: unknown): string {
  const code = (() => {
    const e = err as { code?: unknown; name?: unknown; message?: unknown };
    /* A bare `Error` names itself "Error", which says nothing and would hide
       the message behind it — the one piece of detail worth photographing.
       Only a name that distinguishes something is used as the code. */
    for (const v of [e?.code, e?.name]) {
      if (typeof v === 'string' && v && v !== 'Error') return v;
    }
    return typeof e?.message === 'string' && e.message ? e.message.slice(0, 60) : 'unknown';
  })();
  const say = /permission-blocked|NotAllowedError/i.test(code)
    ? 'Your phone is blocking alerts for this site. Turn them on in the phone’s own settings for the browser.'
    : /unsupported-browser|only-available-in-window/i.test(code)
      ? 'This browser cannot receive alerts. On an iPhone, add the CRM to your home screen first.'
      : /service-worker/i.test(code)
        ? 'The app could not start its background part. Close every CRM tab, open it again, and retry.'
        : /token-subscribe-failed|AbortError|push service/i.test(code)
          ? 'Your phone could not register with Google. This is usually the network or the FCM_VAPID_KEY value. Try again on a different connection, and tell Emir if it keeps failing.'
          : 'Turning alerts on failed before anything was registered.';
  return `${say} (${code})`;
}

export type PushTone = 'ok' | 'warn' | 'plain';

export interface PushLook {
  /** The short status words beside the row. */
  label: string;
  tone: PushTone;
  /** Whether a switch here can change anything at all. */
  canToggle: boolean;
  /** True when this device is registered and will get alerts. */
  on: boolean;
  /** An iPhone that must be on the home screen before any of this works. */
  needsInstallFirst: boolean;
}

/**
 * The state, read in the order a person needs to hear it.
 *
 * "Add to your home screen first" comes before "not possible in this browser"
 * on an iPhone, because an iPhone Safari tab reports itself as unable and the
 * cure is not in iOS settings — it is the Share button. Saying "not possible"
 * there sends an agent hunting for a switch that does not exist. The My Day
 * card already reasoned this way; the panels did not.
 */
export function pushLook(state: PushState | null, needsInstall: boolean): PushLook {
  const off = { canToggle: false, on: false, needsInstallFirst: needsInstall };
  if (state === null) return { ...off, label: 'Checking…', tone: 'plain' };
  if (state === 'unsupported') {
    return needsInstall
      ? { ...off, label: 'Add to your home screen first', tone: 'warn' }
      : { ...off, label: 'Not possible in this browser', tone: 'plain' };
  }
  if (needsInstall) return { ...off, label: 'Add to your home screen first', tone: 'warn' };
  switch (state) {
    case 'on':
      return { ...off, label: 'On for this device', tone: 'ok', canToggle: true, on: true };
    case 'blocked':
      /* Only the phone's own settings can undo this; the CRM may not ask again. */
      return { ...off, label: 'Blocked in your phone settings', tone: 'warn' };
    case 'not-configured':
      return { ...off, label: 'Not set up yet', tone: 'plain' };
    default:
      return { ...off, label: 'Off — you will miss new leads', tone: 'warn', canToggle: true };
  }
}

/**
 * What to tell somebody after they pressed the switch.
 *
 * `wasOn` is what they were trying to do, because "off" means two different
 * things: a device that has just been unregistered on purpose, and a browser
 * that declined to be registered.
 */
export function pushSaid(next: PushState, wasOn: boolean): string {
  if (wasOn) return 'This device will not get alerts. Your other devices still will.';
  switch (next) {
    case 'on': return 'Notifications are on for this device.';
    case 'blocked': return 'Your phone refused. Turn them on in its own settings.';
    case 'not-configured': return 'This device cannot be registered yet: the server has no Firebase key.';
    case 'unsupported': return 'This browser cannot show notifications.';
    default: return 'Not turned on. The browser did not give permission, so nothing was registered.';
  }
}

export interface PushDevice {
  state: PushState | null;
  look: PushLook;
  busy: boolean;
  /** What happened the last time the switch was pressed. */
  said: string | null;
  /**
   * Ask for permission and register, or unregister.
   *
   * It returns the sentence as well as the state because a caller that read
   * `said` straight after awaiting this would get the previous render's value
   * — React has not re-rendered yet — and would toast the last answer instead
   * of this one.
   */
  toggle: () => Promise<{ state: PushState; said: string }>;
  refresh: () => void;
}

export function usePushDevice(): PushDevice {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  /* Read once rather than per render: it reads `navigator` and a media query,
     and it cannot change without the page being reloaded from the home
     screen icon. */
  const [needsInstall] = useState(() => iosNeedsInstall());

  const refresh = useCallback(() => {
    void pushState().then(setState).catch(() => setState('unsupported'));
  }, []);
  useEffect(refresh, [refresh]);

  const toggle = useCallback(async (): Promise<{ state: PushState; said: string }> => {
    const wasOn = state === 'on';
    setBusy(true);
    try {
      const next = wasOn ? await disablePush() : await enablePush();
      const line = pushSaid(next, wasOn);
      setState(next);
      setSaid(line);
      return { state: next, said: line };
    } catch (err) {
      const line = whyPushFailed(err);
      setSaid(line);
      return { state: state ?? 'off', said: line };
    } finally {
      setBusy(false);
    }
  }, [state]);

  return { state, look: pushLook(state, needsInstall), busy, said, toggle, refresh };
}
