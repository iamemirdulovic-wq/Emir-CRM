import { describe, expect, it } from 'vitest';
import {
  ANCHOR_GAP, EDGE_MARGIN, EMPTY_TOUR, NARROW_WIDTH, packTourState, parseTourState, placeBubble,
  shouldOfferTour, spotlight, stepsFor, TOUR_LENGTH, tourProgress, type Placement, type Rect,
} from './tour.js';
import { STATIC_ITEMS } from './palette.js';

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const BUBBLE = { width: 320, height: 180 };

describe('stepsFor', () => {
  it('gives everybody exactly five', () => {
    for (const role of ['owner', 'admin', 'manager', 'agent'] as const) {
      expect(stepsFor(role)).toHaveLength(TOUR_LENGTH);
    }
  });

  it('matches a nav link whichever way the app is routed', () => {
    /* Production uses real paths, the preview build uses a hash. A selector
       that only matched one of them could never be checked before it shipped. */
    for (const role of ['owner', 'agent'] as const) {
      for (const step of stepsFor(role)) {
        if (step.anchor.includes('href')) expect(step.anchor).toContain('href$=');
      }
    }
  });

  it('names the phone bar as well as the sidebar', () => {
    /* The sidebar does not exist on a phone; the same link is in the bottom
       bar, and a tour that pointed at nothing there would be worse than none. */
    for (const role of ['owner', 'agent'] as const) {
      for (const step of stepsFor(role)) {
        if (step.anchor.startsWith('.nav ')) expect(step.anchor).toContain('.bottom-nav');
      }
    }
  });

  it('never shows an agent a screen they cannot open', () => {
    const steps = stepsFor('agent');
    const anchors = steps.map((step) => step.anchor).join(' ');
    expect(anchors).not.toContain('/incoming');
    expect(anchors).not.toContain('/team-activity');
    expect(anchors).not.toContain('/audit');
  });

  it('starts an owner on the queue nobody has taken', () => {
    expect(stepsFor('owner')[0]?.anchor).toContain('/incoming');
  });

  it('only sends people to screens that exist', () => {
    const known = new Set(STATIC_ITEMS.map((item) => item.to?.split('?')[0]).filter(Boolean));
    for (const role of ['owner', 'agent'] as const) {
      for (const step of stepsFor(role)) {
        if (step.goTo) expect(known.has(step.goTo)).toBe(true);
      }
    }
  });

  it('gives every step a unique id, a title and a sentence', () => {
    for (const role of ['owner', 'agent'] as const) {
      const steps = stepsFor(role);
      expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
      for (const step of steps) {
        expect(step.title.length).toBeGreaterThan(5);
        expect(step.body.length).toBeGreaterThan(30);
        expect(step.anchor.length).toBeGreaterThan(3);
      }
    }
  });
});

describe('placeBubble', () => {
  const sidebarItem: Rect = { top: 300, left: 16, width: 220, height: 40 };

  it('puts a sidebar bubble to the right of it', () => {
    const placed = placeBubble(sidebarItem, BUBBLE, DESKTOP, 'right');
    expect(placed.placement).toBe('right');
    expect(placed.left).toBe(sidebarItem.left + sidebarItem.width + ANCHOR_GAP);
  });

  it('centres a side bubble on the anchor', () => {
    const placed = placeBubble(sidebarItem, BUBBLE, DESKTOP, 'right');
    expect(placed.top).toBe(300 + 20 - 90);
  });

  it('puts a top-bar bubble below it', () => {
    const search: Rect = { top: 20, left: 400, width: 300, height: 40 };
    const placed = placeBubble(search, BUBBLE, DESKTOP, 'bottom');
    expect(placed.placement).toBe('bottom');
    expect(placed.top).toBe(60 + ANCHOR_GAP);
  });

  it('flips to the other side when the preferred one has no room', () => {
    /* An element hard against the right edge cannot have a bubble to its right. */
    const nearRight: Rect = { top: 300, left: 1380, width: 40, height: 40 };
    expect(placeBubble(nearRight, BUBBLE, DESKTOP, 'right').placement).toBe('left');
  });

  it('flips a bottom bubble up when the anchor is near the floor', () => {
    const nearBottom: Rect = { top: 860, left: 600, width: 100, height: 30 };
    expect(placeBubble(nearBottom, BUBBLE, DESKTOP, 'bottom').placement).toBe('top');
  });

  it('never goes off any edge, wherever the anchor is', () => {
    const corners: Rect[] = [
      { top: 0, left: 0, width: 10, height: 10 },
      { top: 0, left: 1430, width: 10, height: 10 },
      { top: 890, left: 0, width: 10, height: 10 },
      { top: 890, left: 1430, width: 10, height: 10 },
      { top: 440, left: 710, width: 20, height: 20 },
    ];
    for (const anchor of corners) {
      for (const prefer of ['top', 'bottom', 'left', 'right'] as Placement[]) {
        const placed = placeBubble(anchor, BUBBLE, DESKTOP, prefer);
        expect(placed.left).toBeGreaterThanOrEqual(EDGE_MARGIN);
        expect(placed.top).toBeGreaterThanOrEqual(EDGE_MARGIN);
        expect(placed.left + BUBBLE.width).toBeLessThanOrEqual(DESKTOP.width - EDGE_MARGIN);
        expect(placed.top + BUBBLE.height).toBeLessThanOrEqual(DESKTOP.height - EDGE_MARGIN);
      }
    }
  });

  it('ignores the preferred side on a phone', () => {
    const anchor: Rect = { top: 100, left: 20, width: 200, height: 40 };
    expect(placeBubble(anchor, BUBBLE, PHONE, 'right').placement).toBe('bottom');
  });

  it('goes above the anchor when it is in the bottom half of a phone', () => {
    const anchor: Rect = { top: 700, left: 20, width: 200, height: 40 };
    expect(placeBubble(anchor, BUBBLE, PHONE, 'right').placement).toBe('top');
  });

  it('treats the width either side of the breakpoint consistently', () => {
    const anchor: Rect = { top: 300, left: 16, width: 220, height: 40 };
    expect(placeBubble(anchor, BUBBLE, { width: NARROW_WIDTH - 1, height: 900 }, 'right').placement).not.toBe('right');
    expect(placeBubble(anchor, BUBBLE, { width: NARROW_WIDTH, height: 900 }, 'right').placement).toBe('right');
  });

  it('still returns something usable when the bubble is bigger than the screen', () => {
    const huge = { width: 2000, height: 2000 };
    const placed = placeBubble({ top: 10, left: 10, width: 10, height: 10 }, huge, PHONE, 'bottom');
    expect(placed.left).toBe(EDGE_MARGIN);
    expect(placed.top).toBe(EDGE_MARGIN);
  });
});

describe('spotlight', () => {
  it('rings the anchor with a little padding', () => {
    expect(spotlight({ top: 100, left: 50, width: 200, height: 40 }, 6)).toEqual({
      top: 94,
      left: 44,
      width: 212,
      height: 52,
    });
  });
});

describe('what is remembered', () => {
  it('round-trips', () => {
    const state = { step: 3, doneAt: '2026-03-04T08:00:00.000Z', skipped: false };
    expect(parseTourState(packTourState(state))).toEqual(state);
  });

  it('reads nothing as never seen', () => {
    expect(parseTourState(null)).toEqual(EMPTY_TOUR);
    expect(parseTourState('')).toEqual(EMPTY_TOUR);
    expect(parseTourState(undefined)).toEqual(EMPTY_TOUR);
  });

  it('reads rubbish as never seen rather than throwing', () => {
    expect(parseTourState('not json')).toEqual(EMPTY_TOUR);
    expect(parseTourState('{"step":')).toEqual(EMPTY_TOUR);
  });

  it('clamps a step out of range', () => {
    expect(parseTourState('{"step":99}').step).toBe(TOUR_LENGTH);
    expect(parseTourState('{"step":-5}').step).toBe(0);
    expect(parseTourState('{"step":"two"}').step).toBe(0);
    expect(parseTourState('{"step":2.7}').step).toBe(2);
  });

  it('treats a non-string doneAt as not done', () => {
    expect(parseTourState('{"doneAt":true}').doneAt).toBeNull();
    expect(parseTourState('{"doneAt":""}').doneAt).toBeNull();
  });

  it('offers the tour only to somebody who has never seen it', () => {
    expect(shouldOfferTour(EMPTY_TOUR)).toBe(true);
    expect(shouldOfferTour({ step: 0, doneAt: '2026-01-01', skipped: false })).toBe(false);
    expect(shouldOfferTour({ step: 0, doneAt: null, skipped: true })).toBe(false);
    expect(shouldOfferTour({ step: 2, doneAt: null, skipped: false })).toBe(false);
  });
});

describe('tourProgress', () => {
  it('counts from one, the way people do', () => {
    expect(tourProgress(0).label).toBe('1 of 5');
    expect(tourProgress(4).label).toBe('5 of 5');
  });

  it('gives a fraction for the bar', () => {
    expect(tourProgress(0).fraction).toBeCloseTo(0.2);
    expect(tourProgress(4).fraction).toBe(1);
  });

  it('clamps a step past the end', () => {
    expect(tourProgress(9).label).toBe('5 of 5');
    expect(tourProgress(-2).label).toBe('1 of 5');
  });
});
