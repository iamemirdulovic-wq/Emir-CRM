import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote, budgetLabel } from '../design/ui.js';
import { SOURCE_STYLES } from '../design/stages.js';
import { clockIn, originOf } from '../lib/dialling.js';

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

/** The tab strip, in the design's order. `hot` is a chip, not a tab. */
const TABS: Array<{ key: TabKey; label: string; red?: boolean }> = [
  { key: 'today', label: 'Today' },
  { key: 'new', label: 'New' },
  { key: 'overdue', label: 'Overdue', red: true },
  { key: 'no_next_step', label: 'No next step' },
  { key: 'vip', label: 'VIP' },
  { key: 'lost', label: 'Lost' },
  { key: 'all', label: 'All' },
];

export type TabKey =
  | 'today' | 'new' | 'hot' | 'overdue' | 'no_next_step' | 'vip' | 'lost' | 'all';

const PAGE = 50;

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

/** The second line of the project cell: what they asked for. */
function wanted(row: Row): string {
  const budget = row.budget_min_aed || row.budget_max_aed
    ? budgetLabel(row.budget_min_aed, row.budget_max_aed, row.budget_band ?? null)
    : null;
  return [row.unit_type, budget].filter(Boolean).join(' · ');
}

export function V2Leads({ fixedTab }: { fixedTab?: TabKey } = {}) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  /* Follow-ups is this screen opened on what is late. The tab is then not the
     reader's to change, so the URL does not decide it. */
  const tab = (fixedTab ?? (params.get('tab') as TabKey) ?? 'today') as TabKey;
  const [search, setSearch] = useState('');
  /* Rows fetched by "Show more", tied to the query they belong to: a different
     tab or filter is a different list, and the old pages must not be shown
     under it. */
  const [extra, setExtra] = useState<{ key: string; rows: Row[]; pages: number }>(
    { key: '', rows: [], pages: 1 },
  );
  const [loadingMore, setLoadingMore] = useState(false);
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
  const wide = tab === 'all' || tab === 'hot';
  const isAgent = user?.role === 'agent';

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
  const projects = useAsync<{ items: Array<{ id: string; name: string }> }>(
    () => api.get('/api/projects?includeUnverified=1'), [],
  );
  /* Who to narrow by. Only the wide screen has the control, and an agent never
     sees it — they only ever hold their own leads. */
  const people = useAsync<{ items: Person[] }>(
    () => (wide && !isAgent ? api.get('/api/users') : Promise.resolve({ items: [] })),
    [wide, isAgent],
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

  return (
    <div className={wide ? 'v2-leadlist p-all-leads' : 'v2-leadlist p-my-leads'}>
      <div className="v2-page-head v2-leadlist-head">
        {!fixedTab && (
          <div
            ref={tabStrip}
            className={wide ? 'd-tabs d-pills d-lead-tabs' : 'd-tabs d-pills'}
            role="tablist"
          >
            {TABS.map((one) => {
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
        <div className="v2-leadlist-links">
          <Link className="d-btn d-sm d-ghost" to="/v2/incoming">
            <Icon name="inbox" />Free leads
          </Link>
          <Link className="d-btn d-sm d-ghost" to="/v2/pipeline">
            <Icon name="kanban" />Pipeline
          </Link>
        </div>
      </div>

      {/* The strip that starts the day. Only over the Today tab, which is the
          only list that is a call list. */}
      {tab === 'today' && todayCount > 0 && (
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
            <option key={one.id} value={one.name}>{one.name}</option>
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
          {rows.length > 0 && (
            <table className="d-table d-sticky d-id-leads">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Phone</th>
                  <th>Project</th>
                  <th>Stage</th>
                  {wide
                    ? <>{!isAgent && <th>Agent</th>}<th>Last contact</th></>
                    : <th>Local time</th>}
                  <th>{wide ? 'Attention · next step' : 'Next step'}</th>
                  {!wide && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <LeadRow
                    key={row.id}
                    row={row}
                    wide={wide}
                    showOwner={wide && !isAgent}
                  />
                ))}
              </tbody>
            </table>
          )}

          {rows.length === 0 && (
            <div className="d-empty">
              <span className="d-ic"><Icon name="users" size={26} /></span>
              <b>{leads.data.empty.title}</b>
              <p>
                {chips.length > 0 || search.trim()
                  ? 'Nothing matches. Clear the filters, or try another name.'
                  : leads.data.empty.hint}
              </p>
              <Link className="d-btn d-sm" to="/v2/leads/new"><Icon name="plus" />Add a new lead</Link>
            </div>
          )}

          {rows.length > 0 && (
            <div className="d-table-foot">
              <span>1–{rows.length.toLocaleString()} of {total.toLocaleString()}</span>
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
    </div>
  );
}

function LeadRow({ row, wide, showOwner }: { row: Row; wide: boolean; showOwner: boolean }) {
  const navigate = useNavigate();
  const step = nextStep(row);
  const origin = originOf(row.phone_e164);
  const local = origin ? clockIn(origin.timeZone) : null;
  const phone = row.phone_e164 ?? '';
  const to = `/v2/leads/${row.id}`;

  /* The row opens the lead, and the buttons in it do their own job. Nothing is
     remembered between rows: every link is built from this row. */
  function open(event: MouseEvent<HTMLTableRowElement>) {
    if ((event.target as HTMLElement).closest('a,button,input,label')) return;
    navigate(to);
  }

  const actions = (
    <div className="d-row-actions">
      {phone && (
        <a className="d-btn d-xs" href={`tel:${phone}`} aria-label={`Call ${row.full_name ?? 'this lead'}`}>
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
        >
          <Icon name="message-circle" />WhatsApp
        </a>
      )}
      <Link className="d-btn d-xs d-icon" to={to} aria-label="Open the lead">
        <Icon name="external-link" />
      </Link>
    </div>
  );

  return (
    <tr
      data-href={to}
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) navigate(to); }}
    >
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

      <td className="d-t-mono" dir="ltr">{phone || '–'}</td>

      <td>
        {row.project_name ?? '–'}
        {!wide && wanted(row) && <span className="d-t-sub">{wanted(row)}</span>}
      </td>

      <td>
        <span className={`d-chip d-stage-${STAGE_CHIP[row.stage_key] ?? 'new'}`}>
          {STAGE_LABEL[row.stage_key] ?? row.stage_key}
        </span>
      </td>

      {wide
        ? (
          <>
            {showOwner && (
              <td>
                {row.owner_name
                  ? (
                    <span className="d-person">
                      <Avatar name={row.owner_name} size={26} />
                      {row.owner_name}
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
