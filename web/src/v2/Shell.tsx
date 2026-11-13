import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, ToastHost } from '../design/ui.js';
import { useAuth } from '../lib/auth.js';
import {
  extraScreensFor, groupsFor, pinnedFor, PHONE_BAR, MESSAGE_ITEMS, type NavItem,
} from './nav.js';
import { Bell } from './Bell.js';
import { useCheckIn } from './check-in.js';
import { Find } from './Find.js';
import {
  barIsHiddenAt, FullAttentionProvider, PhoneHeadProvider, usePhoneHeadSlot,
  usePhoneSheets, useRiseIn,
} from './phone.js';

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
  /* S-38: on a record the title is the way back, not a label.
     `/v2/leads/new` is not a record -- it is the Add lead form, and
     `design/web/add-lead.html` draws it with a title and the line "Name,
     phone and source are needed. The rest can wait." under it, no back link.
     Without the exception it matched here, took the back link, and lost its
     sub-line with it, because a back link drops the sub (the design's own
     `buildTopbar` does the same). `lead.html` is the only page in the
     package drawn with a `data-back`. */
  const onRecord = /^\/v2\/leads\/(?!new$)[^/]+$/.test(pathname);
  /*
   * The same slot the phone header reads. The design gives nearly every page
   * a line under the title -- the date and the shift on Attendance, "62 open
   * · 12 to call today" on My leads, "10 agents · 6 in office now" on Team --
   * and for a long time the computer showed none of them: `scripts/
   * computer-proof.mjs` found it missing on 24 of the 47 pages at once.
   *
   * `app.js` in the design package leaves the sub out when the title is a
   * back link (`buildTopbar`), and so does this.
   */
  const head = usePhoneHeadSlot();

  return (
    <header className="v2-top">
      {onRecord ? (
        <Link to="/v2/leads" className="v2-back"><Icon name="arrow-left" />All leads</Link>
      ) : (
        <div className="v2-topttl">
          <h1 className="v2-title">{head.title ?? titleFor(pathname, user?.role ?? 'agent')}</h1>
          {head.sub && <p className="v2-tsub">{head.sub}</p>}
        </div>
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
/**
 * The floating bar, and the dial button beside it.
 *
 * The dial button carries the check-in gate. `docs/v2/phone-shell.md` §1.3:
 * "It always opens the power dialer — on all 64 screens, no exceptions", and
 * §5.1 puts the gate on the way. It was on the calling screen alone, so an
 * agent who started a call from anywhere else was never asked, and the record
 * an owner reads had a hole in it the shape of eleven screens.
 */
function PhoneBar() {
  const at = useLocation();
  const navigate = useNavigate();
  const gate = useCheckIn({ strip: false });

  const dial = async (e: ReactMouseEvent) => {
    e.preventDefault();
    const answer = await gate.ask();
    if (answer !== 'cancel') navigate('/v2/calling');
  };

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
      <Link to="/v2/calling" className="v2-dial" aria-label="Start calling" onClick={dial}>
        <Icon name="phone" />
      </Link>
      {gate.banner}
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
    feedback: 'Report a problem',
    dashboard: 'The full dashboard',
    'team-live': 'Team live',
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

  /*
   * `ToastHost` wraps the whole shell, and this is not decoration.
   *
   * `useToast()` reads a context. Without a host above it the call returns the
   * context's default — a function that does nothing — and it does it
   * silently. Twenty-eight v2 screens and sixty-nine call sites were pressing
   * Undo, moving leads and sending reminders with nothing on screen to say so,
   * including the one on the dashboard that takes thirty-one leads off an
   * agent. The host was mounted in the v1 layout only, which v2 does not use.
   */
  /* Sheets are dragged with a thumb, so the handlers only exist on a phone. */
  usePhoneSheets(isPhone);
  /* And the cards rise in again on every screen, not only the first. */
  const run = useRiseIn(pathname, isPhone);

  return (
    <ToastHost>
      <Counts.Provider value={counts}>
        <PhoneHeadProvider>
        <FullAttentionProvider>
          {(oneJob) => (
            <div
              className={[
                'v2',
                isPhone ? 'v2-phone' : '',
                isPhone && !oneJob && !barIsHiddenAt(pathname) ? 'v2-has-bar' : '',
              ].filter(Boolean).join(' ')}
            >
              {!isPhone && <Sidebar folded={folded} onToggle={toggleRail} />}
              <div className="v2-main">
                {!isPhone && <TopBar />}
                {/* A chat replaces the screen: `Chat.dc.html` draws its own
                    header, and the shell's would sit above it as a second
                    one. The screen says so with `useFullAttention`. */}
                {isPhone && !oneJob && <PhoneTop />}
                <main className="v2-page" key={isPhone ? run : 'wide'}><Outlet /></main>
              </div>
              {/*
                * No bar on the four full-attention screens: the dialler, a
                * chat, email and sign-in. `design/screens` draws them without
                * one on purpose — see `phone.tsx`.
                */}
              {isPhone && !oneJob && !barIsHiddenAt(pathname) && <PhoneBar />}
            </div>
          )}
        </FullAttentionProvider>
        </PhoneHeadProvider>
      </Counts.Provider>
    </ToastHost>
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
/**
 * The top of a phone screen.
 *
 * It is not an app bar. `docs/v2/phone-shell.md` §1.4: "There is no persistent
 * app bar. Each screen draws its own header as the first child of the
 * scroller, and it scrolls away." So this scrolls with the page, and what it
 * holds depends on where you are:
 *
 *  - **Home** has no title and no back: your own avatar, then search, then the
 *    bell. The screen's own greeting is the title.
 *  - **Everywhere else** opens with a round back button, then the title, then
 *    search, the bell and Add lead.
 *
 * The back button is history rather than the prototypes' hard-coded parent
 * per screen, because this is a web app where the back a person expects is
 * the one they came from.
 */
function PhoneTop() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const head = usePhoneHeadSlot();
  const atHome = pathname === '/v2';
  /* The five the bottom bar goes to are roots: there is nothing behind them
     to go back to, and the design draws no back button on any of them. */
  const isRoot = PHONE_BAR.some((one) => one.to === pathname);

  return (
    <header className={atHome ? 'v2-ptop v2-ptop-home' : 'v2-ptop'}>
      <div className="v2-ptop-row">
        {atHome ? (
          <Link to="/v2/profile" className="v2-pme" aria-label="My profile">
            <Avatar name={user?.name ?? '?'} />
          </Link>
        ) : !isRoot && (
          <button
            type="button"
            className="v2-pback"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            <Icon name="arrow-left" />
          </button>
        )}
        {head.compact
          ? (
            <h1 className="v2-title v2-ptitle-compact">
              {head.title ?? titleFor(pathname, user?.role ?? 'agent')}
            </h1>
          )
          : <span className="v2-pgrow" />}
        {/* `Main.dc.html` puts the check-in state in the home header, where
            an agent sees it before anything else. Same control the computer
            header carries, same address. */}
        {atHome && user?.role === 'agent' && (
          <Link to="/v2/attendance" className="v2-checkin v2-checkin-out">
            <Icon name="clock-3" />Check in
          </Link>
        )}
        {!head.compact && <Find compact />}
        {!head.compact && <Bell />}
        {head.compact && !head.action && <span className="v2-pspace" />}
        {/*
          * §1.4: "an optional single round action button sits on the right".
          * One, and the screen's own — not an Add lead on a business card.
          * A screen declares it with `usePhoneHead`.
          */}
        {head.action && (
          head.action.to
            ? (
              <Link to={head.action.to} className="v2-padd" aria-label={head.action.label}>
                <Icon name={head.action.icon as IconName} />
              </Link>
            )
            : (
              <button
                type="button"
                className="v2-padd"
                aria-label={head.action.label}
                onClick={head.action.onClick}
              >
                <Icon name={head.action.icon as IconName} />
              </button>
            )
        )}
      </div>
      {/* §1.4 pattern B: the title is its own line under the buttons, at
          30px, not a label squeezed between them, and under it the live
          count the design puts there rather than in a strip of its own. */}
      {!atHome && !head.compact && (
        <>
          <h1 className="v2-title">{head.title ?? titleFor(pathname, user?.role ?? 'agent')}</h1>
          {head.sub && <p className="v2-psub">{head.sub}</p>}
        </>
      )}
      {head.compact && head.sub && <p className="v2-psub v2-psub-compact">{head.sub}</p>}
    </header>
  );
}

/**
 * The order `Menu.dc.html` puts the tools in, and the three headings it
 * groups them under.
 *
 * The design does not group by topic — it groups by *who a tool is for*:
 * OWNER & ADMIN, MY WORK, TEAM. That is a different answer from the
 * sidebar's, and a better one on a phone, where an agent scrolling past
 * eleven owner tools to reach the calendar is the whole problem.
 *
 * These are addresses, not labels. What each one is called, which icon it
 * carries and who may open it stay in `nav.ts`, so a tool renamed there is
 * renamed here, and a tool an agent may not open never reaches this list.
 * Anything `nav.ts` offers that the design does not name still appears, in a
 * block at the end — a tool dropped silently is a tool nobody finds.
 */
const MENU_BLOCKS: { label: string; ownerOnly?: boolean; routes: (string | NavItem)[] }[] = [
  {
    label: 'Owner & admin',
    ownerOnly: true,
    routes: [
      '/v2', '/v2/dashboard',
      /*
       * Not in `nav.ts`, on purpose: putting it there would add a row to the
       * computer's sidebar, and the promise is that 768px and wider does not
       * change. The phone menu is the only way to it for now.
       */
      { to: '/v2/vip', label: 'VIP leads I gave', icon: 'star' },
      '/v2/leads', '/v2/import', '/v2/incoming',
      '/v2/attendance', '/v2/team-live', '/v2/activity', '/v2/messaging',
      '/v2/projects/manage', '/v2/settings/banners', '/v2/settings/desks',
      '/v2/settings/feedback', '/v2/settings/team',
      /* The design keeps these inside Settings; our menu offers each as its
         own tile, so they belong in the owner's block rather than in the
         leftovers at the foot. */
      '/v2/automations', '/v2/settings/attendance', '/v2/settings/company',
      '/v2/settings/ai', '/v2/settings/health',
    ],
  },
  {
    label: 'My work',
    routes: [
      '/v2/tasks?tab=follow-ups', '/v2/transfers', '/v2/pipeline', '/v2/inbox',
      '/v2/calendar', '/v2/tasks', '/v2/projects', '/v2/ai', '/v2/calling',
      '/v2/email', '/v2/templates', '/v2/offers',
    ],
  },
  {
    label: 'Team',
    routes: [
      '/v2/team', '/v2/wall', '/v2/best', '/v2/attendance', '/v2/feedback',
      '/v2/notifications', '/v2/settings',
    ],
  },
];

/**
 * The phone's More screen — `Menu.dc.html`.
 *
 * Tiles, three across, in the design's three blocks, with everything the
 * sidebar holds on a computer plus everything the command palette holds.
 *
 * It was a list of rows, which is the computer shape and reaches about a
 * third as many tools per screen of thumb-travel.
 */
export function V2More() {
  const { user, signOut } = useAuth();
  const role = user?.role ?? 'agent';
  const counts = useContext(Counts);
  const navigate = useNavigate();
  const leave = () => {
    void signOut().then(() => navigate('/login', { replace: true }));
  };

  /* Everything this person may open, each tool once, in the menu's order. */
  const all: NavItem[] = [];
  const have = new Set<string>();
  for (const one of [
    ...groupsFor(role).flatMap((group) => group.items),
    ...MESSAGE_ITEMS,
    ...pinnedFor(role),
    ...extraScreensFor(role),
  ]) {
    if (have.has(one.to)) continue;
    have.add(one.to);
    all.push(one);
  }

  const inOffice = role === 'owner' || role === 'admin';
  const placed = new Set<string>();
  const blocks = MENU_BLOCKS.filter((block) => inOffice || !block.ownerOnly).map((block) => {
    const items: NavItem[] = [];
    for (const one of block.routes) {
      const to = typeof one === 'string' ? one : one.to;
      if (placed.has(to)) continue;
      const found = typeof one === 'string' ? all.find((x) => x.to === to) : one;
      if (!found) continue;
      placed.add(to);
      items.push(found);
    }
    return { label: block.label, items, key: block.label };
  });
  /* Whatever the design does not name, rather than losing it. */
  blocks.push({
    label: 'Everything else',
    items: all.filter((one) => !placed.has(one.to)),
    key: 'rest',
  });

  /* A tool reached from two places is still one tool. */
  const seen = new Set<string>();

  return (
    <div className="v2-more">
      {/* The design puts the person and the search box above the tiles: who
          you are signed in as, then the way to anything not on this screen. */}
      <Link to="/v2/profile" className="v2-me-row">
        <Avatar name={user?.name ?? '?'} />
        <span className="d-grow">
          <b>{user?.name ?? 'My profile'}</b>
          <span>{role.charAt(0).toUpperCase() + role.slice(1)}</span>
        </span>
        <Icon name="chevron-right" />
      </Link>

      <Link to="/v2/search" className="v2-more-find">
        <Icon name="search" />
        Search leads, projects, screens
      </Link>

      {blocks.map((block) => {
        const items = block.items.filter((one) => {
          const key = `${one.to}|${one.label}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (items.length === 0) return null;
        return (
          <section key={block.key}>
            <h2 className="v2-tiles-head">{block.label}</h2>
            <div className="v2-tiles">
              {items.map((item) => {
                const n = 'badge' in item && item.badge ? counts[item.badge] ?? 0 : 0;
                return (
                  <NavLink key={`${item.to}|${item.label}`} to={item.to} className="v2-tile">
                    <Icon name={item.icon} />
                    <span className="v2-tile-label">{item.label}</span>
                    {n > 0 && (
                      <span
                        className={'urgent' in item && item.urgent
                          ? 'v2-tile-badge v2-tile-urgent' : 'v2-tile-badge'}
                      >
                        {n}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* The design's last control on this screen, and the only way out of
          the app on a phone — there is no sidebar to hold it. */}
      {/*
        * `/logout` is not a route — the one in Settings has been a dead link.
        * Signing out is a call, then back to the sign-in page.
        */}
      <button type="button" className="v2-me-row v2-signout" onClick={leave}>
        <Icon name="log-out" />
        <span className="d-grow"><b>Sign out</b></span>
      </button>
    </div>
  );
}

