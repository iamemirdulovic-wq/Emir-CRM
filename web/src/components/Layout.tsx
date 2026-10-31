import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AskEmirAi } from './AskEmirAi.js';
import { NewLeadCard } from './NewLeadCard.js';
import { InstallPrompt } from './InstallPrompt.js';
import { Bell } from './Bell.js';
import { AddLead } from './AddLead.js';
import { play, setSoundEnabled, soundEnabled } from '../lib/sound.js';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { t } from '../lib/i18n.js';
import { useAsync } from '../lib/hooks.js';
import { AppShell, Icon, type NavItem } from '../design/index.js';
import { ToastHost, useToast } from '../design/ui.js';
import { avatarColour, initials } from '../design/stages.js';
import type { Conversation, Role, TasksResponse } from '../lib/types.js';
import { BRAND } from '../brand.js';
import { useHeartbeat } from '../lib/heartbeat.js';
import { CommandLayer } from './CommandLayer.js';

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
  /*
   * First in the list, and only for the people who can act on it: a lead
   * sitting here has nobody working it, which beats everything else on the
   * screen for urgency.
   */
  {
    to: '/incoming',
    label: t('incoming'),
    icon: 'inbox',
    title: t('incoming'),
    roles: ['owner', 'admin', 'manager'],
    phone: true,
  },
  { to: '/dashboard', label: t('dashboard'), icon: 'layout-dashboard', title: t('dashboard'), phone: true },
  /*
   * My Leads sits directly under the Dashboard, because it is the screen an
   * agent opens next and the one they come back to all day. Owners and
   * admins see everyone's, so it is simply "Leads" for them.
   */
  { to: '/leads', label: t('myLeads'), icon: 'users', title: t('myLeads'), phone: true },
  /* The same screen, opened on the tab that is the agent's whole morning. */
  { to: '/leads?tab=today', label: t('followUps'), icon: 'calendar-check', title: t('followUps') },
  { to: '/pipeline', label: t('pipeline'), icon: 'kanban', title: t('pipeline'), phone: true },
  { to: '/inbox', label: t('inbox'), icon: 'message-circle', title: t('inbox'), phone: true },
  { to: '/tasks', label: t('tasks'), icon: 'check-square', title: t('tasks'), phone: true },
  { to: '/lists', label: t('lists'), icon: 'list', title: t('lists') },
  { to: '/campaigns', label: t('campaigns'), icon: 'megaphone', title: t('campaigns') },
  {
    to: '/email-campaigns',
    label: t('emailCampaigns'),
    icon: 'mail',
    title: t('emailCampaigns'),
    roles: ['owner', 'admin', 'manager'],
  },
  { to: '/pool', label: t('pool'), icon: 'inbox', title: t('pool'), roles: ['agent'] },
  { to: '/wall', label: t('teamWall'), icon: 'message-square-heart', title: t('teamWall'), phone: true },
  { to: '/projects', label: t('projects'), icon: 'building-2', title: t('projects') },
  { to: '/offers', label: t('offers'), icon: 'sparkles', title: t('offers') },
  {
    to: '/automations',
    label: t('automations'),
    icon: 'zap',
    title: t('automations'),
    roles: ['owner', 'admin', 'manager'],
  },
  {
    to: '/team-activity',
    label: t('teamActivity'),
    icon: 'users-round',
    title: t('teamActivity'),
    roles: ['owner', 'admin', 'manager'],
  },
  { to: '/audit', label: t('auditLog'), icon: 'shield', title: t('auditLog'), roles: ['owner'] },
  { to: '/settings', label: t('settings'), icon: 'settings', title: t('settings'), phone: true },
];

/** The heading for a path, including the detail routes that are not in the nav. */
function titleFor(pathname: string): string {
  if (pathname.startsWith('/contacts/')) return 'Lead';
  if (pathname.startsWith('/leads')) return 'My Leads';
  if (pathname.startsWith('/imports')) return 'Import';
  if (pathname.endsWith('/dial')) return 'Calling';
  /* Reached from the name at the bottom of the sidebar rather than from the
     navigation, so there is no entry to take the heading from — and without
     this the page was headed with the product's name instead of its own. */
  if (pathname.startsWith('/profile')) return 'My profile';
  if (pathname.startsWith('/tools/business-card')) return 'Business cards';
  if (pathname.startsWith('/dev/')) return 'Components';
  const entry = ENTRIES.find((item) => pathname.startsWith(item.to));
  return entry?.title ?? BRAND.name;
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

  /* Tells the server this browser is still here, every thirty seconds and
     only while the tab is visible — which is what makes "active minutes" in
     the reports mean anything. */
  useHeartbeat(Boolean(user));
  const location = useLocation();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [soundOn, setSoundOn] = useState(soundEnabled);
  /* The Add lead button used to navigate to /contacts?new=1, which no
     screen read — it did nothing at all. */
  const [adding, setAdding] = useState(false);

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
  /*
   * Its own endpoint rather than counting the list: this runs on every page
   * for everyone who can see it, and the list behind it is four joins. The
   * server answers 0 for an agent, so no role check is needed here.
   */
  const incoming = useAsync<{ count: number }>(() => api.get('/api/incoming/count'), [location.pathname]);

  const unread = (conversations.data?.items ?? []).reduce(
    (sum, conversation) => sum + Number(conversation.unread_count ?? 0),
    0,
  );
  const overdue = tasks.data?.counts.overdue ?? 0;

  const visible = useMemo(
    () => ENTRIES.filter((entry) => !entry.roles || (user && entry.roles.includes(user.role))),
    [user],
  );

  const waiting = incoming.data?.count ?? 0;

  const badge = (to: string) => {
    if (to === '/inbox') return unread;
    if (to === '/tasks') return overdue;
    if (to === '/incoming') return waiting;
    return undefined;
  };

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
      sound={{
        on: soundOn,
        onChange: (on) => {
          setSoundEnabled(on);
          setSoundOn(on);
          /* Play it when switching on, so the agent hears what they agreed to. */
          if (on) play('notify');
        },
      }}
      mobileAction={{ label: t('addLead'), icon: 'plus', onClick: () => setAdding(true) }}
      bell={<Bell />}
      action={
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          <span>{t('addLead')}</span>
        </button>
      }
    >
      <SearchContext.Provider value={{ value: search, set: setSearch }}>
        {/*
          * One keyboard listener for the whole app, and the three things it
          * opens: Cmd+K, the shortcut list and the tour. It wraps the screen
          * rather than sitting beside it so a screen can hand it shortcuts of
          * its own — the lead page lends C, W and E.
          */}
        <CommandLayer
          role={user.role}
          onAddLead={() => setAdding(true)}
          onToggleSound={() => {
            const next = !soundOn;
            setSoundEnabled(next);
            setSoundOn(next);
            if (next) play('notify');
          }}
          onSignOut={() => {
            void signOut().then(() => navigate('/login', { replace: true }));
          }}
        >
          <Outlet />
        </CommandLayer>
        {/*
          * On every screen, because an agent looking at yesterday's pipeline
          * still has five minutes to accept the lead that just landed. It
          * asks only for leads the signed-in person owns, so for anyone who
          * never holds one there is nothing to show and no role check here.
          */}
        <NewLeadCard />
        {/* Asked once, on the second visit. */}
        <InstallPrompt />
        <AddLead open={adding} onClose={() => setAdding(false)} />
        {/* On every CRM screen, as the design has it. */}
        <AskEmirAi />
      </SearchContext.Provider>
    </AppShell>
  );
}
