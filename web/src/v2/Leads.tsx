import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';
import { clockIn, flagOf, originOf } from '../lib/dialling.js';

/**
 * The list an agent works from, in the v2 look.
 *
 * `docs/v2/pages.md` §8 is the specification. Everything here answers one of
 * its lines, and the two that matter most are the ones the live CRM gets
 * wrong today:
 *
 *   - the count under the tabs says how many you are looking at out of how
 *     many there are. "419" above a list of thirty is what Emir reported on
 *     11 November, and this list cannot do it: it says "50 of 419" and the
 *     button says how many more.
 *   - every row carries its own record. The link, the call and the WhatsApp
 *     button all take this lead's id from this row, never from anything
 *     remembered elsewhere. Four of the brokers who tested the design hit
 *     the opposite, and so did Emir's agents.
 */

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'new', label: 'New' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'no_next_step', label: 'No next step' },
  { key: 'vip', label: 'VIP' },
  { key: 'lost', label: 'Lost' },
  { key: 'all', label: 'All' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const PAGE = 50;

interface Row {
  id: string;
  contact_id: string;
  full_name: string | null;
  phone_e164: string | null;
  project_name: string | null;
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

/** The six stages, as the neutral pills the design asks for. */
const STAGE_LABEL: Record<string, string> = {
  new_lead: 'New',
  attempted_contact: 'Called',
  engaged_qualified: 'Interested',
  appointment_scheduled: 'Meeting',
  deal_sent: 'Offer',
  won: 'Won',
  lost: 'Lost',
};

function stageClass(stageKey: string): string {
  const map: Record<string, string> = {
    new_lead: 'new', attempted_contact: 'called', engaged_qualified: 'interested',
    appointment_scheduled: 'meeting', deal_sent: 'offer', won: 'won', lost: 'lost',
  };
  return `v2-stage v2-stage-${map[stageKey] ?? 'new'}`;
}

/**
 * What the next-step column says, and whether it is red.
 *
 * Red means late, or waiting on you — the same rule as the sidebar badges, so
 * the colour means one thing across the whole product.
 */
function nextStep(row: Row): { text: string; urgent: boolean } {
  if (row.returned_at) return { text: 'Came back to you', urgent: true };
  if (row.is_vip && !row.last_contact_at) return { text: 'VIP — not called yet', urgent: true };
  if (!row.next_step_at) return { text: 'No next step', urgent: false };
  const due = new Date(row.next_step_at);
  const late = due.getTime() < Date.now();
  const when = due.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const note = row.next_step_note ? ` · ${row.next_step_note}` : '';
  return { text: `${late ? 'Overdue' : 'Due'} ${when}${note}`, urgent: late };
}

export function V2Leads({ fixedTab }: { fixedTab?: TabKey } = {}) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  /* Follow-ups is this screen opened on what is late. The tab is then not the
     reader's to change, so the URL does not decide it. */
  const tab = fixedTab ?? (params.get('tab') as TabKey) ?? 'today';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [more, setMore] = useState<Row[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const qs = useMemo(() => {
    const next = new URLSearchParams();
    next.set('tab', tab);
    next.set('pageSize', String(PAGE));
    if (search.trim()) next.set('search', search.trim());
    return next.toString();
  }, [tab, search]);

  const leads = useAsync<ListResponse>(() => api.get(`/api/my-leads?${qs}`), [qs]);
  const counts = useAsync<Record<string, number>>(() => api.get('/api/my-leads/counts'), []);

  function chooseTab(key: TabKey) {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    setParams(next, { replace: true });
    /* A different tab is a different list: the pages already loaded belong
       to the old one and must not be carried over. */
    setMore([]);
    setPage(1);
  }

  async function showMore() {
    setLoadingMore(true);
    try {
      const batch = await api.get<ListResponse>(`/api/my-leads?${qs}&page=${page + 1}`);
      setMore((rows) => [...rows, ...batch.items]);
      setPage((n) => n + 1);
    } catch {
      /* The rows already on screen are still good; pressing again retries. */
    } finally {
      setLoadingMore(false);
    }
  }

  const rows = leads.data ? [...leads.data.items, ...more] : [];
  const total = leads.data?.total ?? 0;
  const todayCount = counts.data?.today ?? 0;
  const openCount = counts.data?.all ?? 0;

  return (
    <div className="v2-leads">
      <div className="v2-leads-head">
        <p className="v2-leads-sum">
          <b>{openCount.toLocaleString()}</b> open
          {todayCount > 0 && <> · <b>{todayCount}</b> to call today</>}
        </p>
        <div className="v2-leads-links">
          <Link to="/v2/incoming">Free leads</Link>
          <Link to="/v2/pipeline">Pipeline</Link>
        </div>
      </div>

      <div className="v2-leads-bar">
        <label className="v2-find">
          <Icon name="search" />
          <input
            type="search"
            value={search}
            placeholder="Search name, phone or project"
            onChange={(e) => { setSearch(e.target.value); setMore([]); setPage(1); }}
          />
        </label>
        {tab === 'today' && todayCount > 0 && (
          <Link to="/v2/calling" className="v2-start">
            <Icon name="phone" />Start calling · {todayCount} ready
          </Link>
        )}
      </div>

      {!fixedTab && (
      <div className="v2-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'v2-tab-b v2-tab-b-on' : 'v2-tab-b'}
            onClick={() => chooseTab(t.key)}
          >
            {t.label}
            {counts.data?.[t.key] ? <span className="v2-tab-n">{counts.data[t.key]}</span> : null}
          </button>
        ))}
      </div>
      )}

      {leads.error && <ErrorNote>{leads.error}</ErrorNote>}
      {!leads.data && !leads.error && <Spinner />}

      {leads.data && rows.length === 0 && (
        <div className="v2-empty">
          <span className="v2-empty-mark"><Icon name="users-round" /></span>
          <h2>{leads.data.empty.title}</h2>
          <p>{leads.data.empty.hint}</p>
          <Link to="/v2/leads/new" className="v2-add"><Icon name="plus" />Add a new lead</Link>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <ul className="v2-rows">
            {rows.map((row) => <LeadRow key={row.id} row={row} showOwner={user?.role !== 'agent'} />)}
          </ul>
          <div className="v2-more">
            <span className="v2-count">{rows.length.toLocaleString()} of {total.toLocaleString()}</span>
            {rows.length < total && (
              <button type="button" className="v2-btn" onClick={showMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Show ${Math.min(PAGE, total - rows.length)} more`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LeadRow({ row, showOwner }: { row: Row; showOwner: boolean }) {
  const step = nextStep(row);
  const origin = originOf(row.phone_e164);
  const local = origin ? clockIn(origin.timeZone) : null;
  const phone = row.phone_e164 ?? '';

  return (
    <li className="v2-row-lead">
      {/* The link carries this row's own id. Nothing is remembered between
          rows, which is how every route ended up opening the same lead in
          the design the brokers tested. */}
      <Link to={`/v2/leads/${row.id}`} className="v2-row-main">
        <Avatar name={row.full_name ?? '?'} />
        <span className="v2-row-who">
          <span className="v2-row-name" dir="auto">
            {row.full_name ?? 'Unnamed lead'}
            {row.is_vip === 1 && <span className="v2-vip">VIP</span>}
          </span>
          <span className="v2-row-sub">
            {[row.project_name, showOwner ? row.owner_name : null].filter(Boolean).join(' · ') || '—'}
          </span>
        </span>
      </Link>

      <span className="v2-row-phone" dir="ltr">{phone || '—'}</span>

      {/*
        * What time it is for the client. An agent calling Germany at 06:00
        * Dubai is calling at 03:00 their time, and the number alone does not
        * say so.
        *
        * Twelve hour here, and only here. v3 §5 says a 24-hour clock
        * everywhere, and every CRM time obeys that -- but Emir asked for this
        * one by name on 10 Nov ("should be 12 hours time, not 16 17 18"), and
        * he is right about it: the point of the column is to be read at a
        * glance without doing a sum, and "3 PM" needs no sum. Written down in
        * docs/v2/decisions.md so it is a choice rather than an oversight.
        */}
      <span className="v2-row-where">
        {origin && local ? (
          <>
            <span className="v2-flag">{flagOf(origin.iso2)}</span>
            <span className="v2-local" title={`${local.time} in ${origin.zoneLabel ?? origin.name}`}>
              {local.time}
            </span>
          </>
        ) : <span className="v2-local">—</span>}
      </span>

      <span className={stageClass(row.stage_key)}>{STAGE_LABEL[row.stage_key] ?? row.stage_key}</span>

      <span className={step.urgent ? 'v2-step v2-step-urgent' : 'v2-step'}>{step.text}</span>

      <span className="v2-row-do">
        <a className="v2-do v2-do-call" href={phone ? `tel:${phone}` : undefined} aria-label="Call">
          <Icon name="phone" />
        </a>
        <a
          className="v2-do v2-do-wa"
          href={phone ? `https://wa.me/${phone.replace(/[^\d]/g, '')}` : undefined}
          target="_blank"
          rel="noreferrer"
          aria-label="WhatsApp"
        >
          <Icon name="message-circle" />
        </a>
      </span>
    </li>
  );
}
