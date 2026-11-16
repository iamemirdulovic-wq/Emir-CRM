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
  const e = err as { code?: unknown; name?: unknown; message?: unknown; step?: unknown };
  const str = (v: unknown) => (typeof v === 'string' && v ? v : '');
  const message = str(e?.message);
  const code = (() => {
    /* `code` is Firebase's own, and it names the fault on its own
       ("messaging/token-subscribe-failed"). A DOM error has only `name` and
       `message`, and for those the NAME IS NOT ENOUGH: "TypeError" is what
       the browser calls both "Failed to fetch dynamically imported module"
       and "The provided applicationServerKey is not valid", which need
       opposite fixes.
       Emir got exactly "(TypeError)" on 15 Nov from the first version of
       this function, which dropped the message — the same mistake, twice in
       one evening, as the button that said "it works". So the message comes
       too, whenever there is one. */
    if (str(e?.code)) return str(e.code);
    const name = str(e?.name);
    if (name && message) return `${name}: ${message}`.slice(0, 160);
    return name || message.slice(0, 160) || 'unknown';
  })();
  /*
   * Ordered, and the order is the whole point: these patterns overlap.
   * "Failed to fetch dynamically imported module" contains "Failed to fetch",
   * so the specific one has to be asked first or a half-downloaded app reads
   * as a broken connection and sends somebody hunting through their VPN. A
   * test holds this order; if you add a line, add its case there too.
   */
  const REASONS: Array<[RegExp, string]> = [
    [/permission-blocked|NotAllowedError|denied/i,
      'Your phone is blocking alerts for this site. Turn them on in the phone\u2019s own settings for the browser.'],
    [/unsupported-browser|only-available-in-window/i,
      'This browser cannot receive alerts. On an iPhone, add the CRM to your home screen first.'],
    [/applicationServerKey|InvalidAccessError/i,
      'The alert address Google gave us is not being accepted. Tell Emir: it is the FCM_VAPID_KEY value.'],
    [/dynamically imported module|Importing a module script failed|Load failed/i,
      'Part of the app did not download. Close every CRM tab, open it again, and retry \u2014 if it keeps failing you are offline or the site is mid-update.'],
    [/service-worker/i,
      'The app could not start its background part. Close every CRM tab, open it again, and retry.'],
    [/Failed to fetch|NetworkError|network error|ERR_/i,
      'A connection failed before anything was registered. Turn off any VPN, switch between Wi-Fi and mobile data, and try again.'],
    [/token-subscribe-failed|AbortError|push service/i,
      'Your phone could not register with Google. This is usually the network or the FCM_VAPID_KEY value. Try again on a different connection, and tell Emir if it keeps failing.'],
  ];
  /*
   * The step comes first, when we have it, because it is the one thing that
   * is known rather than inferred.
   *
   * Three of these steps throw an identical "Failed to fetch": downloading
   * our own code, asking Google for this device's address, and posting that
   * address back to our own server. Until 16 Nov the screen told Emir it was
   * Google, and nobody had established that — it was a guess wearing the
   * clothes of a diagnosis. `PushStepError` carries `step`, so read it; fall
   * through to the patterns only when it is absent, and then say plainly
   * that a connection failed without naming a culprit.
   */
  const byStep: Record<string, string> = {
    download: 'Part of the app did not download from the CRM. Close every CRM tab, open it again, and retry.',
    google: 'Your phone could not reach Google to get an alert address. Turn off any VPN and try again, or switch between Wi-Fi and mobile data. Nothing is wrong with the CRM or the keys.',
    crm: 'Your phone got its alert address from Google but could not send it back to the CRM. The connection to crm.homes.me dropped — try again in a moment.',
  };
  const step = str(e?.step);
  /* A step still loses to a fault the message names outright: a blocked
     permission or a rejected VAPID key is the same answer whichever step
     surfaced it, and more useful than "could not reach Google". */
  const named = REASONS.find(([pattern]) => pattern.test(code))?.[1];
  const networkish = /Failed to fetch|NetworkError|network error|ERR_/i.test(code);
  const say = (step && byStep[step] && (!named || networkish))
    ? byStep[step]
    : named ?? 'Turning alerts on failed before anything was registered.';
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
