/**
 * "Next lead" on the full lead page.
 *
 * Emir, 17 Nov 2026: a quick "next lead" button so the team does not have to
 * go back out to the list to get to the next lead.
 *
 * The list the agent opened the lead from is the only honest meaning of
 * "next": the old screen asked the server for the next lead on a tab, and the
 * server's order was not the one on screen (Emir's agents, 11 Nov: "it's just
 * repeating only first two leads all over again"). So the leads list writes
 * down the order it really draws, filters, search and "Show more" included,
 * and the lead page walks that.
 *
 * Kept in sessionStorage: one tab's walk, gone when the tab closes, never
 * shared with another agent's browser. Storage can throw (private mode,
 * blocked site data); then there is simply no button.
 */

export interface WalkStop { id: string; name: string | null }
export interface Walk { list: string; stops: WalkStop[] }
export interface WalkPlace {
  /** 1-based position of this lead in the list. */
  at: number;
  total: number;
  next: WalkStop | null;
  prev: WalkStop | null;
  /** The list address to go back to, filters and all. */
  list: string;
}

const KEY = 'v2.leadWalk';

export function rememberWalk(list: string, stops: WalkStop[]): void {
  if (stops.length === 0) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ list, stops } satisfies Walk));
  } catch { /* private mode: no walk, no button */ }
}

export function readWalk(): Walk | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const walk = JSON.parse(raw) as Walk;
    return Array.isArray(walk?.stops) && typeof walk.list === 'string' ? walk : null;
  } catch {
    return null;
  }
}

/** Where this lead sits in the remembered list, or null if it is not in it. */
export function placeIn(walk: Walk | null, id: string): WalkPlace | null {
  if (!walk) return null;
  const at = walk.stops.findIndex((stop) => stop.id === id);
  if (at < 0) return null;
  return {
    at: at + 1,
    total: walk.stops.length,
    next: walk.stops[at + 1] ?? null,
    prev: at > 0 ? walk.stops[at - 1] ?? null : null,
    list: walk.list,
  };
}
