import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote, budgetLabel, useToast } from '../design/ui.js';
import { spacedE164 } from '../design/phone.js';
import { usePhoneHead } from './phone.js';
import { useCallAction, type CallActions } from './call.js';
import { SOURCE_STYLES } from '../design/stages.js';
import { clockIn, originOf } from '../lib/dialling.js';
import { given, groupByGivenDay } from '../lib/assigned.js';

/**
 * The leads list, built from the design package.
 *
 * Two screens live behind this one address, exactly as the design draws them:
 *
 *   - `design/web/my-leads.html` — the working list. Pill tabs, the "start
 *     calling" strip, one row per lead with the local clock and what is owed
 *     next. This is every tab but All.
 *   - `design/web/all-leads.html` — the whole book. The same table with the
 *     agent and the last contact in it, and a wider filter row above. This is
 *     the All tab (and Hot, which arrives from the dashboard as a chip over
 *     All).
 *
 * Both are the design's own markup: `d-` classes from `v2-ui.css`, and the
 * page root carries `p-my-leads` or `p-all-leads` so that page's own ported
 * stylesheet applies. It was built once from the written spec instead and came
 * out in the right colours with an invented layout; the design file is the
 * only source for the shape of this screen.
 *
 * The two things that matter most about the behaviour, because the live CRM
 * got both wrong:
 *
 *   - the count says how many you are looking at out of how many there are.
 *     "419" above a list of thirty is what Emir reported on 11 November.
 *   - every row carries its own record. The link, the call and the WhatsApp
 *     button all take this lead's id from this row, never from anything
 *     remembered elsewhere.
 */

/**
 * Under this, the phone layout — `design/screens/Leads.dc.html` and
 * `AllLeads.dc.html` rather than the two computer tables.
 *
 * The shell keeps its own copy of this number and this hook in `Shell.tsx`,
 * which this group may not edit, and `Inbox.tsx` keeps a third for the same
 * reason. Six lines repeated beats four people editing one file.
 */
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
 * The tab strip. Two of them, because there are two screens here.
 *
 * `my-leads.html` is the agent's working list and opens on Today. The owner's
 * `all-leads.html` has no Today and no New at all — their screen is the whole
 * book, and the tab beside All is "Going cold". The build left the agent's
 * tabs on the owner's page and opened them on Today, so an owner pressing
 * "All leads" in the sidebar landed on a call list of the handful of leads
 * they personally hold, with "Start calling" and "Free leads" on it. Their
 * 863 were behind the All tab, and so were the agent filter and the Agent
 * column. That is the first thing the owner reported.
 *
 * `hot` is a chip over All rather than a tab, which is how the dashboards
 * link to it.
 */
export const AGENT_TABS: Array<{ key: TabKey; label: string; red?: boolean }> = [
  { key: 'today', label: 'Today' },
  { key: 'new', label: 'New' },
  { key: 'overdue', label: 'Overdue', red: true },
  { key: 'no_next_step', label: 'No next step' },
  { key: 'vip', label: 'VIP' },
  { key: 'lost', label: 'Lost' },
  { key: 'won', label: 'Won' },
  { key: 'all', label: 'All' },
];

export const OWNER_TABS: Array<{ key: TabKey; label: string; red?: boolean }> = [
  { key: 'all', label: 'All' },
  { key: 'cold', label: 'Going cold' },
  { key: 'overdue', label: 'Overdue', red: true },
  { key: 'no_next_step', label: 'No next step' },
  { key: 'vip', label: 'VIP' },
  { key: 'lost', label: 'Lost' },
  { key: 'won', label: 'Won' },
];

export type TabKey =
  | 'today' | 'new' | 'hot' | 'cold' | 'overdue' | 'no_next_step' | 'vip' | 'lost' | 'won' | 'all';

const PAGE = 50;

/** What one press of "Move N leads" may carry. The server's own ceiling. */
const MOVE_LIMIT = 200;

/** The six stages, as the design's neutral pills. */
const STAGE_LABEL: Record<string, string> = {
  new_lead: 'New',
  attempted_contact: 'Called',
  engaged_qualified: 'Interested',
  appointment_scheduled: 'Meeting',
  deal_sent: 'Offer',
  won: 'Won',
  lost: 'Lost',
};

/** `chip stage-*` in the design; the pill's dot colour comes from the key. */
const STAGE_CHIP: Record<string, string> = {
  new_lead: 'new',
  attempted_contact: 'called',
  engaged_qualified: 'interested',
  appointment_scheduled: 'meeting',
  deal_sent: 'offer',
  won: 'won',
  lost: 'lost',
};

interface Row {
  id: string;
  contact_id: string;
  full_name: string | null;
  phone_e164: string | null;
  project_name: string | null;
  unit_type: string | null;
  budget_min_aed: number | null;
  budget_max_aed: number | null;
  budget_band?: string | null;
  source: string | null;
  stage_key: string;
  status: string;
  is_vip: number;
  returned_at: string | null;
  next_step_at: string | null;
  next_step_note: string | null;
  last_contact_at: string | null;
  /**
   * When this lead was given to the agent who holds it — `assigned_at`.
   *
   * Null when it has never been given out, or has gone back to the pool. It
   * is never stood in for by `created_at`: see `lib/assigned.ts`.
   */
  assigned_at: string | null;
  owner_name: string | null;
}

interface ListResponse {
  tab: string;
  items: Row[];
  total: number;
  empty: { title: string; hint: string };
}

interface Person {
  id: string;
  name: string;
  role: string;
  is_active: number;
}

/** One row of the "Move to" list — `/api/v2/transfers/who`. */
interface Taker {
  id: string;
  name: string;
  photoUrl: string | null;
  openLeads: number;
  languages: string[];
  markedToday: string | null;
  onLeave: boolean;
  maxOpenLeads: number | null;
}

/**
 * What the next-step column says, and whether it is red.
 *
 * Red means late, or waiting on you — the same rule as the sidebar badges, so
 * the colour means one thing across the whole product.
 */
function nextStep(row: Row): { text: string; urgent: boolean; none: boolean } {
  if (row.returned_at) return { text: 'Came back to you', urgent: true, none: false };
  if (row.is_vip === 1 && !row.last_contact_at) {
    return { text: 'VIP — not called yet', urgent: true, none: false };
  }
  if (!row.next_step_at) return { text: 'No next step', urgent: false, none: true };
  const due = new Date(row.next_step_at);
  const late = due.getTime() < Date.now();
  const when = due.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const note = row.next_step_note ? ` · ${row.next_step_note}` : '';
  return { text: `${late ? 'Overdue' : 'Due'} ${when}${note}`, urgent: late, none: false };
}

/**
 * The human reason this lead is in front of you, for the phone card.
 *
 * `Leads.dc.html` writes a sentence here — "VIP · call within 24 min",
 * "Follow-up overdue since 11:00", "No next step · plan one" — and colours it
 * by how late it is. Every branch below is built from a column the list
 * endpoint really sends; nothing is guessed.
 */
function reason(row: Row): { text: string; tone: 'red' | 'amber' | 'calm' } {
  const clock = (value: string) => new Date(value).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  if (row.status === 'lost') return { text: 'Lost', tone: 'calm' };
  if (row.returned_at) return { text: 'Came back to you · give it again', tone: 'red' };
  if (row.is_vip === 1 && !row.last_contact_at) {
    return { text: 'VIP · not called yet', tone: 'red' };
  }
  if (!row.next_step_at) {
    return {
      text: row.last_contact_at ? 'No next step · plan one' : 'Not called yet',
      tone: 'amber',
    };
  }

  const due = new Date(row.next_step_at);
  const note = row.next_step_note ? ` · ${row.next_step_note}` : '';
  if (due.getTime() < Date.now()) {
    const sameDay = Math.floor((due.getTime() + 4 * 3_600_000) / 86_400_000)
      === Math.floor((Date.now() + 4 * 3_600_000) / 86_400_000);
    return {
      text: sameDay
        ? `Follow-up overdue since ${clock(row.next_step_at)}${note}`
        : `Follow-up overdue since ${due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${note}`,
      tone: 'red',
    };
  }
  return { text: `Next ${whenShort(row.next_step_at)}${note}`, tone: 'calm' };
}

/** "Today 10:30", "Yesterday", "9 Nov" — the design's own shorthand. */
function whenShort(value: string | null): string {
  if (!value) return 'Not yet';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return 'Not yet';
  const day = (d: Date) => Math.floor((d.getTime() + 4 * 3_600_000) / 86_400_000);
  const today = day(new Date());
  const was = day(at);
  const clock = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (was === today) return `Today ${clock}`;
  if (was === today - 1) return 'Yesterday';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * "Given to you 11:42" — when this lead was handed over.
 *
 * Talha's own words, 14 Nov 2026, over a screenshot of 105 new leads in which
 * every card was identical: *"you need to put dates on the leads once they
 * assign, so we know which one is today leads, which one is yesterday, and
 * which one is day before yesterday."*
 *
 * Today shows the time alone; anything older shows the day, the time and how
 * long it has been sitting, in warm amber — so a two-day-old lead with no call
 * on it looks wrong at a glance. `label` is the prefix: "Given to you" on an
 * agent's own list, nothing in a column that is already headed.
 */
function GivenLine({ at, label }: { at: string | null; label?: string }) {
  const line = given(at);
  return (
    <span
      className={line.stale ? 'v2-given v2-given-old' : line.missing ? 'v2-given v2-given-none' : 'v2-given'}
      title={line.exact ?? undefined}
    >
      {label && !line.missing ? `${label} ` : ''}{line.text}
    </span>
  );
}

/** The second line of the project cell: what they asked for. */
function wanted(row: Row): string {
  const budget = row.budget_min_aed || row.budget_max_aed
    ? budgetLabel(row.budget_min_aed, row.budget_max_aed, row.budget_band ?? null)
    : null;
  return [row.unit_type, budget].filter(Boolean).join(' · ');
}

export function V2Leads({ fixedTab }: { fixedTab?: TabKey } = {}) {
  const isPhone = useIsPhone();
  /*
   * One of these for the whole screen, handed down to the cards, the rows and
   * the panel. Not one per row: the helper's check-in gate reads
   * `/api/attendance/today`, and a hook inside `LeadRow` would ask for it
   * fifty times on a list of fifty leads.
   */
  const dial = useCallAction({ source: 'lead' });
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  /* Follow-ups is this screen opened on what is late. The tab is then not the
     reader's to change, so the URL does not decide it. */
  /*
   * `AllLeads.dc.html` is what an owner's Leads opens on — the prototype's
   * own router sends an owner's `Leads.dc.html` link to `AllLeads.dc.html`,
   * and the phone design draws no Today tab for them. The computer page
   * still opens on Today, so only the phone changes; see
   * `docs/v2/phone-questions-a.md` §4, which is still open.
   */
  /*
   * Whose screen this is. An owner, an admin or a manager holds everybody's
   * leads, so their screen is the whole book and it opens on it — on the
   * computer as well as on the phone, which is the fault the owner found.
   */
  const owns = user ? user.role !== 'agent' : false;
  const firstTab: TabKey = owns ? 'all' : 'today';
  const tabs = owns ? OWNER_TABS : AGENT_TABS;
  const tab = (fixedTab ?? (params.get('tab') as TabKey) ?? firstTab) as TabKey;
  const [search, setSearch] = useState('');
  /* Rows fetched by "Show more", tied to the query they belong to: a different
     tab or filter is a different list, and the old pages must not be shown
     under it. */
  const [extra, setExtra] = useState<{ key: string; rows: Row[]; pages: number }>(
    { key: '', rows: [], pages: 1 },
  );
  const [loadingMore, setLoadingMore] = useState(false);
  /*
   * Select-to-move, on the owner's All leads — `AllLeads.dc.html`. Off until
   * the owner asks for it, because a checkbox on every row turns a list you
   * read into a form you fill in.
   */
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, string>>({});
  /*
   * The computer's own three controls, which only ever existed in the phone
   * branch and so could not be reached on a computer at all: the row menu,
   * the 480px side panel a row click opens, and "select the whole list"
   * rather than the page.
   */
  const [menuAt, setMenuAt] = useState<{ row: Row; x: number; y: number } | null>(null);
  const [panelFor, setPanelFor] = useState<Row | null>(null);
  const [wholeList, setWholeList] = useState<string[] | null>(null);
  /* The second tap on "Move N leads to X". The design asks twice for this one
     because it is the one action on the screen that moves somebody else's
     work. */
  const [armed, setArmed] = useState(false);
  const toast = useToast();
  /* On a phone the seven pills do not fit, so the strip scrolls. Landing on
     All with "Today, New, Overdue" on screen reads as the wrong tab being
     open, so the one that is open is brought into view. */
  const tabStrip = useRef<HTMLDivElement>(null);

  const stage = params.get('stage') ?? '';
  const project = params.get('project') ?? '';
  const agent = params.get('agent') ?? '';
  const source = params.get('source') ?? '';

  /* The All tab is the whole book, so it is the wide screen with the agent in
     it. Hot arrives from the dashboard; the design shows it as a chip over
     All rather than a tab of its own. */
  /*
   * `owns` is in here because an owner's screen is the wide one on every tab,
   * not only on All. Without it an owner pressing "Going cold" dropped back
   * to the agent's narrow table — no Agent column, no tick boxes — which is
   * the same fault in a different place.
   */
  const wide = owns || tab === 'all' || tab === 'hot';
  const isAgent = user?.role === 'agent';
  /* The whole book, not one person's share of it. */
  const book = wide && !isAgent;

  /*
   * How wide a day heading has to stretch across the table.
   *
   * Counted from the same conditions that draw the `<th>`s, right here, so
   * that adding or dropping a column cannot leave the heading short and the
   * group separator ending halfway across the row.
   *
   *   tick box · Lead · Phone · Project · Stage · Given
   *   then: the owner's Agent and Last contact, or the agent's Local time
   *   then: next step, and on the agent's list the actions cell
   */
  const columns = (book ? 1 : 0) + 5
    + (wide ? (isAgent ? 1 : 2) : 1)
    + 1 + (wide ? 0 : 1);

  const qs = useMemo(() => {
    const next = new URLSearchParams();
    next.set('tab', tab);
    next.set('pageSize', String(PAGE));
    if (search.trim()) next.set('search', search.trim());
    if (stage) next.set('stage', stage);
    if (project) next.set('project', project);
    if (agent) next.set('agent', agent);
    if (source) next.set('source', source);
    return next.toString();
  }, [tab, search, stage, project, agent, source]);

  const leads = useAsync<ListResponse>(() => api.get(`/api/my-leads?${qs}`), [qs]);
  const counts = useAsync<Record<string, number>>(() => api.get('/api/my-leads/counts'), []);
  /*
   * The projects the leads are actually on — not the library.
   *
   * This control used to be filled from `/api/projects`, which lists the
   * project library. `projects.name` has no unique key (only `slug`), so a
   * project entered twice appeared twice — that is the "Sei Saadiyat, twice"
   * the owner saw — and a library project nobody has enquired about was an
   * option that returned nothing. Both halves are now one query over the
   * leads themselves, grouped the same way the filter matches.
   */
  const projects = useAsync<{ items: Array<{ name: string; leads: number }> }>(
    () => api.get('/api/my-leads/projects'), [],
  );
  /* Who to narrow by. Only the wide screen has the control, and an agent never
     sees it — they only ever hold their own leads. */
  const people = useAsync<{ items: Person[] }>(
    () => (wide && !isAgent ? api.get('/api/users') : Promise.resolve({ items: [] })),
    [wide, isAgent],
  );
  /* Who a lead may be moved to, with their open-lead counts and whether they
     are in today — the "Move to" list the design draws. */
  const takerList = useAsync<{ items: Taker[] }>(
    () => (isAgent ? Promise.resolve({ items: [] }) : api.get('/api/v2/transfers/who')),
    [isAgent],
  );

  /* Re-run when the counts land: they widen every pill, so a strip centred
     before they arrived is no longer centred on anything. */
  useEffect(() => {
    const open = tabStrip.current?.querySelector('[aria-selected="true"]');
    open?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [tab, counts.data]);

  function narrow(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  function chooseTab(key: TabKey) {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    setParams(next, { replace: true });
  }

  function clearAll() {
    const next = new URLSearchParams(params);
    for (const key of ['stage', 'project', 'agent', 'source']) next.delete(key);
    if (tab === 'hot') next.set('tab', 'all');
    setParams(next, { replace: true });
    setSearch('');
  }

  const loaded = extra.key === qs ? extra : { key: qs, rows: [] as Row[], pages: 1 };

  async function showMore() {
    setLoadingMore(true);
    try {
      const page = loaded.pages + 1;
      const batch = await api.get<ListResponse>(`/api/my-leads?${qs}&page=${page}`);
      setExtra({ key: qs, rows: [...loaded.rows, ...batch.items], pages: page });
    } catch {
      /* The rows already on screen are still good; pressing again retries. */
    } finally {
      setLoadingMore(false);
    }
  }

  const rows = leads.data ? [...leads.data.items, ...loaded.rows] : [];
  const total = leads.data?.total ?? 0;
  const todayCount = counts.data?.today ?? 0;

  /*
   * The same list, cut into the days the leads were given out on.
   *
   * Newest day first, "Not given out yet" last, and the order inside each day
   * left exactly as the server sent it — the tab decides that, and an agent
   * works down it.
   */
  const byDay = groupByGivenDay(rows, (row) => row.assigned_at);

  /* One chip per narrowing in force, which is how the design says what the
     list is showing without making anybody read the controls. */
  const chips: Array<{ key: string; text: string }> = [];
  if (tab === 'hot') chips.push({ key: 'tab', text: 'Hot leads' });
  if (stage) chips.push({ key: 'stage', text: `Stage: ${STAGE_LABEL[stage] ?? stage}` });
  if (project) chips.push({ key: 'project', text: `Project: ${project}` });
  if (agent) {
    const who = people.data?.items.find((one) => one.id === agent);
    chips.push({ key: 'agent', text: `Agent: ${who?.name ?? agent}` });
  }
  if (source) {
    chips.push({ key: 'source', text: `Source: ${SOURCE_STYLES[source]?.label ?? source}` });
  }

  function dropChip(key: string) {
    if (key === 'tab') chooseTab('all');
    else narrow(key, '');
  }

  const count = rows.length < total
    ? <><b className="d-ink-2">{rows.length.toLocaleString()}</b> of {total.toLocaleString()} leads</>
    : <><b className="d-ink-2">{total.toLocaleString()}</b> {total === 1 ? 'lead' : 'leads'}</>;

  /*
   * §1.4: the live count goes under the title in the shell's header, not in a
   * strip of its own. The design writes "62 open · 12 to call today"; the
   * counts endpoint sends one number per tab and no open-lead total, so this
   * says what it really knows. See `docs/v2/phone-questions-a.md`.
   */
  const headSub = book
    /* The design's own sub-line, word for word. */
    ? `${(counts.data?.all ?? 0).toLocaleString()} leads · every agent`
    : `${(counts.data?.all ?? 0).toLocaleString()} leads · ${todayCount} to call today`;
  usePhoneHead({
    /* An agent who arrives on the Hot chip is still looking at their own
       leads: only somebody who holds everybody's sees "All leads". */
    title: book ? 'All leads' : 'My leads',
    sub: headSub,
    /* `AllLeads.dc.html` is the compact header — a small centred title with
       the agent chips right under it; `Leads.dc.html` is the 30px one. */
    compact: book,
    action: { icon: 'plus', label: 'Add lead', to: '/v2/leads/new' },
  });

  /*
   * What is ticked. `wholeList` is the design's "Select all 863": the ids
   * behind the filters rather than the ids on the page.
   */
  const chosen = wholeList ?? Object.keys(picked).filter((id) => picked[id]);
  const onPage = rows.filter((row) => picked[row.id] === true).length;
  const allOnPage = rows.length > 0 && onPage === rows.length;
  /** The leads the Move panel is about, where they are on this page. */
  const chosenRows = rows.filter((row) => chosen.includes(row.id));

  /** The design's own result line: what you are looking at, and in what order. */
  const order = tab === 'today' || tab === 'overdue'
    ? ' · most overdue first'
    : tab === 'all' ? ' · newest first' : '';
  const resultLine = search.trim()
    ? `${rows.length} found for “${search.trim()}”`
    : rows.length < total
      ? `${rows.length} shown of ${total.toLocaleString()}${order}`
      : `${total.toLocaleString()} ${total === 1 ? 'lead' : 'leads'}${order}`;

  /**
   * The people a lead may be given to, in the design's order: whoever can
   * take it right now first, then whoever is holding the fewest. The server
   * orders it that way and counts the open leads, which is the number the
   * design puts on each row — `/api/users` knows neither.
   */
  const takers = takerList.data?.items ?? [];

  function openMove(ids: string[], to: string | null | undefined = undefined) {
    if (ids.length === 0) return;
    setPicked(Object.fromEntries(ids.map((id) => [id, true])));
    setWholeList(ids.length > rows.length ? ids : null);
    setMoveTo(to === undefined ? null : to);
    setArmed(false);
    setMoveError(null);
    setMoveOpen(true);
  }

  /**
   * The move itself, and the way back out of it.
   *
   * One request for the batch, which answers with where each lead came from —
   * so Undo is the same request with the list inverted. It used to be one
   * HTTP call per lead from here with no way to undo any of them.
   */
  async function doMove() {
    if (chosen.length === 0) return;
    /* The design asks twice: the first press arms the button and changes its
       words, the second one does it. */
    if (!armed) { setArmed(true); return; }

    setMoving(true);
    setMoveError(null);
    const who = takers.find((one) => one.id === moveTo);
    const label = moveTo ? who?.name ?? 'the agent' : 'Incoming';
    try {
      const result = await api.post<{
        moved: Array<{ id: string; fromUserId: string | null; fromName: string | null }>;
        skipped: number;
        said: string;
      }>('/api/my-leads/move', {
        moves: chosen.map((id) => ({ id, toUserId: moveTo })),
      });

      setMoved((was) => {
        const next = { ...was };
        for (const one of result.moved) next[one.id] = label;
        return next;
      });
      setMoveOpen(false);
      setSelecting(false);
      setPicked({});
      setWholeList(null);
      setMoveTo(null);
      setArmed(false);
      leads.reload();
      counts.reload();

      const back = result.moved.map((one) => ({ id: one.id, toUserId: one.fromUserId }));
      toast(
        result.skipped > 0 ? `${result.said} · ${result.skipped} skipped` : result.said,
        back.length > 0
          ? {
            action: {
              label: 'Undo',
              onClick: () => {
                void api.post('/api/my-leads/move', { moves: back })
                  .then(() => {
                    setMoved({});
                    leads.reload();
                    counts.reload();
                    toast('Move undone · the leads are back where they were');
                  })
                  .catch(() => toast('That could not be undone. Move them back by hand.'));
              },
            },
          }
          : undefined,
      );
    } catch (problem) {
      setMoveError(problem instanceof Error ? problem.message : 'That did not go through.');
      setArmed(false);
    } finally {
      setMoving(false);
    }
  }

  /** "Select all 863": the ids behind the filters, not the ids on the page. */
  async function selectWholeList() {
    try {
      const got = await api.get<{ ids: string[]; limit: number }>(`/api/my-leads/ids?${qs}`);
      setWholeList(got.ids);
      setPicked(Object.fromEntries(got.ids.map((id) => [id, true])));
      if (got.ids.length < total) {
        toast(`The first ${got.ids.length} are selected — one press moves at most ${got.limit}.`);
      }
    } catch {
      toast('That list could not be selected. Try the page instead.');
    }
  }

  if (isPhone) {
    return (
      <div className={wide ? 'v2-leadlist p-all-leads v2-a-list' : 'v2-leadlist p-my-leads v2-a-list'}>
        {/* The check-in sheet and anything a recording could not do. */}
        {dial.banner}
        {/* The design opens with the search field, above the chips. */}
        <label className="v2-a-search">
          <Icon name="search" />
          <input
            type="search"
            value={search}
            aria-label={wide ? 'Search all leads' : 'Search my leads'}
            placeholder="Search name, phone or project"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        {/* The owner's book narrows by agent first — `AllLeads.dc.html`. */}
        {wide && !isAgent && (people.data?.items.length ?? 0) > 0 && (
          <div className="v2-a-chips">
            <button
              type="button"
              className={agent === '' ? 'v2-a-chip v2-a-chip-on' : 'v2-a-chip'}
              onClick={() => narrow('agent', '')}
            >
              All agents
            </button>
            {(people.data?.items ?? [])
              .filter((one) => one.is_active === 1 && one.role !== 'accountant')
              .map((one) => (
                <button
                  key={one.id}
                  type="button"
                  className={agent === one.id ? 'v2-a-chip v2-a-chip-on' : 'v2-a-chip'}
                  onClick={() => narrow('agent', one.id)}
                >
                  {one.name.split(' ')[0]}
                </button>
              ))}
          </div>
        )}

        {!fixedTab && (
          <div ref={tabStrip} className="v2-a-chips" role="tablist">
            {tabs.map((one) => {
              const on = !search.trim() && tab === one.key;
              const n = counts.data?.[one.key];
              return (
                <button
                  key={one.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={on ? 'v2-a-chip v2-a-chip-on' : 'v2-a-chip'}
                  onClick={() => { setSearch(''); chooseTab(one.key); }}
                >
                  {one.label}{n ? ` · ${n.toLocaleString()}` : ''}
                </button>
              );
            })}
          </div>
        )}

        <div className="v2-a-count-row">
          <span className="v2-a-count">{leads.data ? resultLine : 'Loading…'}</span>
          {wide
            ? (
              <button
                type="button"
                className="v2-a-textbtn"
                onClick={() => { setSelecting(!selecting); setPicked({}); }}
              >
                {selecting ? 'Cancel' : 'Select to move'}
              </button>
            )
            : (
              <span className="v2-a-links">
                <Link to="/v2/incoming">Free leads</Link>
                <Link to="/v2/pipeline">Pipeline</Link>
              </span>
            )}
        </div>

        {/* Only over Today, and only when nothing is typed: the design's rule. */}
        {!wide && tab === 'today' && !search.trim() && todayCount > 0 && (
          <Link className="v2-a-start" to="/v2/calling">
            <Icon name="zap" />Start calling · {todayCount} ready
          </Link>
        )}

        {leads.error && <ErrorNote>{leads.error}</ErrorNote>}
        {!leads.data && !leads.error && <Spinner />}

        {leads.data && rows.length > 0 && (
          wide
            ? (
              <div className="v2-a-allcard">
                {byDay.map((day) => (
                  <div key={day.key ?? 'none'} className="v2-a-daygroup">
                    <div className="v2-a-day">
                      <b>{day.heading}</b>
                      <span>{day.count}</span>
                    </div>
                    {day.rows.map((row) => (
                      <AllLeadRow
                        key={row.id}
                        row={row}
                        selecting={selecting}
                        picked={picked[row.id] === true}
                        movedTo={moved[row.id] ?? null}
                        onTick={() => setPicked((was) => ({ ...was, [row.id]: !was[row.id] }))}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )
            : (
              <div className="v2-a-cards">
                {/*
                  * Cut into the days the leads were given out on, which is
                  * exactly how Talha described the problem — "which one is
                  * today leads, which one is yesterday, and which one is day
                  * before yesterday" — so it is the shape of the answer.
                  */}
                {byDay.map((day) => (
                  <div key={day.key ?? 'none'} className="v2-a-daygroup">
                    <div className="v2-a-day">
                      <b>{day.heading}</b>
                      <span>{day.count}</span>
                    </div>
                    {day.rows.map((row) => <PhoneLeadCard key={row.id} row={row} dial={dial} />)}
                  </div>
                ))}
              </div>
            )
        )}

        {leads.data && rows.length === 0 && (
          <div className="d-card v2-a-none">
            <b>No lead found</b>
            <p className="d-muted">
              {search.trim()
                ? `Nothing matches “${search.trim()}”. Check the spelling or add the lead.`
                : leads.data.empty.hint}
            </p>
            <Link className="d-btn d-primary" to="/v2/leads/new">Add a new lead</Link>
          </div>
        )}

        {rows.length > 0 && rows.length < total && (
          <button type="button" className="d-btn v2-a-more" onClick={showMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : `Show ${Math.min(PAGE, total - rows.length)} more`}
          </button>
        )}

        {/* The floating bar the design puts above the bottom bar. */}
        {selecting && chosen.length > 0 && (
          <button type="button" className="v2-a-movebar" onClick={() => setMoveOpen(true)}>
            Move {chosen.length} {chosen.length === 1 ? 'lead' : 'leads'}
          </button>
        )}

        {moveOpen && (
          <>
            <div className="d-scrim" onClick={() => setMoveOpen(false)} aria-hidden />
            <div className="d-dialog d-open" role="dialog" aria-label="Move leads">
              <div className="d-dialog-head">
                <b>Move {chosen.length} {chosen.length === 1 ? 'lead' : 'leads'} to</b>
                <button
                  type="button"
                  className="d-x"
                  aria-label="Close"
                  onClick={() => setMoveOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="d-dialog-body v2-a-targets">
                {/* Incoming first, then whoever is holding the fewest — the
                    same list and the same order as the computer's panel. */}
                <button
                  type="button"
                  className={moveTo === null ? 'v2-a-target v2-a-target-on' : 'v2-a-target'}
                  onClick={() => { setMoveTo(null); setArmed(false); }}
                >
                  Incoming · free leads
                </button>
                {takers.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    disabled={one.onLeave}
                    className={moveTo === one.id ? 'v2-a-target v2-a-target-on' : 'v2-a-target'}
                    onClick={() => { setMoveTo(one.id); setArmed(false); }}
                  >
                    {one.name} · {one.openLeads} open
                  </button>
                ))}
              </div>
              {moveError && <ErrorNote>{moveError}</ErrorNote>}
              <div className="d-dialog-foot">
                <button
                  type="button"
                  className="d-btn d-primary"
                  disabled={moving}
                  onClick={doMove}
                >
                  {moving
                    ? 'Moving…'
                    : armed
                      ? `Tap again · move ${chosen.length} to ${moveTo ? takers.find((o) => o.id === moveTo)?.name ?? 'them' : 'Incoming'}`
                      : `Move to ${moveTo ? takers.find((o) => o.id === moveTo)?.name ?? 'them' : 'Incoming'} · notify them`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={wide ? 'v2-leadlist p-all-leads' : 'v2-leadlist p-my-leads'}>
      {dial.banner}
      <div className="v2-page-head v2-leadlist-head">
        {!fixedTab && (
          <div
            ref={tabStrip}
            className={wide ? 'd-tabs d-pills d-lead-tabs' : 'd-tabs d-pills'}
            role="tablist"
          >
            {tabs.map((one) => {
              const on = tab === one.key;
              const n = counts.data?.[one.key];
              return (
                <button
                  key={one.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={on ? 'd-tab d-on' : 'd-tab'}
                  onClick={() => chooseTab(one.key)}
                >
                  {one.label}
                  {n ? (
                    <span className={one.red ? 'd-count d-red' : 'd-count'}>
                      {n.toLocaleString()}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
        <span className="d-grow" />
        {/*
          * The agent's two links. They are not on the owner's screen in the
          * design and they were on it here: "Free leads" is where an agent
          * claims work, and an owner arriving on their own book being offered
          * it is the clearest sign they are looking at the wrong screen.
          */}
        {!book && (
          <div className="v2-leadlist-links">
            <Link className="d-btn d-sm d-ghost" to="/v2/incoming">
              <Icon name="inbox" />Free leads
            </Link>
            <Link className="d-btn d-sm d-ghost" to="/v2/pipeline">
              <Icon name="kanban" />Pipeline
            </Link>
          </div>
        )}
      </div>

      {/* The strip that starts the day. Only over the Today tab, which is the
          only list that is a call list — and never on the owner's book, which
          has no Today tab and is not a call list at all. */}
      {!book && tab === 'today' && todayCount > 0 && (
        <div className="d-start-strip">
          <span className="d-card-icon v2-leadlist-dial"><Icon name="phone" /></span>
          <div className="d-grow">
            <b className="d-big">
              {todayCount} {todayCount === 1 ? 'lead is' : 'leads are'} ready to call
            </b>{' '}
            <span className="d-s">· one at a time, VIP first</span>
          </div>
          <Link className="d-btn d-primary" to="/v2/calling">
            <Icon name="phone" />Start calling · {todayCount} ready
          </Link>
        </div>
      )}

      <div className="d-filters">
        <div className="d-input-icon">
          <Icon name="search" />
          <input
            className="d-input d-sm"
            type="search"
            value={search}
            aria-label="Search this list"
            placeholder={wide ? 'Search in this list' : 'Name, phone or project'}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {wide && !isAgent && (
          <select
            className="d-select d-sm"
            aria-label="Agent"
            value={agent}
            onChange={(e) => narrow('agent', e.target.value)}
          >
            <option value="">Agent: all</option>
            {(people.data?.items ?? [])
              .filter((one) => one.is_active === 1 && one.role !== 'accountant')
              .map((one) => <option key={one.id} value={one.id}>{one.name}</option>)}
          </select>
        )}

        <select
          className="d-select d-sm"
          aria-label="Stage"
          value={stage}
          onChange={(e) => narrow('stage', e.target.value)}
        >
          <option value="">Stage: all</option>
          {Object.entries(STAGE_LABEL).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        <select
          className="d-select d-sm"
          aria-label="Project"
          value={project}
          onChange={(e) => narrow('project', e.target.value)}
        >
          <option value="">Project: all</option>
          {(projects.data?.items ?? []).map((one) => (
            <option key={one.name} value={one.name}>{one.name} · {one.leads}</option>
          ))}
        </select>

        {wide && (
          <select
            className="d-select d-sm"
            aria-label="Source"
            value={source}
            onChange={(e) => narrow('source', e.target.value)}
          >
            <option value="">Source: all</option>
            {Object.entries(SOURCE_STYLES).map(([key, style]) => (
              <option key={key} value={key}>{style.label}</option>
            ))}
          </select>
        )}

        {chips.map((chip) => (
          <span className="d-filter-chip" key={chip.key}>
            {chip.text}
            <button type="button" aria-label={`Remove ${chip.text}`} onClick={() => dropChip(chip.key)}>×</button>
          </span>
        ))}
        {(chips.length > 0 || search.trim() !== '') && (
          <button type="button" className="d-btn d-xs d-ghost" onClick={clearAll}>Clear all</button>
        )}

        <span className="d-grow" />
        <span className="d-result-count">{leads.data ? count : ''}</span>
      </div>

      {leads.error && <ErrorNote>{leads.error}</ErrorNote>}
      {!leads.data && !leads.error && <Spinner />}

      {leads.data && (
        <div className="d-table-wrap">
          {/*
            * "All 50 leads on this page are selected. Select all 863."
            * Only once the page is full of ticks, and only when there is more
            * behind the filters than is on screen.
            */}
          {book && allOnPage && total > rows.length && (
            <div className="d-sel-all">
              {wholeList
                ? (
                  <>
                    All <b>{wholeList.length.toLocaleString()}</b> leads in this list are selected.
                    {' '}
                    <button type="button" onClick={() => setWholeList(null)}>
                      Select only this page
                    </button>
                  </>
                )
                : (
                  <>
                    All <b>{rows.length.toLocaleString()}</b> leads on this page are selected.
                    {' '}
                    <button type="button" onClick={selectWholeList}>
                      Select all {Math.min(total, MOVE_LIMIT).toLocaleString()}
                    </button>
                  </>
                )}
            </div>
          )}

          {rows.length > 0 && (
            <table className="d-table d-sticky d-id-leads">
              <thead>
                <tr>
                  {book && (
                    <th className="d-t-check">
                      <label className="d-check">
                        <input
                          type="checkbox"
                          aria-label="Select all on this page"
                          checked={allOnPage}
                          ref={(box) => {
                            /* Half-ticked when some of the page is: the design's
                               own indeterminate state, which `d-check` styles. */
                            if (box) box.indeterminate = onPage > 0 && !allOnPage;
                          }}
                          onChange={(e) => {
                            setWholeList(null);
                            setPicked(e.target.checked
                              ? Object.fromEntries(rows.map((row) => [row.id, true]))
                              : {});
                          }}
                        />
                      </label>
                    </th>
                  )}
                  <th>Lead</th>
                  <th>Phone</th>
                  <th>Project</th>
                  <th>Stage</th>
                  {/* The column Talha asked for. "Given out" on a book of
                      everybody's leads; "Given to you" on your own list. */}
                  <th>{book ? 'Given out' : 'Given to you'}</th>
                  {wide
                    ? <>{!isAgent && <th>Agent</th>}<th>Last contact</th></>
                    : <th>Local time</th>}
                  <th>{wide ? 'Attention · next step' : 'Next step'}</th>
                  {!wide && <th />}
                </tr>
              </thead>
              <tbody>
                {byDay.map((day) => (
                  <Fragment key={day.key ?? 'none'}>
                    {/* Today · Yesterday · Wednesday 12 Nov, with how many
                        sit under it. The heading, not the row, is what makes
                        105 identical cards readable. */}
                    <tr className="v2-daygroup">
                      <td colSpan={columns}>
                        <b>{day.heading}</b>
                        <span>{day.count}</span>
                      </td>
                    </tr>
                    {day.rows.map((row) => (
                      <LeadRow
                        key={row.id}
                        row={row}
                        wide={wide}
                        showOwner={wide && !isAgent}
                        selectable={book}
                        picked={picked[row.id] === true}
                        movedTo={moved[row.id] ?? null}
                        onTick={(on) => {
                          setWholeList(null);
                          setPicked((was) => ({ ...was, [row.id]: on }));
                        }}
                        onOpen={() => setPanelFor(row)}
                        onMenu={(x, y) => setMenuAt({ row, x, y })}
                        dial={dial}
                      />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}

          {rows.length === 0 && (
            <div className="d-empty">
              <span className="d-ic"><Icon name="users" size={26} /></span>
              <b>
                {chips.length > 0 || search.trim()
                  ? 'No lead fits these filters'
                  : leads.data.empty.title}
              </b>
              <p>
                {chips.length > 0 || search.trim()
                  ? 'Take one filter away, or clear them all.'
                  : leads.data.empty.hint}
              </p>
              {chips.length > 0 || search.trim()
                ? (
                  <button type="button" className="d-btn d-sm" onClick={clearAll}>
                    Clear all filters
                  </button>
                )
                : (
                  <Link className="d-btn d-sm" to="/v2/leads/new">
                    <Icon name="plus" />Add a new lead
                  </Link>
                )}
            </div>
          )}

          {rows.length > 0 && (
            <div className="d-table-foot">
              <span>1–{rows.length.toLocaleString()} of {total.toLocaleString()}</span>
              <span className="d-small d-muted">· {PAGE} per page</span>
              <span className="d-grow" />
              {rows.length < total && (
                <button type="button" className="d-btn d-xs" onClick={showMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : `Show ${Math.min(PAGE, total - rows.length)} more`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/*
        * The dark bar. It rises from the bottom once anything is ticked, which
        * is the design's way of keeping the two bulk actions off the screen
        * until they mean something.
        */}
      {book && (
        <div className={chosen.length > 0 ? 'd-bulkbar d-show' : 'd-bulkbar'}>
          <b>{chosen.length.toLocaleString()} selected</b>
          <button
            type="button"
            className="d-btn d-sm d-on-dark d-primary"
            onClick={() => openMove(chosen)}
          >
            <Icon name="repeat" />Move to agent
          </button>
          <button
            type="button"
            className="d-btn d-sm d-on-dark"
            onClick={() => openMove(chosen, null)}
          >
            <Icon name="inbox" />Move to Incoming
          </button>
          <button
            type="button"
            className="d-btn d-sm d-on-dark"
            onClick={() => { setPicked({}); setWholeList(null); }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* The row "⋯" menu. Positioned where the button is, like the design's. */}
      {menuAt && (
        <>
          {/* An invisible sheet so the next click anywhere closes the menu,
              which is what `app.js` does for the design's own menus. */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            onClick={() => setMenuAt(null)}
            aria-hidden
          />
          <div
            className="d-menu d-open"
            role="menu"
            style={{ top: menuAt.y, left: Math.max(8, menuAt.x - 220) }}
          >
            <Link className="d-menu-item" to={`/v2/leads/${menuAt.row.id}`} role="menuitem">
              <Icon name="external-link" />{book ? 'Open full page' : 'Open the lead'}
            </Link>
            {book
              ? (
                <>
                  <button
                    type="button"
                    className="d-menu-item"
                    role="menuitem"
                    onClick={() => { const { row } = menuAt; setMenuAt(null); openMove([row.id]); }}
                  >
                    <Icon name="repeat" />Give to another agent
                  </button>
                  <button
                    type="button"
                    className="d-menu-item"
                    role="menuitem"
                    onClick={() => { const { row } = menuAt; setMenuAt(null); openMove([row.id], null); }}
                  >
                    <Icon name="inbox" />Move to Incoming
                  </button>
                </>
              )
              : (
                <>
                  <Link
                    className="d-menu-item"
                    to={`/v2/leads/${menuAt.row.id}?tab=notes`}
                    role="menuitem"
                  >
                    <Icon name="pencil" />Add note
                  </Link>
                  <Link
                    className="d-menu-item"
                    to={`/v2/leads/${menuAt.row.id}?do=follow_up`}
                    role="menuitem"
                  >
                    <Icon name="clock" />Plan a follow-up
                  </Link>
                  <div className="d-menu-sep" />
                  <Link
                    className="d-menu-item"
                    to={`/v2/leads/${menuAt.row.id}?do=transfer`}
                    role="menuitem"
                  >
                    <Icon name="repeat" />Transfer to another agent
                  </Link>
                </>
              )}
          </div>
        </>
      )}

      {/* The 480px side panel a row click opens, instead of leaving the list. */}
      {panelFor && (
        <LeadPanel
          row={panelFor}
          book={book}
          onClose={() => setPanelFor(null)}
          onGive={() => { const row = panelFor; setPanelFor(null); openMove([row.id]); }}
          dial={dial}
        />
      )}

      {/* "Move N leads", which asks twice. */}
      {moveOpen && (
        <>
          <div className="d-scrim d-show" onClick={() => setMoveOpen(false)} aria-hidden />
          <aside className="d-panel d-open" aria-label="Move leads">
            <div className="d-panel-head">
              <h2>Move {chosen.length === 1 ? '1 lead' : `${chosen.length} leads`}</h2>
              <button
                type="button"
                className="d-btn d-icon d-sm d-ghost"
                aria-label="Close"
                onClick={() => setMoveOpen(false)}
              >
                <Icon name="x" />
              </button>
            </div>
            <div className="d-panel-body d-col d-gap-16">
              <div className="d-who-list">
                {chosenRows.slice(0, 6).map((row) => (
                  <span className="d-chip d-lg" key={row.id}>{row.full_name ?? 'Unnamed lead'}</span>
                ))}
                {chosen.length > Math.min(6, chosenRows.length) && (
                  <span className="d-chip d-lg d-dark">
                    + {(chosen.length - Math.min(6, chosenRows.length)).toLocaleString()} more
                  </span>
                )}
              </div>

              <div className="d-banner">
                <Icon name="info" />
                <span className="d-grow">
                  Notes and history go with them. The new agent gets one notification.
                </span>
              </div>

              <div>
                <div className="d-row d-mb-8">
                  <h4 className="d-grow">Move to</h4>
                  <span className="d-small d-muted">fewest open leads first</span>
                </div>
                <div className="d-opt-list">
                  <button
                    type="button"
                    className={moveTo === null ? 'd-opt d-on' : 'd-opt'}
                    onClick={() => { setMoveTo(null); setArmed(false); }}
                  >
                    <span className="d-card-icon"><Icon name="inbox" /></span>
                    <span className="d-grow">
                      <b className="d-bold">Incoming</b>
                      <div className="d-small d-muted">Free leads · any agent can take one</div>
                    </span>
                  </button>
                  {takers.map((one, i) => (
                    <button
                      key={one.id}
                      type="button"
                      disabled={one.onLeave}
                      className={moveTo === one.id ? 'd-opt d-on' : 'd-opt'}
                      onClick={() => { setMoveTo(one.id); setArmed(false); }}
                    >
                      <Avatar name={one.name} src={one.photoUrl ?? undefined} />
                      <span className="d-grow">
                        <b className="d-bold">{one.name}</b>
                        {i === 0 && !one.onLeave && (
                          <span className="d-chip d-green v2-leadtr-best">Fewest leads</span>
                        )}
                        <div className="d-small d-muted">
                          {one.onLeave
                            ? 'On leave · cannot be chosen'
                            : one.languages.length > 0
                              ? one.languages.join(', ')
                              : one.markedToday === 'office' ? 'In the office'
                                : one.markedToday === 'outside' ? 'Working outside'
                                  : 'Not marked today'}
                        </div>
                      </span>
                      <span className="d-small d-muted d-nowrap">{one.openLeads} open</span>
                    </button>
                  ))}
                </div>
                {overDesk(takers, moveTo) && (
                  <span className="d-small d-muted">{overDesk(takers, moveTo)}</span>
                )}
              </div>

              {moveError && <div className="d-banner d-red"><span className="d-grow">{moveError}</span></div>}
            </div>
            <div className="d-panel-foot">
              <button type="button" className="d-btn d-ghost" onClick={() => setMoveOpen(false)}>
                Cancel
              </button>
              <span className="d-grow" />
              <button
                type="button"
                className={armed ? 'd-btn d-primary d-danger' : 'd-btn d-primary'}
                disabled={moving}
                onClick={doMove}
              >
                {moving
                  ? 'Moving…'
                  : armed
                    ? `Tap again · move ${chosen.length === 1 ? '1 lead' : `${chosen.length} leads`} to ${moveTo ? takers.find((o) => o.id === moveTo)?.name ?? 'them' : 'Incoming'}`
                    : `Move ${chosen.length === 1 ? '1 lead' : `${chosen.length} leads`} to ${moveTo ? takers.find((o) => o.id === moveTo)?.name ?? 'them' : 'Incoming'}`}
              </button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

/**
 * "Shan has 57 open leads, above the desk maximum of 50. Shan may say no."
 *
 * The desk's own ceiling, where the person is on a desk that sets one.
 */
function overDesk(takers: Taker[], moveTo: string | null): string | null {
  if (!moveTo) return null;
  const who = takers.find((one) => one.id === moveTo);
  if (!who || who.maxOpenLeads === null || who.openLeads < who.maxOpenLeads) return null;
  return `${who.name} has ${who.openLeads} open leads, above the desk maximum of `
    + `${who.maxOpenLeads}. ${who.name} may say no.`;
}

/**
 * One lead, as the phone draws it — `Leads.dc.html`.
 *
 * Two parts with a hairline between them. The top opens the lead: face, name,
 * VIP, what they are looking at, and the stage. The bottom is the clock where
 * they are, why this lead is in front of you, and the two round buttons that
 * are the whole job — message and call. A row in the computer table is six
 * lines tall at 390px; this is three.
 */
function PhoneLeadCard({ row, dial }: { row: Row; dial: CallActions }) {
  const why = reason(row);
  const origin = originOf(row.phone_e164);
  const local = origin ? clockIn(origin.timeZone) : null;
  const phone = row.phone_e164 ?? '';
  const to = `/v2/leads/${row.id}`;
  const name = row.full_name ?? 'Unnamed lead';

  return (
    <div className="v2-a-card">
      <Link className="v2-a-card-top" to={to} aria-label={`Open ${name}`}>
        <Avatar name={name} size={46} />
        <span className="v2-a-who">
          <span className="v2-a-name-row">
            <span className="v2-a-name" dir="auto">{name}</span>
            {row.is_vip === 1 && <span className="v2-a-vip">VIP</span>}
          </span>
          <span className="v2-a-proj">
            {[row.project_name, wanted(row)].filter(Boolean).join(' · ') || 'No project yet'}
          </span>
        </span>
        {/*
          * The stage pill, except on a new lead.
          *
          * "New Lead" on every card was the other half of what Talha reported:
          * on the New tab it repeats the heading above the list, and it was
          * sitting in the one piece of space the date could have. Every other
          * stage — Called, Interested, Meeting, Offer, Won — still shows,
          * because those say something the rest of the card does not.
          */}
        {row.stage_key !== 'new_lead' && (
          <span className={`d-chip d-stage-${STAGE_CHIP[row.stage_key] ?? 'new'}`}>
            {STAGE_LABEL[row.stage_key] ?? row.stage_key}
          </span>
        )}
      </Link>

      <div className="v2-a-card-foot">
        <span className="v2-a-when">
          {/* When it landed on you. First line of the three, because on a
              list of a hundred identical new leads it is the one that tells
              them apart. */}
          <GivenLine at={row.assigned_at} label="Given to you" />
          {/* Twelve-hour, and only here: Emir asked for it by name on 10 Nov
              so the column reads at a glance. */}
          <span className="v2-a-local">
            {origin && local ? `${origin.zoneLabel ?? origin.name} ${local.time}` : 'No number'}
          </span>
          <span className={`v2-a-note v2-a-note-${why.tone}`}>{why.text}</span>
        </span>
        {phone && (
          <a
            className="v2-a-rbtn v2-a-rbtn-wa"
            href={`https://wa.me/${phone.replace(/[^\d]/g, '')}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`Message ${name}`}
            onClick={(e) => { e.preventDefault(); void dial.whatsapp(row); }}
          >
            <Icon name="message-circle" />
          </a>
        )}
        {phone && (
          <a
            className="v2-a-rbtn v2-a-rbtn-call"
            href={`tel:${phone}`}
            aria-label={`Call ${name}`}
            onClick={(e) => { e.preventDefault(); void dial.call(row); }}
          >
            <Icon name="phone" />
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * One row of the owner's book — `AllLeads.dc.html`.
 *
 * A tight list inside one card rather than a stack of cards: the owner is
 * scanning for the agent's name and the warning, not reading each lead.
 */
function AllLeadRow({ row, selecting, picked, movedTo, onTick }: {
  row: Row;
  selecting: boolean;
  picked: boolean;
  movedTo: string | null;
  onTick: () => void;
}) {
  const why = reason(row);
  const name = row.full_name ?? 'Unnamed lead';
  const stage = STAGE_LABEL[row.stage_key] ?? row.stage_key;

  return (
    <div className="v2-a-allrow">
      {selecting && (
        <button
          type="button"
          className={picked ? 'v2-a-tick v2-a-tick-on' : 'v2-a-tick'}
          aria-label={`Select ${name}`}
          aria-pressed={picked}
          onClick={onTick}
        >
          {picked ? '✓' : ''}
        </button>
      )}
      <Link className="v2-a-allwho" to={`/v2/leads/${row.id}`}>
        <span className="v2-a-name" dir="auto">{name}</span>
        <span className="v2-a-proj">
          {[row.project_name ?? 'No project yet', stage, row.is_vip === 1 ? 'VIP' : null]
            .filter(Boolean).join(' · ')}
        </span>
        {/* The owner's book is grouped by day as well, so the row only needs
            the clock time — and the warm colour when it is not today's. */}
        <GivenLine at={row.assigned_at} label="Given" />
        {why.tone !== 'calm' && <span className="v2-a-warn">{why.text}</span>}
      </Link>
      <span className={movedTo ? 'v2-a-agpill v2-a-agpill-moved' : 'v2-a-agpill'}>
        {movedTo ?? row.owner_name ?? 'Incoming'}
      </span>
    </div>
  );
}

function LeadRow({
  row, wide, showOwner, selectable, picked, movedTo, onTick, onOpen, onMenu, dial,
}: {
  row: Row;
  wide: boolean;
  showOwner: boolean;
  /** The screen's one call helper, so the row records what it did. */
  dial: CallActions;
  /** The owner's book has a tick box on every row; the agent's list does not. */
  selectable?: boolean;
  picked?: boolean;
  /** Set while the move's Undo is still on screen, so the row says where it went. */
  movedTo?: string | null;
  onTick?: (on: boolean) => void;
  /** A row click opens the 480px panel rather than leaving the list. */
  onOpen?: () => void;
  onMenu?: (x: number, y: number) => void;
}) {
  const navigate = useNavigate();
  const step = nextStep(row);
  const origin = originOf(row.phone_e164);
  const local = origin ? clockIn(origin.timeZone) : null;
  const phone = row.phone_e164 ?? '';
  const to = `/v2/leads/${row.id}`;

  /*
   * A row click opens the side panel, which is the fault the owner found: it
   * used to navigate to the whole lead page, so looking at six leads meant
   * six round trips through the list and six scroll positions lost.
   *
   * The buttons and links inside the row still do their own job, and Enter on
   * the row still goes to the full page.
   */
  function open(event: MouseEvent<HTMLTableRowElement>) {
    if ((event.target as HTMLElement).closest('a,button,input,label')) return;
    if (onOpen) onOpen();
    else navigate(to);
  }

  const actions = (
    <div className="d-row-actions">
      {phone && (
        <a
          className="d-btn d-xs"
          href={`tel:${phone}`}
          aria-label={`Call ${row.full_name ?? 'this lead'}`}
          onClick={(e) => { e.preventDefault(); void dial.call(row); }}
        >
          <Icon name="phone" />Call
        </a>
      )}
      {phone && (
        <a
          className="d-btn d-xs"
          href={`https://wa.me/${phone.replace(/[^\d]/g, '')}`}
          target="_blank"
          rel="noreferrer"
          aria-label="WhatsApp"
          onClick={(e) => { e.preventDefault(); void dial.whatsapp(row); }}
        >
          <Icon name="message-circle" />WhatsApp
        </a>
      )}
      {onMenu
        ? (
          <button
            type="button"
            className="d-btn d-xs d-icon"
            aria-label="More"
            aria-haspopup="menu"
            onClick={(e) => {
              const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onMenu(box.right, box.bottom + 6);
            }}
          >
            <Icon name="more-horizontal" />
          </button>
        )
        : (
          <Link className="d-btn d-xs d-icon" to={to} aria-label="Open the lead">
            <Icon name="external-link" />
          </Link>
        )}
    </div>
  );

  return (
    <tr
      data-href={to}
      tabIndex={0}
      className={picked ? 'd-selected' : undefined}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) navigate(to); }}
    >
      {selectable && (
        <td className="d-t-check">
          <label className="d-check">
            <input
              type="checkbox"
              aria-label={`Select ${row.full_name ?? 'this lead'}`}
              checked={picked === true}
              onChange={(e) => onTick?.(e.target.checked)}
            />
          </label>
        </td>
      )}
      {/* All leads writes the name straight into the cell; the working list
          puts a face beside it, because that is the list you read all day. */}
      {wide
        ? (
          <td className="d-nm">
            <Link className="d-t-main" to={to} dir="auto">{row.full_name ?? 'Unnamed lead'}</Link>
            {row.is_vip === 1 && <> <span className="d-vip-tag">VIP</span></>}
          </td>
        )
        : (
          <td>
            <span className="d-nm">
              <Avatar name={row.full_name ?? '?'} size={26} />
              <Link className="d-t-main" to={to} dir="auto">{row.full_name ?? 'Unnamed lead'}</Link>
              {row.is_vip === 1 && <span className="d-vip-tag">VIP</span>}
            </span>
          </td>
        )}

      {/* Grouped for reading aloud. This is the column an agent dictates
          from, and it printed `+971501234567` in one run. */}
      <td className="d-t-mono" dir="ltr">{spacedE164(phone) ?? '–'}</td>

      <td>
        {row.project_name ?? '–'}
        {!wide && wanted(row) && <span className="d-t-sub">{wanted(row)}</span>}
      </td>

      <td>
        <span className={`d-chip d-stage-${STAGE_CHIP[row.stage_key] ?? 'new'}`}>
          {STAGE_LABEL[row.stage_key] ?? row.stage_key}
        </span>
      </td>

      {/*
        * When it was given out. The column is headed, so the cell says only
        * the date — the time alone on today's, the day and the time plus how
        * long it has been sitting on anything older, in warm amber.
        */}
      <td><GivenLine at={row.assigned_at} /></td>

      {wide
        ? (
          <>
            {showOwner && (
              /* `movedTo` is who it has just been given to: the row says so
                 straight away rather than waiting for the list to come back,
                 so the Undo in the toast is about something visible. */
              <td className={movedTo ? 'd-pulse-row' : undefined}>
                {(movedTo ?? row.owner_name)
                  ? (
                    <span className="d-person">
                      <Avatar name={(movedTo ?? row.owner_name) as string} size={26} />
                      {movedTo ?? row.owner_name}
                    </span>
                  )
                  : <span className="d-chip d-red d-pip">Incoming</span>}
              </td>
            )}
            <td className="d-t-sub">{whenShort(row.last_contact_at)}</td>
          </>
        )
        : (
          <td>
            {/*
              * What time it is for the client. An agent calling Germany at
              * 06:00 Dubai is calling at 03:00 their time, and the number
              * alone does not say so.
              *
              * Twelve hour here, and only here. v3 §5 says a 24-hour clock
              * everywhere, and every other CRM time obeys that -- but Emir
              * asked for this one by name on 10 Nov ("should be 12 hours
              * time, not 16 17 18"), and he is right about it: the point of
              * the column is to be read at a glance without doing a sum.
              */}
            {origin && local
              ? (
                <span className="d-localtime" title={`${local.time} in ${origin.zoneLabel ?? origin.name}`}>
                  <Icon name="clock" size={13} />
                  {origin.zoneLabel ?? origin.name} {local.time}
                </span>
              )
              : <span className="d-localtime">–</span>}
          </td>
        )}

      {wide
        ? (
          <td className={step.urgent ? 'd-t-act d-overdue' : 'd-t-act'}>
            <span className="d-next" title={step.text}>{step.text}</span>
            {actions}
          </td>
        )
        : (
          <>
            <td
              className={step.urgent ? 'd-next d-overdue' : step.none ? 'd-next d-muted' : 'd-next'}
              title={step.text}
            >
              {step.text}
            </td>
            <td>{actions}</td>
          </>
        )}
    </tr>
  );
}

/**
 * The 480px side panel a row click opens.
 *
 * `design/web/my-leads.html` and `all-leads.html` each draw one, and they are
 * not the same panel: an agent's is a quick view of their own lead (the big
 * phone number, what is owed next, the last note) and an owner's is a
 * position report (who holds it, what is late, the last three things that
 * happened, and a way to give it to somebody else).
 *
 * Both were absent from the computer entirely — a row click left the list for
 * the whole lead page, so looking at six leads cost six round trips and six
 * lost scroll positions. The owner reported it as fault three.
 *
 * It reads the lead once when it opens, which is what gives it the timeline
 * and the notes the list rows do not carry. Nothing here invents a figure: a
 * field the record does not hold is simply not drawn.
 */
function LeadPanel({ row, book, onClose, onGive, dial }: {
  row: Row;
  book: boolean;
  onClose: () => void;
  onGive: () => void;
  dial: CallActions;
}) {
  const detail = useAsync<{
    lead: Row & { email: string | null; language: string | null; preferred_location: string | null };
    activities: Array<{ id: string; type: string; title?: string | null; body: string | null; created_at: string }>;
  }>(() => api.get(`/api/my-leads/${row.id}`), [row.id]);
  const notes = useAsync<{ items: Array<{ id: string; body: string; author_name?: string | null; created_at: string }> }>(
    () => (book ? Promise.resolve({ items: [] }) : api.get(`/api/notes/${row.contact_id}`)),
    [row.contact_id, book],
  );

  const step = nextStep(row);
  const phone = row.phone_e164 ?? '';
  const origin = originOf(phone);
  const local = origin ? clockIn(origin.timeZone) : null;
  const name = row.full_name ?? 'Unnamed lead';
  const to = `/v2/leads/${row.id}`;
  const language = detail.data?.lead.language ?? null;

  /* Escape closes it, like every other panel in the design. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const actions = (
    <div className="d-p-acts">
      {phone
        ? (
          <a
            className="d-btn d-primary"
            href={`tel:${phone}`}
            onClick={(e) => { e.preventDefault(); void dial.call(row); }}
          >
            <Icon name="phone" />Call
          </a>
        )
        : <span className="d-btn d-disabled"><Icon name="phone" />No number</span>}
      {phone && (
        <a
          className="d-btn"
          href={`https://wa.me/${phone.replace(/[^\d]/g, '')}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => { e.preventDefault(); void dial.whatsapp(row); }}
        >
          <Icon name="message-circle" />WhatsApp
        </a>
      )}
      <Link className="d-btn" to={`${to}?tab=notes`}>
        <Icon name="pencil" />Add note
      </Link>
    </div>
  );

  return (
    <>
      <div className="d-scrim d-show" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label="Lead">
        <div className="d-panel-head">
          <h2>
            {name}
            {row.is_vip === 1 && <> <span className="d-vip-tag">VIP</span></>}
          </h2>
          <Link className="d-btn d-sm" to={to}>
            <Icon name="external-link" />Open full page
          </Link>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-16">
          <div className="d-p-top">
            <div className={book ? 'd-phone-big' : 'd-phone-xl'} dir="ltr">
              {spacedE164(phone) ?? 'No phone number'}
            </div>
            <div className="d-row d-gap-8 d-wrap">
              <span className={`d-chip d-stage-${STAGE_CHIP[row.stage_key] ?? 'new'}`}>
                {STAGE_LABEL[row.stage_key] ?? row.stage_key}
              </span>
              {origin && local && (
                <span className="d-localtime">
                  <Icon name="clock" size={13} />
                  {origin.zoneLabel ?? origin.name} {local.time}
                </span>
              )}
              <span className="d-muted d-small">
                {row.owner_name ? `· with ${row.owner_name}` : '· in Incoming, no agent yet'}
              </span>
            </div>
          </div>

          {actions}

          {/* What is owed. Red when it is late, which is the one thing the
              owner is scanning this panel for. */}
          {book
            ? (
              <div className={step.urgent ? 'd-banner d-red' : 'd-banner'}>
                <Icon name="clock" />
                <span className="d-grow">{step.text}</span>
              </div>
            )
            : (
              <div className={step.urgent ? 'd-pv-next d-red' : 'd-pv-next'}>
                <span className="d-sec-label">Next step</span>
                <b className="d-bold">{step.text}</b>
              </div>
            )}

          <dl className="d-kv">
            <PanelRow label="Project" value={row.project_name} />
            {book
              ? <PanelRow label="Budget" value={wanted(row) || null} />
              : <PanelRow label="Unit · budget" value={wanted(row) || null} />}
            {book && (
              <PanelRow label="Agent" value={row.owner_name ?? 'Incoming'} />
            )}
            {!book && <PanelRow label="Speaks" value={language} />}
            <PanelRow label="Last contact" value={whenShort(row.last_contact_at)} />
            {book && (
              <PanelRow
                label="Source"
                value={row.source ? SOURCE_STYLES[row.source]?.label ?? row.source : null}
              />
            )}
            {book && <PanelRow label="Lead #" value={`#${row.id.slice(0, 8)}`} />}
          </dl>

          {/* The owner's panel ends with the last three things that happened;
              the agent's with the last note, which is what they left for
              themselves. */}
          {book
            ? (
              <div>
                <h4 className="d-mb-8">Latest on the timeline</h4>
                {!detail.data && <span className="d-small d-muted">Reading the lead…</span>}
                {detail.data && detail.data.activities.length === 0 && (
                  <span className="d-small d-muted">Nothing has happened yet.</span>
                )}
                <div className="d-timeline">
                  {(detail.data?.activities ?? []).slice(0, 3).map((one) => (
                    <div className="d-tl-item" key={one.id}>
                      <span className="d-tl-dot"><Icon name="circle" size={14} /></span>
                      <div className="d-tl-body">
                        <b>{one.title?.trim() || one.type.replace(/[._]/g, ' ')}</b>
                        {one.body && <p>{one.body}</p>}
                        <span className="d-tl-time">{whenShort(one.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
            : (
              <div>
                <span className="d-sec-label d-mb-8">Last note</span>
                {!notes.data && <p className="d-small d-muted">Reading the notes…</p>}
                {notes.data && (
                  <p className="d-mt-8">
                    {notes.data.items[0]?.body ?? 'No notes yet. Write the first one after your call.'}
                  </p>
                )}
              </div>
            )}
        </div>

        <div className="d-panel-foot">
          {book
            ? (
              <button type="button" className="d-btn" onClick={onGive}>
                <Icon name="repeat" />Give to another agent
              </button>
            )
            : (
              <Link className="d-btn" to={`${to}?do=transfer`}>
                <Icon name="repeat" />Transfer
              </Link>
            )}
          <span className="d-grow" />
          <button type="button" className="d-btn d-ghost" onClick={onClose}>Close</button>
        </div>
      </aside>
    </>
  );
}

function PanelRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="d-kv-row">
      <dt>{label}</dt>
      <dd dir="auto">{value && String(value).trim() !== '' ? value : '—'}</dd>
    </div>
  );
}
