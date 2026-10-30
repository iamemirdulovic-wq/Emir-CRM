import { useEffect, useState } from 'react';
import { Icon } from '../design/index.js';
import { Button } from '../design/forms.js';

/**
 * "Put the CRM on your phone."
 *
 * Installed, the alert for a new lead reaches an agent who is not looking at
 * the browser — which is the whole five-minute rule. So it is worth asking,
 * once, and never again.
 *
 * Asked on the second visit rather than the first: on the first, the agent is
 * being shown the CRM by someone and a banner is in the way. By the second
 * they have decided they are going to use it.
 */

const SEEN_KEY = 'emir.install.asked';
const VISITS_KEY = 'emir.install.visits';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private window. Worst case the banner shows again next time. */
  }
}

/** Standalone means it is already installed, so there is nothing to ask. */
function alreadyInstalled(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/** iOS has no install event: Safari only offers it through the Share menu. */
function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    if (alreadyInstalled() || read(SEEN_KEY) === 'yes') return undefined;

    const visits = Number(read(VISITS_KEY) ?? '0') + 1;
    write(VISITS_KEY, String(visits));
    if (visits < 2) return undefined;

    /*
     * Chrome and Edge fire this instead of showing their own bar, and only
     * once the page qualifies. Catching it is what lets the banner ask in the
     * CRM's own words rather than the browser's.
     */
    const onPrompt = (raw: Event) => {
      raw.preventDefault();
      setEvent(raw as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    if (isIosSafari()) setShowIos(true);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function dismiss() {
    write(SEEN_KEY, 'yes');
    setEvent(null);
    setShowIos(false);
  }

  if (!event && !showIos) return null;

  return (
    <div className="install-bar" role="region" aria-label="Install the app">
      <span className="install-icon" aria-hidden><Icon name="smartphone" /></span>
      <div className="install-words">
        <b>Put Emigeo CRM on your phone</b>
        <small>
          {showIos
            ? <>Tap <Icon name="share-2" size={13} /> Share, then <b>Add to Home Screen</b>.</>
            : 'So a new lead reaches you even when the CRM is closed.'}
        </small>
      </div>
      <div className="install-actions">
        {event && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              void event.prompt();
              /* Either answer is an answer: do not ask again. */
              void event.userChoice.finally(dismiss);
            }}
          >
            Install
          </Button>
        )}
        <button type="button" className="icon-btn" aria-label="Not now" onClick={dismiss}>
          <Icon name="x" />
        </button>
      </div>
    </div>
  );
}
