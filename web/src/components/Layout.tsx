import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { t } from '../lib/i18n.js';
import { useAsync } from '../lib/hooks.js';
import { AppShell, Icon, type NavItem } from '../design/index.js';
import { ToastHost, useToast } from '../design/ui.js';
import { avatarColour, initials } from '../design/stages.js';
import type { Conversation, Role, TasksResponse } from '../lib/types.js';

/**
 * The signed-in shell: which nav a role sees, what the top bar says, and the
 * search box, which belongs to the shell in the design but is used by whichever
 * screen is showing.
 */

const SearchContext = createContext<{ value: string; set: (value: string) => void }>({
  value: '',
  set: () => undefined,
});

/** The top bar's search term. Screens that ignore it simply do not call this. */
export function useShellSearch() {
  return useContext(SearchContext);
}

interface Entry {
  to: string;
  label: string;
  icon: NavItem['icon'];
  title: string;
  /** Roles that see this item; everyone when omitted. */
  roles?: Role[];
  /** Also shown in the phone bar. */
  phone?: boolean;
}

const ENTRIES: Entry[] = [
  { to: '/dashboard', label: t('dashboard'), icon: 'layout-dashboard', title: t('dashboard'), phone: true },
  { to: '/pipeline', label: t('pipeline'), icon: 'kanban', title: t('pipeline'), phone: true },
  { to: '/inbox', label: t('inbox'), icon: 'message-circle', title: t('inbox'), phone: true },
  { to: '/contacts', label: t('contacts'), icon: 'users', title: t('contacts') },
  { to: '/tasks', label: t('tasks'), icon: 'check-square', title: t('tasks'), phone: true },
  { to: '/lists', label: t('lists'), icon: 'list', title: t('lists') },
  { to: '/campaigns', label: t('campaigns'), icon: 'megaphone', title: t('campaigns') },
  { to: '/pool', label: t('pool'), icon: 'inbox', title: t('pool'), roles: ['agent'] },
  { to: '/projects', label: t('projects'), icon: 'building-2', title: t('projects') },
  {
    to: '/automations',
    label: t('automations'),
    icon: 'zap',
    title: t('automations'),
    roles: ['owner', 'admin', 'manager'],
  },
  { to: '/settings', label: t('settings'), icon: 'settings', title: t('settings'), phone: true },
];

/** The heading for a path, including the detail routes that are not in the nav. */
function titleFor(pathname: string): string {
  if (pathname.startsWith('/contacts/')) return 'Contact';
  if (pathname.startsWith('/imports')) return 'Import';
  if (pathname.endsWith('/dial')) return 'Calling';
  const entry = ENTRIES.find((item) => pathname.startsWith(item.to));
  return entry?.title ?? 'Emir CRM';
}

export function Layout() {
  return (
    <ToastHost>
      <Chrome />
    </ToastHost>
  );
}

function Chrome() {
  const { user, signOut, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [search, setSearch] = useState('');

  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';

  // Badge counts. Cheap queries, and an agent's first question on opening the
  // app is "what is waiting for me?". The scope matches what the Inbox screen
  // itself defaults to, so the badge and the list never disagree: managers see
  // their team's unread, agents their own. "all" is rejected for an agent, so
  // the role has to decide here rather than always asking for everything.
  const conversations = useAsync<{ items: Conversation[] }>(
    () =>
      api.get(
        `/api/inbox/conversations${qs({
          filter: isManager ? 'all' : 'mine',
          unread: '1',
          pageSize: 100,
        })}`,
      ),
    [location.pathname, isManager],
  );
  const tasks = useAsync<TasksResponse>(() => api.get('/api/tasks?filter=overdue&limit=1'), [location.pathname]);

  const unread = (conversations.data?.items ?? []).reduce(
    (sum, conversation) => sum + Number(conversation.unread_count ?? 0),
    0,
  );
  const overdue = tasks.data?.counts.overdue ?? 0;

  const visible = useMemo(
    () => ENTRIES.filter((entry) => !entry.roles || (user && entry.roles.includes(user.role))),
    [user],
  );

  const badge = (to: string) => (to === '/inbox' ? unread : to === '/tasks' ? overdue : undefined);

  const nav: NavItem[] = visible.map((entry) => ({
    to: entry.to,
    label: entry.label,
    icon: entry.icon,
    badge: badge(entry.to),
  }));

  const mobileNav = visible
    .filter((entry) => entry.phone)
    .slice(0, 5)
    .map((entry) => ({
      to: entry.to,
      label: entry.label,
      icon: entry.icon,
      badge: badge(entry.to),
    }));

  const setAvailability = useCallback(
    async (available: boolean) => {
      if (!user) return;
      try {
        await api.patch(`/api/users/${user.id}`, { availability: available ? 'available' : 'busy' });
        await refresh();
        toast(available ? 'You are back in the rotation' : 'Paused — no new leads will be assigned to you');
      } catch {
        toast('Could not change your availability');
      }
    },
    [user, refresh, toast],
  );

  if (!user) return null;

  // Only agents are in the assignment rotation, so only they get the switch.
  const availability =
    user.role === 'agent'
      ? { available: user.availability !== 'busy' && user.availability !== 'off', onChange: setAvailability }
      : undefined;

  return (
    <AppShell
      title={titleFor(location.pathname)}
      nav={nav}
      mobileNav={mobileNav}
      user={{
        name: user.name,
        role: user.role.replace(/^\w/, (c) => c.toUpperCase()),
        initials: initials(user.name),
        colour: avatarColour(user.id),
      }}
      onSignOut={() => {
        void signOut().then(() => navigate('/login', { replace: true }));
      }}
      search={{ value: search, onChange: setSearch }}
      availability={availability}
      notifications={{ unread, onOpen: () => navigate('/inbox') }}
      action={
        <button type="button" className="btn btn-primary" onClick={() => navigate('/contacts?new=1')}>
          <Icon name="plus" />
          <span>{t('addLead')}</span>
        </button>
      }
    >
      <SearchContext.Provider value={{ value: search, set: setSearch }}>
        <Outlet />
      </SearchContext.Provider>
    </AppShell>
  );
}
