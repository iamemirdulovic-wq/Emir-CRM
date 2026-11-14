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
import { clockIn, flagOf, originOf, whenToCall } from '../lib/dialling.js';
import { given, groupByGivenDay } from '../lib/assigned.js';
import { callNote, type LeadFacets } from '../lib/facets.js';
/* Moved out on 14 Nov so two people can work on this screen at once. A pure
   move: same markup, same behaviour. */
import { LeadPanel } from './LeadPanel.js';

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

/**
 * Under this, the row's buttons lose their words.
 *
 * The agent's list has eight columns and "Call" and "WhatsApp" with their
 * labels take 176px of them. At 1280px that leaves the next step 98px, and
 * §2.2 calls it *"wide and always readable"*. Below 1400 the two buttons
 * become their icons, which is 104px, and the word is still in the button's
 * own label for a screen reader and in its tooltip for everybody else.
 */
const TIGHT = 1400;

function useIsPhone(): boolean {
  return useBelow(PHONE);
}

/** True while the window is narrower than `width`. */
function useBelow(width: number): boolean {
  const [below, setBelow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width:${width - 1}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${width - 1}px)`);
    const onChange = () => setBelow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [width]);
  return below;
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
export const STAGE_LABEL: Record<string, string> = {
  new_lead: 'New',
  attempted_contact: 'Called',
  engaged_qualified: 'Interested',
  appointment_scheduled: 'Meeting',
  deal_sent: 'Offer',
  won: 'Won',
  lost: 'Lost',
};

/** `chip stage-*` in the design; the pill's dot colour comes from the key. */
export const STAGE_CHIP: Record<string, string> = {
  new_lead: 'new',
  attempted_contact: 'called',
  engaged_qualified: 'interested',
  appointment_scheduled: 'meeting',
  deal_sent: 'offer',
  won: 'won',
  lost: 'lost',
};

export interface Row {
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
  /**
   * How many leads each day really holds, across the whole filtered list and
   * not just the page. The heading beside each day band reads from this; the
   * rows in hand are only fifty.
   */
  givenDays?: Array<{ day: string | null; count: number }>;
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
export function nextStep(row: Row): { text: string; urgent: boolean; none: boolean } {
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
export function whenShort(value: string | null): string {
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
  /*
   * Two lines, not one: the day in the reading weight on top and how long it
   * has been waiting under it in grey. On one line the pair ran to
   * "12 Nov 18:57 · 2 days ago", which is the length that makes a column stop
   * being scannable — and the "2 days ago" is the half an agent actually
   * acts on, so it earns a line of its own rather than a tail after a dot.
   */
  return (
    <span
      className={line.stale ? 'v2-given v2-given-old' : line.missing ? 'v2-given v2-given-none' : 'v2-given'}
      title={line.exact ?? undefined}
    >
      <span className="v2-given-when">
        {label && !line.missing ? `${label} ` : ''}{line.when}
      </span>
      {line.ago && <span className="v2-given-ago">{line.ago}</span>}
    </span>
  );
}

/**
 * One row inside a filter dropdown: a flag, a name, a count, maybe a moon.
 *
 * `flag` is empty for the Unknown row and for every language. An empty flag
 * draws nothing — never a placeholder, never a guess — which is
 * `lib/dialling.ts`'s own rule and the reason the Unknown row exists at all.
 */
interface PickOption {
  value: string;
  label: string;
  flag: string;
  count: number;
  /** True where it is outside calling hours in that country right now. */
  night: boolean;
  /** "03:12 in London — too early to call", for the hover. */
  note: string | null;
}

/**
 * The Country and Language filters, as dropdowns in the one filter row.
 *
 * They were two rows of chips. Emir, 14 November 2026, on the fix list:
 * *"Keep the country filter, as a dropdown with flags and counts in the
 * filter row"*, *"Language is a dropdown with counts. No help sentence"*,
 * and *"Remove the chip rows, '+59 more' and all grey help sentences."* The
 * filtering itself he kept — *"country and language filter (it is live)"* —
 * so everything behind this is unchanged; only the control is new.
 *
 * Not a `<select>`. His own list asks for flags, counts **and a search
 * inside**, because the book runs to 59 countries, and a native dropdown can
 * hold none of the three. So it is a button that opens a panel: a search box,
 * then one row per country with the flag, the name, the real count and the
 * moon where it is the middle of the night there.
 *
 * Two rules it does not bend:
 *
 *   - **Every number is the server's**, one `GROUP BY` over the whole
 *     filtered book. Nothing in this file counts a row.
 *   - **No raw codes.** The label is "English", never "en" — §0 of the fix
 *     list, and `labelsAreWords` in `leads-filters.test.ts` is the check.
 */
function FilterPicker({ label, value, options, allLabel, allCount, onPick, searchHint }: {
  /** "Country" or "Language" — what the button says when nothing is picked. */
  label: string;
  value: string;
  options: PickOption[];
  allLabel: string;
  allCount: number;
  onPick: (value: string) => void;
  /** The placeholder inside the panel's own search box. */
  searchHint: string;
}) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const box = useRef<HTMLDivElement>(null);

  /* Escape closes it, and so does a click anywhere else — the same two ways
     out as every other menu in the design. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    /* `globalThis.MouseEvent`, not `MouseEvent`: React's own `MouseEvent`
       type is imported at the top of this file and shadows the DOM one. */
    const onDown = (e: globalThis.MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const chosen = options.find((one) => one.value === value) ?? null;
  const want = find.trim().toLowerCase();
  /* Matched on the start of a word, like the server's own search: "in" means
     India and Indonesia, not Argentina and Finland. */
  const shown = want
    ? options.filter((one) => one.label.toLowerCase().split(/[\s/·]+/).some((w) => w.startsWith(want)))
    : options;

  return (
    <div className="v2-filt" ref={box}>
      <button
        type="button"
        className={value ? 'v2-filt-btn v2-filt-btn-on' : 'v2-filt-btn'}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen(!open); setFind(''); }}
      >
        {chosen?.flag && <span className="v2-filt-flag" aria-hidden>{chosen.flag}</span>}
        <span className="v2-filt-text">
          {chosen ? chosen.label : `${label}: all`}
        </span>
        <Icon name="chevron-down" size={14} />
      </button>

      {open && (
        <div className="v2-filt-panel" role="listbox" aria-label={label}>
          {/* The search inside, which is what makes 59 countries usable. */}
          <label className="v2-filt-find">
            <Icon name="search" size={14} />
            <input
              type="search"
              autoFocus
              value={find}
              aria-label={searchHint}
              placeholder={searchHint}
              onChange={(e) => setFind(e.target.value)}
            />
          </label>

          <div className="v2-filt-list">
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              className={value === '' ? 'v2-filt-row v2-filt-row-on' : 'v2-filt-row'}
              onClick={() => { onPick(''); setOpen(false); }}
            >
              <span className="v2-filt-name">{allLabel}</span>
              <span className="v2-filt-n">{allCount.toLocaleString()}</span>
            </button>

            {shown.map((one) => (
              <button
                key={one.value}
                type="button"
                role="option"
                aria-selected={value === one.value}
                className={value === one.value ? 'v2-filt-row v2-filt-row-on' : 'v2-filt-row'}
                title={one.note ?? undefined}
                onClick={() => { onPick(one.value); setOpen(false); }}
              >
                {/* No flag at all where the dialling code is not one we know,
                    rather than the wrong one. */}
                {one.flag && <span className="v2-filt-flag" aria-hidden>{one.flag}</span>}
                <span className="v2-filt-name">{one.label}</span>
                {one.night && (
                  <span className="v2-filt-moon" role="img" aria-label="night there now">🌙</span>
                )}
                <span className="v2-filt-n">{one.count.toLocaleString()}</span>
              </button>
            ))}

            {shown.length === 0 && (
              <span className="v2-filt-none">Nothing matches “{find.trim()}”</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The country rows for the dropdown, straight from what the server counted. */
function countryOptions(facets: LeadFacets | null): PickOption[] {
  return (facets?.countries ?? []).map((one) => ({
    value: one.iso2,
    label: one.name,
    flag: one.flag,
    count: one.count,
    night: one.night === true,
    note: callNote(one),
  }));
}

/** And the language rows. No flags: a language is not a country. */
function languageOptions(facets: LeadFacets | null): PickOption[] {
  return (facets?.languages ?? []).map((one) => ({
    value: one.code,
    /* Always a word. `languageName` on the server turns "ar" into "Arabic"
       and a blank into "Not known"; §0 of the fix list: never a raw code. */
    label: one.label,
    flag: '',
    count: one.count,
    night: false,
    note: null,
  }));
}

/**
 * The lead one step up or down the list, or the one we are on at either end.
 *
 * Clamped, not wrapped: §4.9 is a walk through what is on screen, and a walk
 * that comes back round to the top is how an agent rings somebody twice.
 */
function stepTo(list: Row[], here: Row, by: 1 | -1): Row {
  const at = list.findIndex((one) => one.id === here.id);
  if (at < 0) return here;
  return list[Math.min(list.length - 1, Math.max(0, at + by))] ?? here;
}

/**
 * "Nothing is both 🇷🇺 Russia / Kazakhstan and Arabic. Take one away."
 *
 * The empty state used to say "Take one filter away, or clear them all" over
 * four dropdowns and two rows of chips, leaving the reader to work out which
 * ones were on. Every name in the sentence comes from a chip that is really
 * in force; nothing is guessed.
 */
function narrowedTo(chips: Array<{ key: string; text: string }>, search: string): string | null {
  /* The chips read "Country: 🇦🇪 UAE"; the sentence wants the half after the
     colon, because the row above already says which control it was. */
  const names = chips.map((one) => one.text.split(': ').slice(1).join(': ') || one.text);
  if (search.trim()) names.push(`“${search.trim()}”`);
  if (names.length === 0) return null;
  if (names.length === 1) return `Nothing here is ${names[0]}. Try another, or clear it.`;
  const last = names[names.length - 1] as string;
  return `Nothing here is ${names.slice(0, -1).join(', ')} and ${last}. Take one away.`;
}

/**
 * The city a time zone is named for — "Europe/London" → "London".
 *
 * Picture 01 draws the Local time column as "Dubai 14:55", "Lisbon 10:55",
 * "London 10:55", "Dhaka 16:55": cities, not countries. It is also what fits.
 * The column is 100px wide and "United Kingdom 06:57" is 150, so the country
 * name came out as "United King…" — which tells an agent nothing the flag in
 * the Country filter does not.
 *
 * Nothing is invented: the city is the IANA zone's own last segment, which is
 * where the zone is defined. `zoneLabel` wins where the table sets one, so a
 * Russian number still says "Moscow" rather than implying the whole country
 * is on that clock.
 */
function cityOf(origin: { zoneLabel?: string; timeZone: string | null; name: string }): string {
  if (origin.zoneLabel) return origin.zoneLabel;
  const zone = origin.timeZone;
  if (!zone) return origin.name;
  return (zone.split('/').pop() ?? origin.name).replace(/_/g, ' ');
}

/** The second line of the project cell: what they asked for. */
export function wanted(row: Row): string {
  const budget = row.budget_min_aed || row.budget_max_aed
    ? budgetLabel(row.budget_min_aed, row.budget_max_aed, row.budget_band ?? null)
    : null;
  return [row.unit_type, budget].filter(Boolean).join(' · ');
}

export function V2Leads({ fixedTab }: { fixedTab?: TabKey } = {}) {
  const isPhone = useIsPhone();
  /* Below 1400 the row's buttons lose their words, so the next step keeps
     the width §2.2 asks for. See `TIGHT`. */
  const tight = useBelow(TIGHT);
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
  /*
   * Who sees the Export button. The server is the fence —
   * `/api/my-leads/export.csv` is behind `requireAdmin` and
   * `requirePermission('export')` — so this only keeps a button off a screen
   * where pressing it would be refused.
   */
  const canExport = user ? user.role === 'owner' || user.role === 'admin' : false;
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
  /*
   * The two chip rows. In the URL like every other filter, so a refresh keeps
   * them and a manager can send somebody the link to "the Russian leads".
   *
   * `country` is an ISO 3166-1 alpha-2 code, or `unknown` for a number whose
   * dialling code the table does not hold. `language` is `contacts.language`
   * as stored, or `unknown` for a blank one.
   */
  const country = params.get('country') ?? '';
  const language = params.get('language') ?? '';
  /* "Added: any time / Today / This week / This month" — picture 02's last
     dropdown. Dubai days, worked out on the server. */
  const added = params.get('added') ?? '';

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
    /* the next step, then the buttons, which both lists now give a column */
    + 1 + 1;

  const qs = useMemo(() => {
    const next = new URLSearchParams();
    next.set('tab', tab);
    next.set('pageSize', String(PAGE));
    if (search.trim()) next.set('search', search.trim());
    if (stage) next.set('stage', stage);
    if (project) next.set('project', project);
    if (agent) next.set('agent', agent);
    if (source) next.set('source', source);
    if (country) next.set('country', country);
    if (language) next.set('language', language);
    if (added) next.set('added', added);
    return next.toString();
  }, [tab, search, stage, project, agent, source, country, language, added]);

  const leads = useAsync<ListResponse>(() => api.get(`/api/my-leads?${qs}`), [qs]);
  /* Deliberately unnarrowed, like it was: a tab says how many leads that
     question has in total, exactly as it does while a project or a stage is
     picked. The chips' own numbers are the narrowed ones. */
  const counts = useAsync<Record<string, number>>(() => api.get('/api/my-leads/counts'), []);
  /*
   * The country and language chips, counted by the server over the whole
   * filtered book rather than the fifty rows on this page — which is the only
   * reason it is an endpoint and not a loop over `rows`. The browser's
   * `dialling.ts` can read a flag off a number but has only ever seen one
   * page of them.
   */
  const facets = useAsync<LeadFacets>(() => api.get(`/api/my-leads/facets?${qs}`), [qs]);
  /*
   * The two lists, never undefined.
   *
   * `?? []` rather than trusting the shape: a screen ten people open every
   * morning must not go white because one key is missing from one response,
   * which is exactly what happened the first time this ran against a stubbed
   * API in `leads-call.test.ts`.
   */
  const countries = facets.data?.countries ?? [];
  const languages = facets.data?.languages ?? [];
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
    for (const key of ['stage', 'project', 'agent', 'source', 'country', 'language', 'added']) {
      next.delete(key);
    }
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
  /* The black bar's two other numbers, both from the counts endpoint: real
     calls out of Emir's own daily goal. No goal, no progress line. */
  const callsToday = counts.data?.callsToday ?? 0;
  const callGoal = counts.data?.callGoal ?? 0;

  /*
   * The same list, cut into the days the leads were given out on.
   *
   * Newest day first, "Not given out yet" last, and the order inside each day
   * left exactly as the server sent it — the tab decides that, and an agent
   * works down it.
   */
  /* The server's real per-day counts, so a band over a long list says how
     many that day holds rather than how many fitted on this page. */
  const dayTotals = useMemo(() => {
    const got = leads.data?.givenDays;
    if (!got) return undefined;
    return new Map<string | null, number>(got.map((d) => [d.day, d.count] as const));
  }, [leads.data]);
  const byDay = groupByGivenDay(rows, (row) => row.assigned_at, undefined, dayTotals);
  /*
   * The rows as the table really draws them — every day's leads in order,
   * the day headings left out. The side panel's arrow keys walk this, so
   * "the next lead" means the next one on screen rather than the next one in
   * some other ordering.
   */
  const drawn = useMemo(() => byDay.flatMap((day) => day.rows), [byDay]);

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
  /*
   * The two chip rows get a filter chip as well, so "Clear all" takes them
   * off and the row of chips says everything the list is narrowed to in one
   * place. The name comes from the facet the server sent — never from a
   * lookup here, which would have to invent a name for a code the server
   * could not read.
   */
  if (country) {
    const one = facets.data?.countries.find((row) => row.iso2 === country);
    chips.push({
      key: 'country',
      text: `Country: ${one ? `${one.flag} ${one.name}`.trim() : country}`,
    });
  }
  if (language) {
    const one = facets.data?.languages.find((row) => row.code === language);
    chips.push({ key: 'language', text: `Language: ${one?.label ?? language}` });
  }
  if (added) {
    const when = { today: 'Today', week: 'This week', month: 'This month' }[added] ?? added;
    chips.push({ key: 'added', text: `Added: ${when}` });
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
            /* Shorter than the computer's, because 390px will not hold the
               whole list — the line under the chips says the rest. */
            placeholder="Name, phone, country, language…"
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

        {/*
          * No country or language control on the phone, deliberately.
          *
          * §0 of Emir's 14 November list: *"Each phone screen is its own
          * layout from its picture… Do not squeeze the computer page."*
          * `design/screens/Leads.dc.html` draws a search box and one strip of
          * pills, and the filter row he redrew is the computer's. A phone
          * design for these two is a thing to draw, not to inherit, so it is
          * left for the phone pass — see `docs/v2/questions-filters.md`.
          *
          * What IS here is the way back out. A link carrying `?country=GB`
          * opens on a phone like any other, and without this the list would
          * be narrowed with nothing on screen saying so and no way to undo
          * it. One pill in the strip the design already draws, not a new
          * control.
          */}
        {chips.length > 0 && (
          <div className="v2-a-chips">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="v2-a-chip v2-a-chip-on"
                aria-label={`Remove ${chip.text}`}
                onClick={() => dropChip(chip.key)}
              >
                {chip.text} ×
              </button>
            ))}
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
              {/* Which chip emptied it, by name — same sentence as the
                  computer's, because the chip rows are on both. */}
              {narrowedTo(chips, search)
                ?? leads.data.empty.hint}
            </p>
            {chips.length > 0 && (
              <button type="button" className="d-btn v2-a-clear" onClick={clearAll}>
                Clear all filters
              </button>
            )}
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

      {/*
        * The black bar above the table — picture 01, point 9: *"Black bar on
        * top: leads ready to call, calls today with progress, Start
        * calling."*
        *
        * Three real numbers and nothing else. `todayCount` is the Today tab's
        * own count; `callsToday` and `callGoal` come back with the counts,
        * from `call_logs` and `DAILY_GOALS.calls` — Emir's own 40 from his
        * design package, sent by the server so that when Settings can set it
        * per agent there is one place to change. The progress line is drawn
        * from those two and from nothing else; if the counts have not landed
        * yet the bar waits rather than drawing an empty rail.
        *
        * Only over the agent's call list. The owner's book has no Today tab
        * and is not a call list.
        */}
      {!book && tab === 'today' && todayCount > 0 && (
        <div className="v2-callbar">
          <span className="v2-callbar-ic"><Icon name="phone" /></span>
          <div className="v2-callbar-main">
            <b className="v2-callbar-head">
              {todayCount} {todayCount === 1 ? 'lead is' : 'leads are'} ready to call
            </b>
            <span className="v2-callbar-sub">one at a time, VIP first</span>
          </div>
          {callGoal > 0 && (
            <div className="v2-callbar-prog">
              <span className="v2-callbar-count">
                {callsToday} of {callGoal} calls today
              </span>
              <span className="v2-callbar-rail">
                <span
                  className="v2-callbar-fill"
                  style={{ width: `${Math.min(100, Math.round((callsToday / callGoal) * 100))}%` }}
                />
              </span>
            </div>
          )}
          <Link className="d-btn d-primary v2-callbar-go" to="/v2/calling">
            <Icon name="phone" />Start calling · {todayCount} ready
          </Link>
        </div>
      )}

      {/*
        * One row: search, the dropdowns, the count on the right. Emir's own
        * §2.7 — *"One filter row: search | Stage | Project | Country |
        * Language | lead count on the right"* — and the owner's §3 adds Agent,
        * Source, Added and Export to the same row rather than a second one.
        * The two rows of chips that were here cost about 100px of the screen
        * the table has to live in.
        */}
      <div className="d-filters">
        <div className="d-input-icon">
          <Icon name="search" />
          <input
            className="d-input d-sm"
            type="search"
            value={search}
            aria-label="Search this list"
            /* A clean box: §2.5, *"Clean search box only. Remove the hint
               line."* It still takes a country, a language and awake/asleep —
               `searchClause` on the server does the matching — and the
               placeholder no longer recites them. */
            placeholder="Search in this list"
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

        {/*
          * Country and Language, as dropdowns with flags, counts and a search
          * inside. The numbers are the server's, over the whole filtered book
          * — see `server/src/leads/facets.ts`. They appear only once there is
          * more than one of them: a dropdown offering one choice is furniture.
          */}
        {countries.length > 1 && (
          <FilterPicker
            label="Country"
            value={country}
            options={countryOptions(facets.data ?? null)}
            allLabel="Every country"
            allCount={facets.data?.countryTotal ?? 0}
            searchHint="Find a country"
            onPick={(next) => narrow('country', next)}
          />
        )}
        {languages.length > 1 && (
          <FilterPicker
            label="Language"
            value={language}
            options={languageOptions(facets.data ?? null)}
            allLabel="Every language"
            allCount={facets.data?.languageTotal ?? 0}
            searchHint="Find a language"
            onPick={(next) => narrow('language', next)}
          />
        )}

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

        {/* "Added: any time" — picture 02's last dropdown. Dubai days: a lead
            that arrived at 02:00 Dubai arrived today. */}
        {book && (
          <select
            className="d-select d-sm"
            aria-label="Added"
            value={added}
            onChange={(e) => narrow('added', e.target.value)}
          >
            <option value="">Added: any time</option>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
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
        {/*
          * Export, beside the count — picture 02 §7. Owner and admin only,
          * and the server says so too: `/api/my-leads/export.csv` is behind
          * `requireAdmin` and `requirePermission('export')` and writes an
          * audit entry, so hiding the button is the courtesy, not the fence.
          */}
        {canExport && (
          <a
            className="d-btn d-sm"
            href={`/api/my-leads/export.csv?${qs}`}
            /* The browser downloads it; it never opens in the app. */
            download
          >
            <Icon name="download" />Export
          </a>
        )}
      </div>

      {leads.error && <ErrorNote>{leads.error}</ErrorNote>}
      {!leads.data && !leads.error && <Spinner />}

      {leads.data && (
        /*
         * No height and no overflow on this card: the table fits inside it,
         * so the card is not a scroll container and the header sticks to the
         * PAGE at the design's own `top:var(--tb-h)`. §2.9: "no sideways
         * scroll", "NO column on top of another".
         */
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
            /*
             * The column budget is keyed off this class, not off the page
             * class. An agent on their own All tab renders `p-all-leads`
             * with eight columns, not the owner's ten, and a budget written
             * for ten would have put a 32px tick-box width on their Lead
             * column.
             */
            <table className={`d-table d-sticky d-id-leads ${book ? 'v2-cols-book' : 'v2-cols-mine'}`}>
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
                  {/*
                    * The column Talha asked for. One word, because the header
                    * is 11px uppercase with letter-spacing and "GIVEN TO YOU"
                    * set the whole column's width — the title attribute says
                    * the rest.
                    */}
                  <th
                    className="v2-given-cell"
                    title={book ? 'When the lead was given to its agent' : 'When the lead was given to you'}
                  >
                    Given
                  </th>
                  {wide
                    ? (
                      <>
                        {!isAgent && <th>Agent</th>}
                        <th title="When this lead was last spoken to">Last contact</th>
                      </>
                    )
                    : <th>Local time</th>}
                  <th>{wide ? 'Attention · next step' : 'Next step'}</th>
                  {/*
                    * The buttons get a column of their own on both lists.
                    * §2.8: *"Call, WhatsApp and the menu at the end of the
                    * row, never over text."* On the owner's book they used to
                    * float over the next-step cell with a shadow drawn across
                    * whatever somebody was reading.
                    */}
                  <th />
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
                        book={book}
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
                        tight={tight}
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
                {/*
                  * Which filters, by name. "Take one filter away" over four
                  * dropdowns and two rows of chips is a sentence that leaves
                  * the reader to hunt, and the chip rows have made it easier
                  * to narrow down to nothing by accident.
                  */}
                {chips.length > 0 || search.trim()
                  ? narrowedTo(chips, search) ?? 'Take one filter away, or clear them all.'
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
            {/* "Back to Incoming" — §3.4's own words. "Move to Incoming"
                read as a third destination beside the agents; "back" says
                what it is, which is undoing an assignment. */}
            <Icon name="inbox" />Back to Incoming
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
          /*
           * §4.9: *"Arrow keys up and down move to the next lead in the
           * list."* The list is what is on screen — this tab, these filters,
           * in the day order the table draws — so it walks `drawn`, which is
           * the same array the rows come from, and clamps at both ends
           * rather than wrapping. Walking back round to the top from the
           * last lead is how an agent calls somebody twice.
           */
          onPrev={() => setPanelFor(stepTo(drawn, panelFor, -1))}
          onNext={() => setPanelFor(stepTo(drawn, panelFor, 1))}
          /* After a Won, a Lost, a transfer or a note, the row behind the
             panel is stale and the list does not know. */
          onChanged={() => { leads.reload(); counts.reload(); facets.reload(); }}
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
            {/* The flag goes on the line that already carries the clock —
                there is no table cell to put it in on a phone card. None at
                all where the dialling code is not one we know. */}
            {origin && <span className="v2-a-flag" aria-hidden>{flagOf(origin.iso2)}</span>}
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
  row, wide, book, showOwner, selectable, picked, movedTo, onTick, onOpen, onMenu, dial, tight,
}: {
  row: Row;
  wide: boolean;
  /**
   * The owner's whole book, not merely the wide layout.
   *
   * An agent on their own All tab is `wide` too, and taking Call and WhatsApp
   * off their row would have been the wrong half of the distinction: it is
   * the owner's ten-column book that has no room for them.
   */
  book: boolean;
  showOwner: boolean;
  /** Narrow window: the buttons are their icons, with the word in the label. */
  tight?: boolean;
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
  /* "Too early there — call after 13:00 Dubai time". The one rule about
     calling hours, shared with the moon on the country chips above. */
  const advice = origin ? whenToCall(local, origin.timeZone) : null;
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

  /*
   * The row's three buttons, in their own cell at the end of the row.
   *
   * §2.8: *"Call, WhatsApp and the menu at the end of the row, never over
   * text."* And §2.4's seventh point: a lead with no phone number shows "No
   * phone" in grey and **no Call button** — pressing Call on a lead there is
   * no number for is a dead end an agent should never be offered.
   *
   * Call and WhatsApp are the agent's list only. Picture 02 draws the
   * owner's book with no buttons on the row at all, and the owner's book has
   * three more columns to fit: at 1440px three buttons would leave the next
   * step 112px, which is the column §2.2 calls "always readable". The owner
   * keeps the ⋯ menu, and a row click opens the quick panel, where Call and
   * WhatsApp are — so nothing is unreachable, it is one tap further.
   */
  const actions = (
    <div className="d-row-actions">
      {phone && !book && (
        <a
          className={tight ? 'd-btn d-xs d-icon' : 'd-btn d-xs'}
          href={`tel:${phone}`}
          title="Call"
          aria-label={`Call ${row.full_name ?? 'this lead'}`}
          onClick={(e) => { e.preventDefault(); void dial.call(row); }}
        >
          <Icon name="phone" />{tight ? '' : 'Call'}
        </a>
      )}
      {phone && !book && (
        <a
          className={tight ? 'd-btn d-xs d-icon' : 'd-btn d-xs'}
          href={`https://wa.me/${phone.replace(/[^\d]/g, '')}`}
          target="_blank"
          rel="noreferrer"
          title="WhatsApp"
          aria-label="WhatsApp"
          onClick={(e) => { e.preventDefault(); void dial.whatsapp(row); }}
        >
          <Icon name="message-circle" />{tight ? '' : 'WhatsApp'}
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
            {/*
              * The flex lives on this span, never on the `td`. Flexing a table
              * cell makes it stop behaving like one: its bottom border drew at
              * the height of the content instead of the row, so every name had
              * a short line under it that stopped before the phone column.
              */}
            <span className="v2-t-cell">
              {/* A face on the owner's book too. Scanning two thousand rows by
                  name alone is reading; with a face it is recognising. */}
              <Avatar name={row.full_name ?? '?'} size={34} />
              <span className="v2-t-who">
                <span className="v2-t-nm">
                  {/* The whole name on hover: the column is 158px wide on a
                      book with nine other columns in it, so a long one
                      ellipsises, and a name is the thing you must be able to
                      read in full. */}
                  <Link
                    className="d-t-main"
                    to={to}
                    dir="auto"
                    title={row.full_name ?? undefined}
                  >
                    {row.full_name ?? 'Unnamed lead'}
                  </Link>
                  {row.is_vip === 1 && <span className="d-vip-tag">VIP</span>}
                </span>
                {/*
                  * The source used to sit under the name here. Emir's 14
                  * November pictures draw the lead cell as initials, name and
                  * the VIP tag and nothing else, and §2.6 is the complaint it
                  * was costing: rows about 130px tall with only four leads on
                  * a screen, where twelve should fit. The source is still on
                  * the lead page and in the side panel.
                  */}
              </span>
            </span>
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

      {/*
        * Grouped for reading aloud. This is the column an agent dictates
        * from, and it printed `+971501234567` in one run.
        *
        * No flag in front of it. There was one for a few hours on 14
        * November; it cost 22px of a column that has to hold
        * "+971 50 123 4567" without ever cutting it, and at 1440px the
        * number came out as "+971 50 1…". Emir's own pictures draw the cell
        * as the number alone, the flags are in the Country dropdown where he
        * asked for them, and the agent's list still names the country in its
        * Local time column.
        */}
      <td className="d-t-mono" dir="ltr">
        {/*
          * "No phone" in words, not "–". §2.4's seventh point. A dash is a
          * character somebody has to interpret; "No phone" is the answer. The
          * Call button is dropped for the same row, above.
          */}
        {phone
          ? spacedE164(phone)
          : <span className="v2-t-nophone">No phone</span>}
      </td>

      <td>
        {row.project_name ?? '–'}
        {!wide && wanted(row) && <span className="d-t-sub">{wanted(row)}</span>}
      </td>

      {/* The stage pill. Its cell never ellipsises: a pill either fits or it
          does not, and "Interested .." with the dots of a text overflow after
          it reads like a bug, because it is one. */}
      <td className="v2-t-stage">
        <span className={`d-chip d-stage-${STAGE_CHIP[row.stage_key] ?? 'new'}`}>
          {STAGE_LABEL[row.stage_key] ?? row.stage_key}
        </span>
      </td>

      {/*
        * When it was given out. The column is headed, so the cell drops the
        * "Given to you" and says only the date: the time alone on today's,
        * the day and time plus how long it has been sitting on anything
        * older, in warm amber.
        */}
      <td className="v2-given-cell"><GivenLine at={row.assigned_at} /></td>

      {wide
        ? (
          <>
            {showOwner && (
              /* `movedTo` is who it has just been given to: the row says so
                 straight away rather than waiting for the list to come back,
                 so the Undo in the toast is about something visible. */
              <td className={movedTo ? 'd-pulse-row' : undefined}>
                {/*
                  * The first name, as picture 02 draws it — "Rocky",
                  * "Nelson", "Talha", "Yuliia". The avatar carries the rest,
                  * the full name is one hover away, and the column is 100px
                  * wide on a book with nine other columns in it.
                  */}
                {(movedTo ?? row.owner_name)
                  ? (
                    <span className="d-person" title={(movedTo ?? row.owner_name) as string}>
                      <Avatar name={(movedTo ?? row.owner_name) as string} size={26} />
                      {String(movedTo ?? row.owner_name).split(' ')[0]}
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
                <span
                  className={advice && !advice.ok ? 'd-localtime v2-t-night' : 'd-localtime'}
                  title={advice ? advice.line : `${local.time} in ${origin.zoneLabel ?? origin.name}`}
                >
                  {/* The moon replaces the clock face when it is the wrong
                      hour there — the same rule as the chip above, and the
                      same `whenToCall()` that writes the hover. */}
                  {advice && !advice.ok
                    ? <span className="v2-t-moon" aria-label="night there now" role="img">🌙</span>
                    : <Icon name="clock" size={13} />}
                  {cityOf(origin)} {local.time}
                </span>
              )
              : <span className="d-localtime">–</span>}
          </td>
        )}

      {/*
        * The next step, and then the buttons in a cell of their own.
        *
        * §2.2's fourth point: *"Next step is wide and always readable. Red
        * when overdue, grey when empty."* It is the one column with no width
        * in the budget, so it takes whatever is left, and it is the same cell
        * on both lists now: the owner's used to hold the buttons on top of
        * the words with a shadow drawn over them.
        */}
      <td
        className={step.urgent ? 'd-next d-overdue' : step.none ? 'd-next d-muted' : 'd-next'}
        title={step.text}
      >
        {step.text}
      </td>
      <td className="v2-t-acts">{actions}</td>
    </tr>
  );
}
