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
