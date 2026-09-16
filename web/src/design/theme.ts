/**
 * Appearance: light / dark / follow the system, plus "Reduce glass effect".
 *
 * Both settings are written to <html> as data attributes, because that is what
 * the stylesheets key off:
 *
 *   :root[data-theme="dark"]            forced dark
 *   :root:not([data-theme="light"])     inside prefers-color-scheme: dark
 *   :root[data-glass="off"]             blur off, panels opaque
 *
 * "system" writes no data-theme at all, which lets the media query decide.
 *
 * The choice is per device, not per account: an agent on an old phone wants the
 * glass off there and nowhere else, and the same person on a desktop should not
 * inherit it. So it lives in localStorage and is applied by a boot script in
 * index.html before first paint, which is what stops the light-then-dark flash.
 */
import { useCallback, useEffect, useState } from 'react';

export type Appearance = 'system' | 'light' | 'dark';

const THEME_KEY = 'emir.theme';
const GLASS_KEY = 'emir.glass';

/** The order the top-bar button cycles through. */
const CYCLE: Appearance[] = ['system', 'light', 'dark'];

function isAppearance(value: unknown): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Private-mode Safari throws on localStorage rather than returning null, and an
 * unreadable preference must never stop the app from rendering.
 */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the setting simply does not survive this session.
  }
}

export function getAppearance(): Appearance {
  const stored = read(THEME_KEY);
  return isAppearance(stored) ? stored : 'system';
}

/** True when glass is reduced (blur off, opaque panels). */
export function isGlassReduced(): boolean {
  return read(GLASS_KEY) === 'off';
}

/** What the user actually sees right now, with "system" resolved. */
export function resolveAppearance(appearance: Appearance = getAppearance()): 'light' | 'dark' {
  if (appearance !== 'system') return appearance;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function paintBrowserChrome(resolved: 'light' | 'dark'): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  // The values are the --bg tokens; keeping the address bar in step matters on
  // mobile, where the browser chrome sits directly against the page.
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#060D1A' : '#EAF3F8');
}

export function applyAppearance(appearance: Appearance = getAppearance()): void {
  const root = document.documentElement;
  if (appearance === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', appearance);
  paintBrowserChrome(resolveAppearance(appearance));
}

export function applyGlass(reduced: boolean = isGlassReduced()): void {
  const root = document.documentElement;
  if (reduced) root.setAttribute('data-glass', 'off');
  else root.removeAttribute('data-glass');
}

export function setAppearance(appearance: Appearance): void {
  write(THEME_KEY, appearance);
  applyAppearance(appearance);
}

export function setGlassReduced(reduced: boolean): void {
  write(GLASS_KEY, reduced ? 'off' : 'on');
  applyGlass(reduced);
}

/** Applies both stored settings. Safe to call twice. */
export function initTheme(): void {
  applyAppearance();
  applyGlass();
}

/**
 * The appearance setting, the resolved light/dark it produces, and a cycle
 * action for the top-bar button. Re-renders when the OS switches while the
 * setting is "system".
 */
export function useAppearance() {
  const [appearance, setLocal] = useState<Appearance>(getAppearance);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveAppearance());

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setResolved(resolveAppearance());
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const choose = useCallback((next: Appearance) => {
    setAppearance(next);
    setLocal(next);
    setResolved(resolveAppearance(next));
  }, []);

  const cycle = useCallback(() => {
    const next = CYCLE[(CYCLE.indexOf(getAppearance()) + 1) % CYCLE.length];
    if (next) choose(next);
  }, [choose]);

  return { appearance, resolved, setAppearance: choose, cycle };
}

/** The "Reduce glass effect" setting, for the Settings screen. */
export function useGlassReduced(): [boolean, (reduced: boolean) => void] {
  const [reduced, setLocal] = useState<boolean>(isGlassReduced);
  const set = useCallback((next: boolean) => {
    setGlassReduced(next);
    setLocal(next);
  }, []);
  return [reduced, set];
}

/**
 * True when the device asks for less motion. Charts and count-ups read this and
 * jump straight to their final state instead of animating.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return reduced;
}
