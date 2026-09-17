import { describe, expect, it } from 'vitest';
import { placeMenu } from './Pipeline.js';

const VIEWPORT = { width: 1280, height: 800 };
const WIDTH = 200;
/** A button somewhere harmless, adjusted per case. */
const button = (over: Partial<{ top: number; bottom: number; left: number; right: number }> = {}) => ({
  top: 300, bottom: 322, left: 400, right: 422, ...over,
});

describe('placing the move menu', () => {
  it('hangs under the button, right edges aligned', () => {
    const at = placeMenu(button(), WIDTH, false, VIEWPORT);
    expect(at.left).toBe(422 - WIDTH);
    expect(at.top).toBe(328);
    expect(at.bottom).toBeUndefined();
  });

  it('stays on screen for a card in the first column', () => {
    /*
     * The bug this was written for: a card near the left edge put the menu's
     * right edge at the button, which pushed 200px of it off the side of the
     * screen where it was then clipped by the board's own scrolling.
     */
    const at = placeMenu(button({ left: 40, right: 62 }), WIDTH, false, VIEWPORT);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.left + WIDTH).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it('stays on screen for a card at the right edge', () => {
    const at = placeMenu(button({ left: 1250, right: 1272 }), WIDTH, false, VIEWPORT);
    expect(at.left + WIDTH).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it('opens upwards when there is no room below', () => {
    const at = placeMenu(button({ top: 740, bottom: 762 }), WIDTH, false, VIEWPORT);
    expect(at.top).toBeUndefined();
    expect(at.bottom).toBe(VIEWPORT.height - 740 + 6);
  });

  it('never asks for more height than the screen has', () => {
    const below = placeMenu(button(), WIDTH, false, VIEWPORT);
    expect(below.maxHeight).toBeLessThanOrEqual(VIEWPORT.height);
    const above = placeMenu(button({ top: 740, bottom: 762 }), WIDTH, false, VIEWPORT);
    expect(above.maxHeight).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('aligns to the other edge in Arabic, where the layout is mirrored', () => {
    const at = placeMenu(button(), WIDTH, true, VIEWPORT);
    expect(at.left).toBe(400);
  });

  it('keeps a mirrored menu on screen too', () => {
    const at = placeMenu(button({ left: 1200, right: 1222 }), WIDTH, true, VIEWPORT);
    expect(at.left + WIDTH).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it('copes with a phone-sized screen', () => {
    const at = placeMenu(button({ left: 300, right: 322 }), WIDTH, false, { width: 390, height: 844 });
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.left + WIDTH).toBeLessThanOrEqual(390);
  });
});
