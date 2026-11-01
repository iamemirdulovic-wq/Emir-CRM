import { useEffect, useRef } from 'react';
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

/** However often something asks, at most one beat this often. */
const MIN_GAP_MS = 5_000;

export function useHeartbeat(enabled: boolean): void {
  const location = useLocation();
  /* The current screen, read at send time. Keeping it in a ref rather than in
     the effect's dependencies is what stops a navigation tearing the timer
     down and starting a fresh one. */
  const path = useRef(location.pathname);
  path.current = location.pathname;
  const lastBeat = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;

    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      /* Never more than one beat every few seconds, however many things ask.
         Clicking through five screens used to fire five, on top of each
         screen's own data requests. */
      const now = Date.now();
      if (now - lastBeat.current < MIN_GAP_MS) return;
      lastBeat.current = now;

      void fetch('/api/activity/beat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        /* The path, not the URL: a lead id in an activity log is somebody's
           client, and the owner screen only needs to know which screen. */
        body: JSON.stringify({ path: path.current }),
        /*
         * No `keepalive`. It is meant for a request fired as the page goes
         * away, and browsers hold keepalive requests to a separate, much
         * smaller budget shared across the whole page. Using it for an
         * ordinary poll — once on mount, once per navigation, once every
         * thirty seconds — put this request in the wrong queue, and the
         * beat was failing on most page loads while the same call by hand
         * succeeded. It is fire-and-forget either way.
         */
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
  }, [enabled]);
}
