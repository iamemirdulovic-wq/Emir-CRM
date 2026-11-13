import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { Avatar } from '../design/ui.js';
import { useAuth } from '../lib/auth.js';
import { groupsFor, pinnedFor, PHONE_BAR, MESSAGE_ITEMS, type NavItem } from './nav.js';
import { Bell } from './Bell.js';
import { Find } from './Find.js';

/**
 * The frame every v2 screen sits inside.
 *
 * One component for both layouts, not two apps: the master prompt (§4) is
 * explicit that the phone and the computer are two views of the same data and
 * the same components. So the sidebar and the floating bar are two renderings
 * of one nav model (`nav.ts`), and which one you see is a media query.
 *
 * The rules it implements are numbered in `docs/v2/rules.md`; the ids are
 * quoted where a choice looks arbitrary, because most of them are not.
 */

const RAIL_KEY = 'homes.v2.rail';
/** S-31: the sidebar folds itself below this width. */
const AUTO_FOLD = 1200;
/** §4: under this, the phone layout. Above it, the computer one. */
const PHONE = 768;

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width:${PHONE - 1}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${PHONE - 1}px)`);
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

/**
 * Folded or expanded.
 *
 * Two things decide it and they are not the same thing: the person's own
 * choice, which is remembered (S-30), and the window being too narrow to hold
 * it open (S-31). A wide window may still show the rail because the person
 * asked for it; a narrow one shows the rail whatever they asked for.
 */
function useRail(): [boolean, () => void] {
  const [chosen, setChosen] = useState(() => {
    try {
      return window.localStorage.getItem(RAIL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [tooNarrow, setTooNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < AUTO_FOLD,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${AUTO_FOLD - 1}px)`);
    const onChange = () => setTooNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setChosen((on) => {
      const next = !on;
      try {
        window.localStorage.setItem(RAIL_KEY, next ? '1' : '0');
      } catch {
        /* A private window is not a reason to refuse to fold the sidebar. */
      }
      return next;
    });
  }, []);

  return [chosen || tooNarrow, toggle];
}

/**
 * What every badge in the menu says, read once for the whole shell.
 *
 * One request rather than one per badge: the sidebar is on every screen, and
 * five components each polling their own count is five requests a minute per
 * person. It refreshes when the route changes, which is when a number is most
 * likely to have moved.
 */
const Counts = createContext<Record<string, number>>({});

/** A number, or nothing. */
function Badge({ item, folded }: { item: NavItem; folded: boolean }) {
  const counts = useContext(Counts);
  const n = item.badge ? counts[item.badge] ?? 0 : 0;
  if (!item.badge || n === 0) return null;
  /* S-29: in the rail a badge is a dot, not a number -- there is no room for
     one, and a number nobody can read is just noise. */
  if (folded) return <span className={item.urgent ? 'v2-dot v2-dot-urgent' : 'v2-dot'} />;
  /* S-21, S-22: a plain number, red only when it means late or waiting. */
  return <span className={item.urgent ? 'v2-badge v2-badge-urgent' : 'v2-badge'}>{n}</span>;
}

function Row({ item, folded }: { item: NavItem; folded: boolean }) {
  const at = useLocation();
  if (item.later) {
    /* Drawn, and deliberately not reachable from here. See decisions.md §6.3:
       the old screen still works at its own address, so nothing is lost. */
    return (
      <span className="v2-row v2-row-later" title={`${item.label} — later`}>
        <Icon name={item.icon} />
        {!folded && (
          <>
            <span className="v2-row-label">{item.label}</span>
            <span className="v2-later">later</span>
          </>
        )}
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      className={() => (rowIsOn(item.to, at) ? 'v2-row v2-row-on' : 'v2-row')}
      title={folded ? item.label : undefined}
    >
      <Icon name={item.icon} />
      {!folded && <span className="v2-row-label">{item.label}</span>}
      <Badge item={item} folded={folded} />
    </NavLink>
  );
}

/**
 * Which row is lit.
 *
 * Two rows point at `/v2/tasks` — Tasks, and Follow-ups, which is that page's
 * second tab. React Router's own matching looks at the path alone, so it would
 * light both. A row whose address carries a query is lit only when that query
 * is the one in the address bar, and a row without one is lit only when there
 * is no tab in the address bar at all.
 */
function rowIsOn(to: string, at: { pathname: string; search: string }): boolean {
  const [path, query] = to.split('?');
  if (path === '/v2') return at.pathname === '/v2';
  if (at.pathname !== path && !at.pathname.startsWith(`${path}/`)) return false;
  const here = new URLSearchParams(at.search).get('tab');
  if (query) return here === new URLSearchParams(query).get('tab');
  return !here || !TAB_ROWS.has(`${path}?tab=${here}`);
}

/** Every row that is a tab of another row's page. */
const TAB_ROWS = new Set(['/v2/tasks?tab=follow-ups']);

function Sidebar({ folded, onToggle }: { folded: boolean; onToggle: () => void }) {
  const { user } = useAuth();
  const role = user?.role ?? 'agent';

  return (
    <nav className={folded ? 'v2-side v2-side-rail' : 'v2-side'} aria-label="Main">
      <div className="v2-brand">
        <Link to="/v2" className="v2-mark" aria-label="homes.me">
          <span className="v2-mark-box"><Icon name="building" /></span>
          {!folded && <span className="v2-mark-word">homes.me</span>}
        </Link>
        {/* S-27: the control sits beside the logo, and `[` does the same. */}
        <button
          type="button"
          className="v2-fold"
          onClick={onToggle}
          aria-label={folded ? 'Open the menu' : 'Fold the menu'}
          title={folded ? 'Open the menu  [' : 'Fold the menu  ['}
        >
          <Icon name={folded ? 'chevron-right' : 'chevron-left'} />
        </button>
      </div>

      {/* S-6: only this middle part scrolls. */}
      <div className="v2-groups">
        {groupsFor(role).map((group, i) => (
          <div className="v2-group" key={group.label ?? `top-${i}`}>
            {/* S-29: in the rail a group label becomes a line. */}
            {group.label && (folded
              ? <div className="v2-group-line" />
              : <div className="v2-group-label">{group.label}</div>)}
            {group.items.map((item) => <Row key={item.to} item={item} folded={folded} />)}
          </div>
        ))}

        <div className="v2-group">
          {folded ? <div className="v2-group-line" /> : <div className="v2-group-label">MESSAGES</div>}
          {MESSAGE_ITEMS.map((item) => <Row key={item.to} item={item} folded={folded} />)}
        </div>
      </div>

      {/* S-6, S-14: pinned, and it does not scroll away. */}
      <div className="v2-pinned">
        {pinnedFor(role).map((item) => <Row key={item.to} item={item} folded={folded} />)}
        <Link to="/v2/profile" className="v2-me">
          <Avatar name={user?.name ?? '?'} />
          {!folded && (
            <span className="v2-me-who">
              <span className="v2-me-name">{user?.name ?? 'Signed in'}</span>
              <span className="v2-me-role">{user?.role ?? ''}</span>
            </span>
          )}
        </Link>
      </div>
    </nav>
  );
}

function TopBar() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  /* S-38: on a record the title is the way back, not a label. */
  const onRecord = /^\/v2\/leads\/[^/]+$/.test(pathname);

  return (
    <header className="v2-top">
      {onRecord ? (
        <Link to="/v2/leads" className="v2-back"><Icon name="arrow-left" />All leads</Link>
      ) : (
        <h1 className="v2-title">{titleFor(pathname, user?.role ?? 'agent')}</h1>
      )}

      {/* S-39, S-40: always visible, and never an empty box when opened. */}
      <Find />

      {/* S-43: the only filled button up here. */}
      <Link to="/v2/leads/new" className="v2-add"><Icon name="plus" />Add lead</Link>

      {/* S-45: agents only, and it is the check-in rule made visible. */}
      {user?.role === 'agent' && (
        <Link to="/v2/attendance" className="v2-checkin v2-checkin-out">
          <Icon name="clock-3" />Check in
        </Link>
      )}

      <Bell />
      <Link to="/v2/profile" className="v2-avatar" aria-label="My profile">
        <Avatar name={user?.name ?? '?'} />
      </Link>
    </header>
  );
}

/** The phone's floating bar, and the dial button beside it — never over it. */
function PhoneBar() {
  const at = useLocation();
  return (
    <div className="v2-bar-wrap">
      <nav className="v2-bar" aria-label="Main">
        {PHONE_BAR.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={() => (rowIsOn(item.to, at) ? 'v2-tab v2-tab-on' : 'v2-tab')}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <Link to="/v2/calling" className="v2-dial" aria-label="Start calling">
        <Icon name="phone" />
      </Link>
    </div>
  );
}

function titleFor(pathname: string, role: string): string {
  if (pathname === '/v2') return role === 'agent' ? 'My Day' : 'Dashboard';
  const rest = pathname.replace('/v2/', '').split('/')[0] ?? '';
  const named: Record<string, string> = {
    leads: role === 'agent' ? 'My leads' : 'All leads',
    'follow-ups': 'Follow-ups',
    incoming: 'Incoming',
    pipeline: 'Pipeline',
    transfers: 'Transfers',
    import: 'Import',
    calendar: 'Calendar',
    tasks: 'Tasks',
    calling: 'Calling',
    projects: 'Projects',
    offers: 'Sales offers',
    card: 'My business card',
    messaging: 'Messaging',
    team: 'Team',
    wall: 'Team wall',
    best: 'Best of Homes',
    notifications: 'Notifications',
    search: 'Search',
    attendance: 'Attendance',
    activity: 'Activity',
    inbox: 'Inbox',
    email: 'Email',
    templates: 'Templates',
    ai: 'Homes AI',
    automations: 'Automations',
    settings: 'Settings',
    profile: 'My profile',
    more: 'More',
  };
  return named[rest] ?? 'homes.me';
}

export function V2Shell() {
  const isPhone = useIsPhone();
  const [folded, toggleRail] = useRail();
  const { pathname } = useLocation();
  /* Re-read when the screen changes: taking a lead, answering a transfer or
     finishing a task all change a number, and all of them change the route. */
  const badges = useAsync<Record<string, number>>(() => api.get('/api/v2/badges'), [pathname]);
  const counts = useMemo(() => badges.data ?? {}, [badges.data]);

  /*
   * The orange system is opt-in per page (`:root[data-v2]`), so that the live
   * screens keep their own look while both exist. Setting it here means every
   * v2 screen gets it and nothing else does.
   */
  useEffect(() => {
    document.documentElement.setAttribute('data-v2', '');
    return () => document.documentElement.removeAttribute('data-v2');
  }, []);

  /* S-27: `[` folds the sidebar, unless you are typing. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      toggleRail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRail]);

  return (
    <Counts.Provider value={counts}>
      <div className={isPhone ? 'v2 v2-phone' : 'v2'}>
        {!isPhone && <Sidebar folded={folded} onToggle={toggleRail} />}
        <div className="v2-main">
          {!isPhone && <TopBar />}
          {isPhone && <PhoneTop />}
          <main className="v2-page"><Outlet /></main>
        </div>
        {isPhone && <PhoneBar />}
      </div>
    </Counts.Provider>
  );
}

/**
 * The phone's top strip.
 *
 * On a phone the sidebar is gone, so search, the bell and Add lead have
 * nowhere else to live. Without it an agent on a phone could not search at
 * all — the computer layout hides that, and it is exactly the thing most of
 * this team does most of the day.
 */
function PhoneTop() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const onRecord = /^\/v2\/leads\/[^/]+$/.test(pathname);
  const navigate = useNavigate();

  return (
    <header className="v2-ptop">
      {onRecord ? (
        <button type="button" className="v2-back" onClick={() => navigate(-1)}>
          <Icon name="arrow-left" />Back
        </button>
      ) : (
        <h1 className="v2-title">{titleFor(pathname, user?.role ?? 'agent')}</h1>
      )}
      <Find compact />
      <Bell />
      <Link to="/v2/leads/new" className="v2-padd" aria-label="Add lead"><Icon name="plus" /></Link>
    </header>
  );
}

/** The phone's More screen: the rest of the same menu, in the same order. */
export function V2More() {
  const { user } = useAuth();
  const role = user?.role ?? 'agent';
  const counts = useContext(Counts);

  return (
    <div className="v2-more">
      {groupsFor(role).map((group, i) => (
        <section className="v2-more-group" key={group.label ?? `top-${i}`}>
          {group.label && <h2>{group.label}</h2>}
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} className="v2-more-row">
              <Icon name={item.icon} />
              <span className="v2-more-label">{item.label}</span>
              {item.badge && (counts[item.badge] ?? 0) > 0 && (
                <span className={item.urgent ? 'v2-badge v2-badge-urgent' : 'v2-badge'}>
                  {counts[item.badge]}
                </span>
              )}
              <Icon name="chevron-right" />
            </NavLink>
          ))}
        </section>
      ))}

      <section className="v2-more-group">
        {pinnedFor(role).map((item) => (
          <NavLink key={item.to} to={item.to} className="v2-more-row">
            <Icon name={item.icon} />
            <span className="v2-more-label">{item.label}</span>
            <Icon name="chevron-right" />
          </NavLink>
        ))}
        <Link to="/v2/profile" className="v2-more-row">
          <Avatar name={user?.name ?? '?'} />
          <span className="v2-more-label">{user?.name ?? 'My profile'}</span>
          <Icon name="chevron-right" />
        </Link>
      </section>

      <section className="v2-more-group">
        <h2>MESSAGES</h2>
        {MESSAGE_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className="v2-more-row">
            <Icon name={item.icon} />
            <span className="v2-more-label">{item.label}</span>
            <Icon name="chevron-right" />
          </NavLink>
        ))}
      </section>
    </div>
  );
}
