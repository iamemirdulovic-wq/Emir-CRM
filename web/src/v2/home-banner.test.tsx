import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeBanner } from './HomeBanner.js';

/**
 * The banner at the top of both phone homes.
 *
 * Three things are checked here rather than by looking at a screenshot,
 * because all three are states a screenshot of a normal morning never shows:
 * the screen with no banner configured, a banner the owner has given a label
 * and a button, and a phone whose owner has asked for less movement.
 *
 * The owner's words, 14 Nov, point 9: "If no banner is set, show one default
 * homes.me banner. Never an empty space."
 */

let host: HTMLDivElement;
let root: Root;

/** jsdom has no matchMedia; the "phone" says what it prefers. */
function device(reduceMotion: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduceMotion && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function show(banners: Parameters<typeof HomeBanner>[0]['banners']) {
  act(() => {
    root.render(<MemoryRouter><HomeBanner banners={banners} /></MemoryRouter>);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  device(false);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ONE = {
  id: 'b-1',
  title: 'Cityscape Global · 17–19 Nov',
  body: 'DWTC · stand B12.',
  linkUrl: 'https://example.com/stand',
  label: 'From Emir',
  buttonText: 'See project',
};

describe('the phone home banner', () => {
  it('shows one homes.me card when nobody has written a banner', () => {
    show([]);
    expect(host.textContent).toContain('Nothing from the office today');
    /* One slide needs no dots, and an empty space is never the answer. */
    expect(host.querySelectorAll('.v2-b-ban-dot')).toHaveLength(0);
    expect(host.querySelectorAll('.v2-b-ban-slide')).toHaveLength(1);
  });

  it('draws the owner’s own label, words and button', () => {
    show([ONE]);
    expect(host.textContent).toContain('From Emir');
    expect(host.textContent).toContain('Cityscape Global · 17–19 Nov');
    expect(host.textContent).toContain('DWTC · stand B12.');
    expect(host.textContent).toContain('See project');
    expect(host.querySelector('a.v2-b-ban-slide')?.getAttribute('href'))
      .toBe('https://example.com/stand');
  });

  it('leaves the button off a banner with nowhere to go', () => {
    /*
     * `/api/v2/home` does not send the banner's own button wording or where
     * the owner pointed it, so a banner with no web address has no button
     * rather than one that guesses a destination.
     */
    show([{ id: 'b-2', title: 'A notice', body: null, linkUrl: null }]);
    expect(host.querySelector('.v2-b-ban-go')).toBeNull();
    expect(host.textContent).toContain('A notice');
  });

  it('moves itself on every 4.5 seconds, and a dot says which one', () => {
    /*
     * The strip is a scroller that snaps, so moving on is a scroll. jsdom
     * has no layout and no `scrollTo`, so both are supplied: the width makes
     * "one slide along" a real number to check.
     */
    const asked: Array<Record<string, unknown>> = [];
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 390 });
    (HTMLElement.prototype as unknown as { scrollTo: unknown }).scrollTo =
      function scrollTo(options: Record<string, unknown>) { asked.push(options); };

    show([ONE, { ...ONE, id: 'b-2', title: 'The second one' }]);
    expect(host.querySelectorAll('.v2-b-ban-dot')).toHaveLength(2);
    expect(host.querySelector('.v2-b-ban-dot-on')?.getAttribute('aria-label'))
      .toContain('Cityscape');

    act(() => { vi.advanceTimersByTime(4500); });
    expect(asked).toEqual([{ left: 390, behavior: 'smooth' }]);
  });

  it('stands still for somebody who asked for less movement', () => {
    const asked: Array<Record<string, unknown>> = [];
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 390 });
    (HTMLElement.prototype as unknown as { scrollTo: unknown }).scrollTo =
      function scrollTo(options: Record<string, unknown>) { asked.push(options); };

    device(true);
    show([ONE, { ...ONE, id: 'b-2', title: 'The second one' }]);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(asked).toEqual([]);
    expect(host.querySelector('.v2-b-ban-dot-on')?.getAttribute('aria-label'))
      .toContain('Cityscape');
  });
});
