import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { navItemMatches } from './AppShell.js';
import type { NavItem } from './AppShell.js';

/**
 * Two sidebar items share a path: My Leads is /leads and Follow-ups is
 * /leads?tab=today. NavLink matches on the path alone, so on the follow-ups
 * screen both lit up and the sidebar claimed two current screens.
 */
const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
  { to: '/leads', label: 'My Leads', icon: 'users' },
  { to: '/leads?tab=today', label: 'Follow-ups', icon: 'calendar-check' },
];

const at = (pathname: string, search = '') => ({ pathname, search });
const item = (to: string) => NAV.find((n) => n.to === to) as NavItem;

describe('navItemMatches', () => {
  it('lights only My Leads on the plain leads screen', () => {
    expect(navItemMatches(item('/leads'), NAV, at('/leads'))).toBe(true);
    expect(navItemMatches(item('/leads?tab=today'), NAV, at('/leads'))).toBe(false);
  });

  it('lights only Follow-ups on the follow-ups screen', () => {
    const here = at('/leads', '?tab=today');
    expect(navItemMatches(item('/leads?tab=today'), NAV, here)).toBe(true);
    expect(navItemMatches(item('/leads'), NAV, here)).toBe(false);
  });

  it('keeps My Leads lit for a tab that is not somebody else"s', () => {
    const here = at('/leads', '?tab=hot');
    expect(navItemMatches(item('/leads'), NAV, here)).toBe(true);
    expect(navItemMatches(item('/leads?tab=today'), NAV, here)).toBe(false);
  });

  it('does not light an unrelated screen', () => {
    expect(navItemMatches(item('/dashboard'), NAV, at('/leads'))).toBe(false);
  });

  it('matches child routes only when the item asks for it', () => {
    const nav: NavItem[] = [{ to: '/projects', label: 'Projects', icon: 'building', end: false }];
    expect(navItemMatches(nav[0] as NavItem, nav, at('/projects/abc'))).toBe(true);
    expect(navItemMatches(item('/leads'), NAV, at('/leads/abc'))).toBe(false);
  });
});

/*
 * The tests above pass on the pure function, and the sidebar was still wrong
 * for weeks: the matcher was right, but it was wrapped in a NavLink, and
 * NavLink appends its own "active" class and its own aria-current on top of
 * whatever you pass, decided from the path alone. Both items lit up on both
 * screens. Testing the function could never have caught it, and this project
 * has no React render testing, so the guard reads the file instead, the way
 * hook-order and css-collisions do.
 */
describe('nothing but navItemMatches decides the current screen', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  /* Comments stripped first: the file explains at length why it avoids
     NavLink, and a guard that its own reasoning trips is a guard nobody
     keeps. */
  const source = readFileSync(path.join(here, 'AppShell.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('uses Link rather than NavLink for the nav', () => {
    expect(source).not.toMatch(/\bNavLink\b/);
  });

  it('asks navItemMatches for both the class and aria-current', () => {
    const uses = source.match(/navItemMatches\(/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(4);
  });
});
