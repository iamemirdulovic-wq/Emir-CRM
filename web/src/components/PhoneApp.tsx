import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../design/index.js';
import { Note, Panel, useToast } from '../design/ui.js';
import {
  disablePush, enablePush, iosNeedsInstall, pushState, supported, type PushState,
} from '../lib/push.js';

/**
 * Using the CRM as an app on a phone.
 *
 * Two things live here because an agent experiences them as one thing: the app
 * on their home screen, and it buzzing when a lead arrives. On an iPhone they
 * are literally the same thing — iOS gives a Safari tab no notifications at
 * all, so "add to home screen" is not a nicety, it is the prerequisite.
 */

type Platform = 'ios' | 'android' | 'desktop';

function platform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

function installed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as { standalone?: boolean }).standalone === true;
}

const STEPS: Record<Platform, { icon: 'share-2' | 'menu' | 'monitor'; lines: string[] }> = {
  ios: {
    icon: 'share-2',
    lines: [
      'Open mycrm.emirdulovic.com in Safari — it has to be Safari, not Chrome.',
      'Tap the Share button at the bottom.',
      'Scroll down and tap "Add to Home Screen".',
      'Open it from the home screen icon from now on.',
    ],
  },
  android: {
    icon: 'menu',
    lines: [
      'Open mycrm.emirdulovic.com in Chrome.',
      'Tap the ⋮ menu, top right.',
      'Tap "Install app", or "Add to Home screen".',
    ],
  },
  desktop: {
    icon: 'monitor',
    lines: [
      'On a phone, open mycrm.emirdulovic.com in the browser.',
      'iPhone: Share → Add to Home Screen. It must be Safari.',
      'Android: ⋮ menu → Install app.',
    ],
  },
};

export function PhoneAppPanel({ index = 0 }: { index?: number }) {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const here = platform();
  const isInstalled = installed();
  const needsInstallFirst = iosNeedsInstall();

  const read = useCallback(() => { void pushState().then(setState); }, []);
  useEffect(read, [read]);

  async function toggle() {
    setBusy(true);
    try {
      const next = state === 'on' ? await disablePush() : await enablePush();
      setState(next);
      if (next === 'on') toast('Notifications are on for this device');
      if (next === 'blocked') toast('Your phone is blocking notifications for this site');
    } catch {
      toast('That did not work — try again in a moment');
    } finally {
      setBusy(false);
    }
  }

  /** What the agent should read, in the order they need to hear it. */
  const status = (() => {
    if (!supported()) return { pill: 'pill', label: 'Not possible in this browser' };
    if (needsInstallFirst) return { pill: 'pill due', label: 'Add to your home screen first' };
    switch (state) {
      case 'on': return { pill: 'pill ok', label: 'On for this device' };
      case 'blocked': return { pill: 'pill due', label: 'Blocked in your phone settings' };
      case 'not-configured': return { pill: 'pill', label: 'Not set up yet' };
      case null: return { pill: 'pill', label: 'Checking…' };
      default: return { pill: 'pill due', label: 'Off — you will miss new leads' };
    }
  })();

  return (
    <Panel span={12} index={index} icon="smartphone" title="Using the CRM on your phone">
      <div className="kv">
        <span>This device</span>
        <b className={isInstalled ? 'pill ok' : 'pill'}>
          {isInstalled ? 'Installed as an app' : 'Running in the browser'}
        </b>
      </div>
      <div className="kv">
        <span>New lead notifications</span>
        <b className={status.pill}>{status.label}</b>
      </div>

      {state === 'blocked' && (
        <Note>
          Your phone is refusing notifications for this site, and only you can
          undo it — the CRM cannot ask again. On iPhone: Settings → Notifications
          → Emir CRM. On Android: hold the app icon → App info → Notifications.
        </Note>
      )}

      {state === 'not-configured' && (
        <Note>
          Notifications are not connected yet. The owner needs to add the
          Firebase keys to the hosting panel — see
          {' '}<code>docs/NOTIFICATIONS.md</code>.
        </Note>
      )}

      {needsInstallFirst && (
        <Note>
          On an iPhone, notifications only work once the CRM is on your home
          screen. A Safari tab gets none at all — that is Apple's rule, not ours.
        </Note>
      )}

      {supported() && state && state !== 'not-configured' && state !== 'blocked' && !needsInstallFirst && (
        <button
          type="button"
          className={state === 'on' ? 'btn' : 'btn btn-primary'}
          disabled={busy}
          style={{ marginTop: 12 }}
          onClick={() => { void toggle(); }}
        >
          <Icon name={state === 'on' ? 'bell-ring' : 'bell'} />
          <span>{busy ? 'Just a moment…' : state === 'on' ? 'Turn off on this device' : 'Turn on notifications'}</span>
        </button>
      )}

      {!isInstalled && (
        <>
          <h3 style={{ marginTop: 18 }}>
            <Icon name={STEPS[here].icon} />
            {here === 'desktop' ? 'Put it on your team’s phones' : 'Put it on your home screen'}
          </h3>
          <ol className="prose" style={{ margin: 0, paddingInlineStart: 20, fontSize: 13.5, lineHeight: 1.7 }}>
            {/* English steps inside an Arabic page: without dir="auto" the
                browser moves the full stop to the front of each line. */}
            {STEPS[here].lines.map((line) => <li key={line} dir="auto">{line}</li>)}
          </ol>
        </>
      )}
    </Panel>
  );
}
