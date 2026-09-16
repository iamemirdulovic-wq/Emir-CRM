import { NavLink, useNavigate } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { useAuth } from '../lib/auth.js';
import { api } from '../lib/api.js';
import { locale, setLocale, t } from '../lib/i18n.js';
import { Avatar, Icon } from './ui.js';

type NavItem = { to: string; icon: string; label: string; permission?: string; managerOnly?: boolean };

const NAV: NavItem[] = [
  { to: '/board', icon: 'view_kanban', label: 'board' },
  { to: '/inbox', icon: 'forum', label: 'inbox' },
  { to: '/contacts', icon: 'contacts', label: 'contacts' },
  { to: '/projects', icon: 'apartment', label: 'projects' },
  { to: '/reports', icon: 'insights', label: 'reports', managerOnly: true },
  { to: '/templates', icon: 'description', label: 'templates', permission: 'templates:manage' },
  { to: '/team', icon: 'group', label: 'team', permission: 'users:manage' },
];

/**
 * App shell: a rail on desktop, a bottom bar on mobile. Both are driven by the
 * same permission-filtered list, so an agent never sees a page they cannot use.
 */
export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut, can } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';
  const items = NAV.filter((item) => {
    if (item.permission && !can(item.permission)) return false;
    if (item.managerOnly && !isManager) return false;
    return true;
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const toggleLocale = async () => {
    const next = locale() === 'ar' ? 'en' : 'ar';
    setLocale(next);
    /*
     * Persist to the user record too. Without this the preference is lost on
     * the next load, because the session refresh applies the server's locale.
     */
    if (user) {
      await api.patch(`/api/users/${user.id}`, { locale: next }).catch(() => {
        // A failed save still leaves the local preference applied.
      });
    }
    // Flipping direction re-lays out the whole tree; a reload is the honest way.
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen flex-col bg-sand-50 lg:flex-row">
      {/* Desktop rail */}
      <aside className="hidden w-60 shrink-0 flex-col border-e border-slate-200 bg-white lg:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Icon name="home_work" className="!text-[20px]" />
          </span>
          <div>
            <p className="text-sm font-semibold leading-tight text-slate-900">Emir CRM</p>
            <p className="text-[11px] leading-tight text-slate-500">Dubai &amp; Abu Dhabi</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3" aria-label="Primary">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <Icon name={item.icon} className="!text-[20px]" />
              {t(item.label as never)}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <Avatar name={user?.name ?? null} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{user?.name}</p>
              <p className="truncate text-xs capitalize text-slate-500">{user?.role}</p>
            </div>
          </div>
          <button type="button" className="btn-ghost w-full justify-start" onClick={() => void toggleLocale()}>
            <Icon name="translate" className="!text-[18px]" />
            {locale() === 'ar' ? 'English' : 'العربية'}
          </button>
          <button type="button" className="btn-ghost w-full justify-start" onClick={handleSignOut}>
            <Icon name="logout" className="!text-[18px]" />
            {t('signOut')}
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Icon name="home_work" className="!text-[18px]" />
          </span>
          <p className="text-sm font-semibold text-slate-900">Emir CRM</p>
        </div>
        <button type="button" className="btn-ghost !px-2" onClick={() => setMenuOpen((v) => !v)} aria-label="Account">
          <Avatar name={user?.name ?? null} size="sm" />
        </button>
      </header>

      {menuOpen ? (
        <div className="border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
          <p className="px-2 py-1 text-xs text-slate-500">
            {user?.name} · <span className="capitalize">{user?.role}</span>
          </p>
          <button type="button" className="btn-ghost w-full justify-start" onClick={() => void toggleLocale()}>
            <Icon name="translate" className="!text-[18px]" />
            {locale() === 'ar' ? 'English' : 'العربية'}
          </button>
          <button type="button" className="btn-ghost w-full justify-start" onClick={handleSignOut}>
            <Icon name="logout" className="!text-[18px]" />
            {t('signOut')}
          </button>
        </div>
      ) : null}

      <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>

      {/* Mobile bottom navigation */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Primary mobile"
      >
        {items.slice(0, 5).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                isActive ? 'text-brand-700' : 'text-slate-500'
              }`
            }
          >
            <Icon name={item.icon} className="!text-[22px]" />
            {t(item.label as never)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
