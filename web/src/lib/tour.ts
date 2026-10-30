import type { Role } from './types.js';

/**
 * The five-step tour.
 *
 * Five, not fifteen: the only tour anybody finishes is the one that ends
 * before they get bored, and a CRM this size cannot be taught in a tooltip
 * anyway. So each step points at one thing in the shell and says what it is
 * for in one sentence — the five things somebody needs to not feel lost on
 * their first morning. Everything else they will find.
 *
 * Owners and agents get different fives, because the first thing an owner
 * needs is the queue of leads nobody has taken, and an agent cannot see that
 * screen at all.
 *
 * `placeBubble` is here rather than in the component because getting a bubble
 * to stay on screen next to an element near an edge is exactly the kind of
 * arithmetic that is wrong in one browser and right in another, and the only
 * way to know is to test it.
 */

export type Placement = 'top' | 'bottom' | 'left' | 'right';

export interface TourStep {
  id: string;
  /**
   * A CSS selector for the thing being pointed at.
   *
   * Nav links are matched on the end of the href rather than the whole of it,
   * because the preview build routes with a hash — `#/leads` — and a selector
   * that only worked in production would mean the tour could never be checked
   * before it shipped. They name both navs, too: the sidebar is not there on
   * a phone and the same link lives in the bottom bar instead.
   */
  anchor: string;
  title: string;
  body: string;
  prefer: Placement;
  /**
   * Somewhere to send them when this step is shown, so the thing being
   * described is actually on screen. Omitted means stay where you are.
   */
  goTo?: string;
}

export const TOUR_LENGTH = 5;

/** What an agent is shown. */
const AGENT_STEPS: TourStep[] = [
  {
    id: 'agent-dashboard',
    anchor: '.nav a[href$="/dashboard"], .bottom-nav a[href$="/dashboard"]',
    title: 'Start here every morning',
    body: 'The Dashboard tells you what to do now — who to ring, who is waiting on a reply, what is overdue.',
    prefer: 'right',
    goTo: '/dashboard',
  },
  {
    id: 'agent-leads',
    anchor: '.nav a[href$="/leads"], .bottom-nav a[href$="/leads"]',
    title: 'Your leads live here',
    body: 'Everything assigned to you, with tabs for what is due today and who has no next step yet. That tab exists to be emptied.',
    prefer: 'right',
  },
  {
    id: 'agent-inbox',
    anchor: '.nav a[href$="/inbox"], .bottom-nav a[href$="/inbox"]',
    title: 'One inbox for everything',
    body: 'WhatsApp, email and your notes in one thread per client. The composer tells you when the 24-hour WhatsApp window has closed.',
    prefer: 'right',
  },
  {
    id: 'agent-search',
    anchor: '.top .search',
    title: 'Find anything in two seconds',
    body: 'Search a name, a number or a project. Press ⌘K — Ctrl K on Windows — from any screen to jump straight to a lead.',
    prefer: 'bottom',
  },
  {
    id: 'agent-availability',
    anchor: '.side .avail',
    title: 'Going into a meeting?',
    body: 'Switch this off and no new leads will be given to you until you switch it back. Nobody loses a lead to a phone in a pocket.',
    prefer: 'right',
  },
];

/** What an owner, admin or manager is shown. */
const MANAGER_STEPS: TourStep[] = [
  {
    id: 'manager-incoming',
    anchor: '.nav a[href$="/incoming"], .bottom-nav a[href$="/incoming"]',
    title: 'Leads nobody has taken',
    body: 'Anything that could not be assigned waits here, and the number beside it is how many. This is the screen to keep at zero.',
    prefer: 'right',
    goTo: '/incoming',
  },
  {
    id: 'manager-dashboard',
    anchor: '.nav a[href$="/dashboard"], .bottom-nav a[href$="/dashboard"]',
    title: 'What happened, and what to fix',
    body: 'Speed to lead, who replied and who did not, and the problems worth your morning — each one a button that opens the right list.',
    prefer: 'right',
    goTo: '/dashboard',
  },
  {
    id: 'manager-pipeline',
    anchor: '.nav a[href$="/pipeline"], .bottom-nav a[href$="/pipeline"]',
    title: 'The board',
    body: 'Every open lead by stage. Drag a card to move it; marking one Lost asks for a reason, because the reasons are the report.',
    prefer: 'right',
  },
  {
    id: 'manager-team',
    anchor: '.nav a[href$="/team-activity"], .bottom-nav a[href$="/team-activity"]',
    title: 'Who is actually working',
    body: 'Who is signed in, what they have done today, and anything odd — a login from a new city, a quiet afternoon.',
    prefer: 'right',
  },
  {
    id: 'manager-search',
    anchor: '.top .search',
    title: 'Find anything in two seconds',
    body: 'Search a name, a number or a project. Press ⌘K — Ctrl K on Windows — from any screen to jump straight to a lead.',
    prefer: 'bottom',
  },
];

export function stepsFor(role: Role): TourStep[] {
  return role === 'agent' ? AGENT_STEPS : MANAGER_STEPS;
}

/* --- where the bubble goes ---------------------------------------------- */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placed {
  top: number;
  left: number;
  placement: Placement;
}

/** Kept clear of the viewport edge, so the bubble never looks cut off. */
export const EDGE_MARGIN = 12;
/** Between the thing and the bubble pointing at it. */
export const ANCHOR_GAP = 14;
/** Below this width the sidebar is gone and side placements make no sense. */
export const NARROW_WIDTH = 720;

/**
 * Put the bubble beside the anchor, on screen.
 *
 * The preferred side is tried first, then the opposite, then whichever has the
 * most room. Whatever is chosen, the result is clamped inside the viewport —
 * a bubble half off the bottom of a phone is the failure that makes a tour
 * feel broken.
 */
export function placeBubble(anchor: Rect, bubble: Size, viewport: Size, prefer: Placement): Placed {
  const narrow = viewport.width < NARROW_WIDTH;
  /* On a phone there is no room either side, so it is above or below, and
     below unless the anchor is in the lower half of the screen. */
  const order: Placement[] = narrow
    ? anchor.top + anchor.height / 2 > viewport.height / 2
      ? ['top', 'bottom']
      : ['bottom', 'top']
    : [prefer, opposite(prefer), ...(['right', 'bottom', 'left', 'top'] as Placement[])];

  const placement = order.find((option) => fits(option, anchor, bubble, viewport)) ?? order[0] ?? 'bottom';
  const raw = position(placement, anchor, bubble);

  return {
    placement,
    left: clamp(raw.left, EDGE_MARGIN, Math.max(EDGE_MARGIN, viewport.width - bubble.width - EDGE_MARGIN)),
    top: clamp(raw.top, EDGE_MARGIN, Math.max(EDGE_MARGIN, viewport.height - bubble.height - EDGE_MARGIN)),
  };
}

function opposite(placement: Placement): Placement {
  switch (placement) {
    case 'top':
      return 'bottom';
    case 'bottom':
      return 'top';
    case 'left':
      return 'right';
    default:
      return 'left';
  }
}

function position(placement: Placement, anchor: Rect, bubble: Size): { top: number; left: number } {
  const centreX = anchor.left + anchor.width / 2 - bubble.width / 2;
  const centreY = anchor.top + anchor.height / 2 - bubble.height / 2;
  switch (placement) {
    case 'top':
      return { top: anchor.top - bubble.height - ANCHOR_GAP, left: centreX };
    case 'bottom':
      return { top: anchor.top + anchor.height + ANCHOR_GAP, left: centreX };
    case 'left':
      return { top: centreY, left: anchor.left - bubble.width - ANCHOR_GAP };
    default:
      return { top: centreY, left: anchor.left + anchor.width + ANCHOR_GAP };
  }
}

function fits(placement: Placement, anchor: Rect, bubble: Size, viewport: Size): boolean {
  const raw = position(placement, anchor, bubble);
  switch (placement) {
    case 'top':
      return raw.top >= EDGE_MARGIN;
    case 'bottom':
      return raw.top + bubble.height <= viewport.height - EDGE_MARGIN;
    case 'left':
      return raw.left >= EDGE_MARGIN;
    default:
      return raw.left + bubble.width <= viewport.width - EDGE_MARGIN;
  }
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

/** The ring drawn around the thing being pointed at. */
export function spotlight(anchor: Rect, padding = 6): Rect {
  return {
    top: anchor.top - padding,
    left: anchor.left - padding,
    width: anchor.width + padding * 2,
    height: anchor.height + padding * 2,
  };
}

/* --- what is remembered ------------------------------------------------- */

export interface TourState {
  /** Which step they are on, 0-based. */
  step: number;
  /** ISO date they finished or skipped it, or null if they are mid-tour. */
  doneAt: string | null;
  /** True when they pressed Skip rather than reaching the end. */
  skipped: boolean;
}

export const EMPTY_TOUR: TourState = { step: 0, doneAt: null, skipped: false };

/** Read the stored string. Anything unreadable means "never seen it". */
export function parseTourState(stored: string | null | undefined): TourState {
  if (!stored) return EMPTY_TOUR;
  try {
    const parsed = JSON.parse(stored) as Partial<TourState>;
    const step = typeof parsed.step === 'number' && Number.isFinite(parsed.step) ? parsed.step : 0;
    return {
      step: clamp(Math.floor(step), 0, TOUR_LENGTH),
      doneAt: typeof parsed.doneAt === 'string' && parsed.doneAt ? parsed.doneAt : null,
      skipped: parsed.skipped === true,
    };
  } catch {
    return EMPTY_TOUR;
  }
}

export function packTourState(state: TourState): string {
  return JSON.stringify(state);
}

/**
 * Should the tour start by itself?
 *
 * Only for somebody who has never seen it. Somebody who skipped it has
 * answered the question, and asking again is how a tour becomes the thing
 * people close without reading.
 */
export function shouldOfferTour(state: TourState): boolean {
  return state.doneAt === null && state.step === 0 && !state.skipped;
}

/** "3 of 5" — and the fraction for the little progress bar. */
export function tourProgress(step: number, total = TOUR_LENGTH): { label: string; fraction: number } {
  const shown = clamp(step + 1, 1, total);
  return { label: `${shown} of ${total}`, fraction: shown / total };
}
