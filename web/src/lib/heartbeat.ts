import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Telling the server this browser is still here.
 *
 * Every thirty seconds, and only while the tab is visible — a laptop left
 * open on a closed lid should not count as somebody working, and a phone in
 * a pocket should not either. That is the whole reason "active minutes" in
 * the reports can be trusted.
 *
 * The beat is deliberately fire-and-forget: a failed one costs nothing and
 * is not worth telling anybody about, so nothing here can put an error on
 * the screen.
 */

export const BEAT_MS = 30_000;

export function useHeartbeat(enabled: boolean): void {
  const location = useLocation();

  useEffect(() => {
    if (!enabled) return undefined;

    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      void fetch('/api/activity/beat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        /* The path, not the URL: a lead id in an activity log is somebody's
           client, and the owner screen only needs to know which screen. */
        body: JSON.stringify({ path: location.pathname }),
        keepalive: true,
      }).catch(() => undefined);
    };

    beat();
    const timer = window.setInterval(beat, BEAT_MS);
    /* Coming back to the tab beats immediately, so Team Activity shows
       somebody as back within a second rather than within thirty. */
    document.addEventListener('visibilitychange', beat);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [enabled, location.pathname]);
}
