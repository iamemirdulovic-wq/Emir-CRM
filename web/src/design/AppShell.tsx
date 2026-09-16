/**
 * The application shell: glass sidebar, sticky top bar, and the mobile bottom
 * bar. Ported from the shell in design/emir-crm-design.html.
 *
 * Two deliberate differences from the design file:
 *  - Nav items are links, not buttons, so URLs work the way agents expect.
 *  - The CRM | Books switcher is not built yet. Its footprint is reserved by
 *    .app-switch-slot so the sidebar already has its final proportions.
 */
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from './Icon.js';
import { useAppearance, type Appearance } from './theme.js';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Shown as a pill on the right of the item; hidden when zero. */
  badge?: number;
  /** Matches child routes too, e.g. /contacts/42 highlighting Contacts. */
  end?: boolean;
}

export interface ShellUser {
  name: string;
  /** Role as the user should read it, e.g. "Sales agent". */
  role: string;
  initials: string;
  /** A stage token such as var(--s-apt); a default is used when omitted. */
  colour?: string;
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
  };
  /** The agent's "available for new leads" toggle; omit for non-agents. */
  availability?: {
    available: boolean;
    onChange: (available: boolean) => void;
  };
  notifications?: {
    unread: number;
    onOpen: () => void;
  };
  /** The top bar's primary action, e.g. the Add lead button. */
  action?: ReactNode;
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
  user,
  onSignOut,
  search,
  availability,
  notifications,
  action,
  children,
}: AppShellProps) {
  const { appearance, cycle } = useAppearance();
  const phoneNav = mobileNav ?? nav.slice(0, 5);

  return (
    <div id="app">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">E</div>
          <span>Emir CRM</span>
        </div>

        <nav className="nav" aria-label="Primary">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              <Icon name={item.icon} />
              {item.label}
              <Badge count={item.badge} />
            </NavLink>
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

        {/* Reserved for the CRM | Books switcher. See components.css. */}
        <div className="app-switch-slot" aria-hidden="true" />

        <div className="side-foot">
          <div className="avatar" style={{ background: user.colour ?? 'var(--s-apt)' }}>
            {user.initials}
          </div>
          <div className="who">
            <span>{user.name}</span>
            <small>{user.role}</small>
          </div>
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
              <input
                type="search"
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
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

          {notifications && (
            <button
              type="button"
              className="icon-btn"
              onClick={notifications.onOpen}
              title="Notifications"
              aria-label={
                notifications.unread
                  ? `Notifications, ${notifications.unread} unread`
                  : 'Notifications'
              }
            >
              <Icon name="bell" />
              {notifications.unread > 0 && <span className="dot" />}
            </button>
          )}

          {action}
        </header>

        <section className="view active">{children}</section>
      </main>

      <nav className="bottom-nav" aria-label="Primary mobile">
        {phoneNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? 'active' : undefined)}
          >
            <Icon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
