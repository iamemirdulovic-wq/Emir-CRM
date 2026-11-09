/**
 * The application shell: glass sidebar, sticky top bar, and the mobile bottom
 * bar. Ported from the shell in design/emir-crm-design.html.
 *
 * Two deliberate differences from the design file:
 *  - Nav items are links, not buttons, so URLs work the way agents expect.
 *  - The CRM | Books switcher is not built yet. Its footprint is reserved by
 *    .app-switch-slot so the sidebar already has its final proportions.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon, type IconName } from './Icon.js';
import { useAppearance, type Appearance } from './theme.js';
import { BrandLockup } from '../brand.js';
import { Avatar } from './ui.js';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Shown as a pill on the right of the item; hidden when zero. */
  badge?: number;
  /** Matches child routes too, e.g. /contacts/42 highlighting Contacts. */
  end?: boolean;
}


/* Link, not NavLink, on purpose. NavLink appends its own "active" class and
   its own aria-current on top of whatever we pass, and it decides both from
   the path alone: on /leads it lit My Leads and Follow-ups together, because
   they share a path and differ only by ?tab=today. navItemMatches below is
   the whole answer, so the link must not also have an opinion. */
/**
 * Which nav item is the current screen.
 *
 * NavLink decides this from the path alone, and two items here share a path:
 * My Leads is /leads and Follow-ups is /leads?tab=today. On the follow-ups
 * screen both lit up, so the sidebar showed two current screens at once.
 *
 * An item carrying a query matches only when that query matches. An item
 * without one yields to a sibling on the same path whose query does match,
 * which is what makes My Leads go quiet while Follow-ups is open.
 */
export function navItemMatches(item: NavItem, nav: NavItem[], location: { pathname: string; search: string }): boolean {
  const [path = '', query = ''] = item.to.split('?');
  const samePath = item.end === false
    ? location.pathname === path || location.pathname.startsWith(`${path}/`)
    : location.pathname === path;
  if (!samePath) return false;

  const current = new URLSearchParams(location.search);
  const matchesQuery = (q: string) => {
    const want = new URLSearchParams(q);
    for (const [key, value] of want) if (current.get(key) !== value) return false;
    return true;
  };

  if (query) return matchesQuery(query);

  const sibling = nav.find((other) => other !== item && other.to.startsWith(`${path}?`));
  if (sibling && matchesQuery(sibling.to.split('?')[1] ?? '')) return false;
  return true;
}

export interface ShellUser {
  name: string;
  /** Role as the user should read it, e.g. "Sales agent". */
  role: string;
  initials: string;
  /** A stage token such as var(--s-apt); a default is used when omitted. */
  colour?: string;
  /** Their photo. Falls back to the initials when absent or broken. */
  photoUrl?: string | null;
}

export interface AppShellProps {
  title: string;
  nav: NavItem[];
  /** Up to five items for the phone bar; falls back to the first four. */
  mobileNav?: NavItem[];
  user: ShellUser;
  onSignOut: () => void;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    /**
     * Where Enter goes when the screen underneath does not filter on the
     * term. Without it the box did nothing at all on the Dashboard: no
     * request, no results, no feedback.
     */
    onSubmit?: (value: string) => void;
  };
  /** The agent's "available for new leads" toggle; omit for non-agents. */
  availability?: {
    available: boolean;
    onChange: (available: boolean) => void;
  };
  /**
   * The bell. Passed in rather than built here: it owns its own list, its own
   * polling and its own panel, and the shell's job is to give it a place to
   * stand in the top bar.
   */
  bell?: ReactNode;
  /** The top bar's primary action, e.g. the Add lead button. */
  action?: ReactNode;
  /**
   * The big round button in the middle of the phone bar. On a phone the
   * primary action in the top bar is a cramped icon; down here it is under
   * the thumb, which is where an agent adding a lead in a car park needs it.
   */
  mobileAction?: { label: string; icon: IconName; onClick: () => void };
  /** The sound switch in the avatar menu. Omitted means no switch. */
  sound?: { on: boolean; onChange: (on: boolean) => void };
  children: ReactNode;
}

const THEME_ICON: Record<Appearance, IconName> = {
  system: 'monitor',
  light: 'sun',
  dark: 'moon',
};

const THEME_LABEL: Record<Appearance, string> = {
  system: 'Theme: follow the system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

function Badge({ count }: { count?: number }) {
  if (!count) return null;
  return <span className="badge">{count > 99 ? '99+' : count}</span>;
}

export function AppShell({
  title,
  nav,
  mobileNav,
  mobileAction,
  sound,
  user,
  onSignOut,
  search,
  availability,
  bell,
  action,
  children,
}: AppShellProps) {
  const location = useLocation();
  const { appearance, cycle } = useAppearance();

  /*
   * The highlight behind the current nav row is one element that slides,
   * rather than a background painted on whichever row is active. Measuring
   * the active link and moving a single pill is the only way to get motion
   * between two rows; a per-row background can only fade.
   *
   * `ready` is what stops it sliding up from the top of the sidebar on the
   * first paint — the transition is only switched on after it has been put
   * in the right place once.
   */
  const navRef = useRef<HTMLElement | null>(null);
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('a.active');
    setPill(active ? { top: active.offsetTop, height: active.offsetHeight } : null);
  }, [location.pathname, location.search, nav]);

  useEffect(() => {
    if (!pill || ready) return;
    /* One frame after the first placement, so the move to it is not animated. */
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [pill, ready]);
  const phoneNav = mobileNav ?? nav.slice(0, 5);
  /* With a centre button the bar holds four links around it, not five. */
  const barItems = mobileAction ? phoneNav.slice(0, 4) : phoneNav;
  const middle = Math.ceil(barItems.length / 2);

  return (
    <div id="app">
      <aside className="side">
        <BrandLockup />

        <nav className={ready ? 'nav ready' : 'nav'} aria-label="Primary" ref={navRef}>
          <span
            className={pill ? 'nav-pill on' : 'nav-pill'}
            aria-hidden="true"
            style={pill ? { transform: `translateY(${pill.top}px)`, height: pill.height } : undefined}
          />
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={navItemMatches(item, nav, location) ? 'active' : undefined}
              aria-current={navItemMatches(item, nav, location) ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              {item.label}
              <Badge count={item.badge} />
            </Link>
          ))}
        </nav>

        {availability && (
          <div className="avail">
            <span id="availLabel">Available for new leads</span>
            <button
              type="button"
              className={availability.available ? 'switch' : 'switch off'}
              role="switch"
              aria-checked={availability.available}
              aria-labelledby="availLabel"
              onClick={() => availability.onChange(!availability.available)}
            />
          </div>
        )}

        {sound && (
          <div className="avail">
            <span id="soundLabel">Sound for new leads</span>
            <button
              type="button"
              className={sound.on ? 'switch' : 'switch off'}
              role="switch"
              aria-checked={sound.on}
              aria-labelledby="soundLabel"
              onClick={() => sound.onChange(!sound.on)}
            />
          </div>
        )}

        {/* Reserved for the CRM | Books switcher. See components.css. */}
        <div className="app-switch-slot" aria-hidden="true" />

        <div className="side-foot">
          {/* The name is the way to one's own profile — the place everybody
              already looks for it, and one fewer item in the navigation. */}
          <Link className="side-me" to="/profile" title="Your profile">
            {/*
              * Their face if they have uploaded one. The initials used to be
              * shown to everybody, photo or not.
              *
              * This is the shared Avatar rather than a bare <img>: a photo
              * that fails to load paints the browser's broken-image glyph
              * straight over the initials underneath it, and Avatar is where
              * that is already handled.
              */}
            <Avatar
              name={user.name}
              src={user.photoUrl ?? undefined}
              colour={user.colour ?? 'var(--s-apt)'}
            />
            <div className="who">
              <span>{user.name}</span>
              <small>{user.role}</small>
            </div>
          </Link>
          <button type="button" onClick={onSignOut} title="Sign out" aria-label="Sign out">
            <Icon name="log-out" />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="top">
          <h1>{title}</h1>

          {search && (
            <label className="search">
              <Icon name="search" />
              <span className="sr-only">Search</span>
              {/*
                * Named and marked so Chrome stops offering the signed-in
                * account's email address here. It guesses from field shape,
                * and an unnamed text box at the top of a page looks enough
                * like a username field for it to try.
                */}
              <input
                type="search"
                name="crm-search"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && search.onSubmit) {
                    event.preventDefault();
                    search.onSubmit(search.value);
                  }
                }}
                placeholder={search.placeholder ?? 'Search leads, phone, project'}
              />
            </label>
          )}

          <button
            type="button"
            className="icon-btn"
            onClick={cycle}
            title={THEME_LABEL[appearance]}
            aria-label={THEME_LABEL[appearance]}
          >
            <Icon name={THEME_ICON[appearance]} />
          </button>

          {bell}

          {action}
        </header>

        <section className="view active">{children}</section>
      </main>

      <nav className="bottom-nav" aria-label="Primary mobile">
        {barItems.map((item, index) => (
          <Fragment key={item.to}>
            {/* The centre button sits in the middle of the row, so the items
                split around it rather than being pushed to one side. */}
            {mobileAction && index === middle && (
              <button type="button" className="bottom-add" onClick={mobileAction.onClick}>
                <span className="bottom-add-dot"><Icon name={mobileAction.icon} /></span>
                <span className="sr-only">{mobileAction.label}</span>
              </button>
            )}
            <Link
              to={item.to}
              className={navItemMatches(item, barItems, location) ? 'active' : undefined}
              aria-current={navItemMatches(item, barItems, location) ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          </Fragment>
        ))}
      </nav>
    </div>
  );
}
