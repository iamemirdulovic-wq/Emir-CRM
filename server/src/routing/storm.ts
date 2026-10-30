/**
 * What the owner hears when the CRM has been off for a while.
 *
 * A worker that has been down for an hour comes back to a queue of expired
 * timers and runs them all within a few seconds. Each one is a real bounce and
 * each one wants to tell somebody — so the owner's phone buzzes seven times in
 * four seconds, they silence it, and the eighth one, which happened on a
 * normal Tuesday and actually mattered, is silenced too.
 *
 * So bounces are counted over a short window, and only the first gets its own
 * alert. The rest are summed and reported once.
 */

interface Window {
  count: number;
  firstAt: number;
  /** Set once the summary has gone, so a long catch-up reports once. */
  summarised: boolean;
}

/** Bounces inside this window are treated as one event. */
export const STORM_WINDOW_MS = 60_000;
/** Above this many in the window, stop sending them one at a time. */
export const STORM_THRESHOLD = 3;

export type StormVerdict =
  | { tell: 'each' }
  | { tell: 'nothing' }
  | { tell: 'summary'; count: number };

/**
 * Pure, so the awkward cases — exactly at the threshold, the window rolling
 * over mid-catch-up — are settled in a test rather than during an outage.
 */
export function noteBounce(window: Window | null, now: number): { window: Window; verdict: StormVerdict } {
  const fresh = !window || now - window.firstAt >= STORM_WINDOW_MS;
  const next: Window = fresh
    ? { count: 1, firstAt: now, summarised: false }
    : { ...window, count: window.count + 1 };

  if (next.count < STORM_THRESHOLD) return { window: next, verdict: { tell: 'each' } };

  /*
   * One summary per window. The lead that crosses the threshold carries the
   * count of everything so far, and everything after it is silent until the
   * window rolls over.
   */
  if (!next.summarised) {
    next.summarised = true;
    return { window: next, verdict: { tell: 'summary', count: next.count } };
  }
  return { window: next, verdict: { tell: 'nothing' } };
}

let current: Window | null = null;

/** The stateful wrapper the bounce path calls. */
export function recordBounceForAlerting(now = Date.now()): StormVerdict {
  const { window, verdict } = noteBounce(current, now);
  current = window;
  return verdict;
}

/** Tests, and a worker starting fresh. */
export function resetStorm(): void {
  current = null;
}
