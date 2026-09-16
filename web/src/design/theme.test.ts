import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyGlass,
  getAppearance,
  initTheme,
  isGlassReduced,
  resolveAppearance,
  setAppearance,
  setGlassReduced,
} from './theme.js';

/** jsdom has no matchMedia, so tests declare what the "device" prefers. */
function stubSystem(prefersDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: query.includes('prefers-color-scheme: dark') ? prefersDark : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-glass');
  document.head.innerHTML = '<meta name="theme-color" content="#EAF3F8">';
  stubSystem(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('appearance', () => {
  it('follows the system until the user chooses', () => {
    expect(getAppearance()).toBe('system');
    initTheme();
    // No data-theme at all is what lets the media query decide.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('resolves "system" against the device', () => {
    stubSystem(true);
    expect(resolveAppearance('system')).toBe('dark');
    stubSystem(false);
    expect(resolveAppearance('system')).toBe('light');
  });

  it('pins the attribute when the user picks a side', () => {
    setAppearance('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    setAppearance('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('keeps a forced light theme on a dark device', () => {
    stubSystem(true);
    setAppearance('light');
    // The :root:not([data-theme="light"]) guard in the stylesheet depends on
    // this attribute being present, so an agent who wants light gets light.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(resolveAppearance('light')).toBe('light');
  });

  it('survives a reload', () => {
    setAppearance('dark');
    document.documentElement.removeAttribute('data-theme');
    initTheme();
    expect(getAppearance()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('keeps the address bar in step with the page', () => {
    setAppearance('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#060D1A');
    setAppearance('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#EAF3F8');
  });

  it('ignores a stored value it does not recognise', () => {
    window.localStorage.setItem('emir.theme', 'neon');
    expect(getAppearance()).toBe('system');
  });
});

describe('reduce glass effect', () => {
  it('is off by default', () => {
    expect(isGlassReduced()).toBe(false);
    applyGlass();
    expect(document.documentElement.hasAttribute('data-glass')).toBe(false);
  });

  it('marks the document so the stylesheet can drop the blur', () => {
    setGlassReduced(true);
    expect(document.documentElement.getAttribute('data-glass')).toBe('off');
    expect(isGlassReduced()).toBe(true);
  });

  it('can be turned back on', () => {
    setGlassReduced(true);
    setGlassReduced(false);
    expect(document.documentElement.hasAttribute('data-glass')).toBe(false);
    expect(isGlassReduced()).toBe(false);
  });

  it('is independent of the colour theme', () => {
    setAppearance('dark');
    setGlassReduced(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-glass')).toBe('off');
  });
});

describe('unavailable storage', () => {
  it('still renders when localStorage throws', () => {
    // Private-mode Safari throws on both read and write. Losing the preference
    // is acceptable; failing to draw the app is not.
    const storage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    vi.stubGlobal('localStorage', storage);
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
    expect(getAppearance()).toBe('system');
    expect(isGlassReduced()).toBe(false);
    expect(() => setAppearance('dark')).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
