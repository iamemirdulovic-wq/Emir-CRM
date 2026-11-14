import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatAedShort, humanize, maskPhone, relativeTime } from '../lib/format.js';
import { Icon, SkeletonRows, Tabs, type TabItem } from '../design/index.js';
import { given, groupByGivenDay } from '../lib/assigned.js';
import { Avatar, Empty, ErrorNote, Score, StagePill } from '../design/ui.js';
import type { StageKey } from '../lib/types.js';
import { Button } from '../design/forms.js';
import { LeadActionBar, LeadActionSheets, useLeadActions } from '../components/LeadActions.js';
import { useShellSearch } from '../components/Layout.js';

/**
 * My Leads — what an agent opens the CRM to look at.
 *
 * The old Contacts screen answered "who is in the database". That is a
 * librarian's question. This one answers the two an agent actually has: what
 * do I owe today, and who have I let go quiet. Hence the default tab being
 * Follow-up today rather than All.
 */

/*
 * `lost` and `won` are here because `all` stopped meaning "every row".
 *
 * It used to, and an agent asked why the leads he had marked Lost months ago
 * were still in his working list -- "they must be somewhere archived". They
 * are now: All is what is still worth a call, and the two closed states have
 * a tab each. Taking them out of All without giving them somewhere to go
 * would have hidden them instead of tidying them.
 */
type Tab = 'today' | 'new' | 'hot' | 'overdue' | 'no_next_step' | 'lost' | 'won' | 'all';

interface Lead {
  id: string;
  contact_id: string;
  stage_key: StageKey;
  status: string;
  project_name: string | null;
  source: string | null;
  budget_max_aed: number | null;
  lead_score: number | null;
  score_band: 'hot' | 'warm' | 'cold' | null;
  score_reason: string | null;
  next_step_type: string | null;
  next_step_at: string | null;
  next_step_note: string | null;
  last_contact_at: string | null;
  no_answer_count: number;
  created_at: string;
  /**
   * When this lead was handed to the agent who holds it.
   *
   * Talha, 14 Nov 2026, over a screenshot of 105 new leads in which every row
   * looked the same: "you need to put dates on the leads once they assign, so
   * we know which one is today leads, which one is yesterday, and which one is
   * day before yesterday."
   *
   * `assigned_at`, not `created_at`. Null when the lead has never been given
   * out, or has gone back to the pool, and the row says so in words rather
   * than borrowing the date beside it.
   */
  assigned_at: string | null;
  full_name: string | null;
  phone_e164: string | null;
  email: string | null;
  owner_name: string | null;
}

interface ListResponse {
  tab: Tab;
  items: Lead[];
  total: number;
  page: number;
  pageSize: number;
  empty: { title: string; hint: string };
}

/*
 * How many leads come down at once.
 *
 * Fifty is the server's ceiling, and the right number here: Emir, 11 Nov --
 * "we have leads means new 419, but we can't see all the leads." The tab
 * counted four hundred and nineteen and the list stopped at thirty, with
 * nothing on screen to say there was more or any way to reach it.
 */
const PAGE_SIZE = 50;

const TAB_LABELS: Record<Tab, string> = {
  today: 'Follow-up today',
  new: 'New',
  hot: 'Hot',
  overdue: 'Overdue',
  no_next_step: 'No next step',
  /* The looking-back pair, after the work and before All. */
  lost: 'Lost',
  won: 'Won',
  all: 'All',
};

export function MyLeads() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'today';
  /* The one in the top bar, not a second box on the page. Two search fields
     on one screen is a question about which one to use. */
  const { value: search } = useShellSearch();
  const [debounced, setDebounced] = useState(search);
  const [reloadKey, setReloadKey] = useState(0);

  /* 300ms, so a four-letter name is one query rather than four. */
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  /* Arrives from an import's "see these leads" link. Kept in the URL so the
     filtered view can be sent to somebody. */
  const tag = params.get('tag');

  const qs = useMemo(() => {
    const next = new URLSearchParams();
    next.set('tab', tab);
    next.set('pageSize', String(PAGE_SIZE));
    if (debounced) next.set('search', debounced);
    if (tag) next.set('tag', tag);
    return next.toString();
  }, [tab, debounced, tag]);

  const leads = useAsync<ListResponse>(() => api.get(`/api/my-leads?${qs}`), [qs, reloadKey]);
  const counts = useAsync<Record<Tab, number>>(() => {
    const next = new URLSearchParams();
    if (debounced) next.set('search', debounced);
    if (tag) next.set('tag', tag);
    const query = next.toString();
    return api.get(`/api/my-leads/counts${query ? `?${query}` : ''}`);
  }, [debounced, tag, reloadKey]);

  const refresh = useCallback(() => setReloadKey((n) => n + 1), []);

  /*
   * Pages after the first, kept beside the first rather than replacing it.
   *
   * "Show more" rather than numbered pages: this is a call list worked from
   * the top down, and a page that swaps under you loses your place in it.
   */
  const [more, setMore] = useState<Lead[]>([]);
  const [nextPage, setNextPage] = useState(2);
  const [loadingMore, setLoadingMore] = useState(false);

  /* A different tab, search or batch is a different list: start again. */
  useEffect(() => {
    setMore([]);
    setNextPage(2);
  }, [qs, reloadKey]);

  const shown = (leads.data?.items.length ?? 0) + more.length;
  const total = leads.data?.total ?? 0;

  async function showMore() {
    setLoadingMore(true);
    try {
      const batch = await api.get<ListResponse>(`/api/my-leads?${qs}&page=${nextPage}`);
      setMore((rows) => [...rows, ...batch.items]);
      setNextPage((n) => n + 1);
    } catch {
      /* Left on screen deliberately: the rows already loaded are still
         good, and a failed "show more" is retried by pressing it again. */
    } finally {
      setLoadingMore(false);
    }
  }

  const tabs: TabItem<Tab>[] = (Object.keys(TAB_LABELS) as Tab[]).map((value) => ({
    value,
    label: TAB_LABELS[value],
    count: counts.data?.[value] ?? null,
    /* Two counts are warnings rather than information: a lead nobody is
       coming back to, and one nobody has spoken to in two days. */
    alarm: value === 'overdue' || value === 'no_next_step',
  }));

  return (
    <section id="my-leads">
      {tag && (
        /* Named, not just applied: a filter you cannot see is a list that
           looks wrong for no reason. */
        <div className="lead-filter">
          <Icon name="target" size={14} />
          Showing one batch · <b>{tag.replace(/^batch:/, '')}</b>
          <button
            type="button"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete('tag');
              setParams(next, { replace: true });
            }}
          >
            <Icon name="x" size={13} />
            Clear
          </button>
        </div>
      )}

      <Tabs
        label="Lead views"
        value={tab}
        onChange={(next) => {
          const updated = new URLSearchParams(params);
          updated.set('tab', next);
          setParams(updated, { replace: true });
        }}
        tabs={tabs}
      />

      {leads.error && <ErrorNote>{leads.error}</ErrorNote>}
      {!leads.data && !leads.error && <SkeletonRows rows={6} />}

      {leads.data && leads.data.items.length === 0 && (
        <Empty icon="check-check" title={leads.data.empty.title} hint={leads.data.empty.hint} />
      )}

      {leads.data && leads.data.items.length > 0 && (
        <>
          {/*
            * Cut into the days the leads were given out on — "Today",
            * "Yesterday", then the weekday and the date — because that is
            * exactly how the agent described the problem, so it is the shape
            * of the answer. Newest day first; the order inside a day is the
            * tab's own, which is what an agent works down.
            */}
          <ul className="leads-list">
            {groupByGivenDay(
              [...leads.data.items, ...more],
              (lead) => lead.assigned_at,
            ).map((day) => (
              <Fragment key={day.key ?? 'none'}>
                <li className="lead-day">
                  <b>{day.heading}</b>
                  <span>{day.count}</span>
                </li>
                {day.rows.map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    tab={tab}
                    onChanged={refresh}
                    showOwner={user?.role !== 'agent'}
                  />
                ))}
              </Fragment>
            ))}
          </ul>

          {/* Always says where you are in the list, even at the end of it:
              "603 of 603" is the answer to "have I seen them all?" */}
          <div className="leads-more">
            <span className="leads-count">
              {shown.toLocaleString()} of {total.toLocaleString()}
            </span>
            {shown < total && (
              <Button variant="ghost" onClick={showMore} disabled={loadingMore}>
                {loadingMore
                  ? 'Loading…'
                  : `Show ${Math.min(PAGE_SIZE, total - shown).toLocaleString()} more`}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function LeadRow({
  lead, tab, onChanged, showOwner,
}: { lead: Lead; tab: Tab; onChanged: () => void; showOwner: boolean }) {
  const actions = useLeadActions(lead.id, onChanged);
  const due = dueState(lead.next_step_at);

  return (
    <li className="lead-row">
      {/* The tab travels with the lead, so the back chip and "Next lead"
          both know which list this came off. */}
      <Link to={`/contacts/${lead.contact_id}?from=${tab}`} className="lead-main">
        <Avatar name={lead.full_name ?? '?'} />
        <span className="lead-who">
          <span className="lead-name" dir="auto">{lead.full_name ?? 'Unnamed lead'}</span>
          <span className="lead-meta" dir="auto">
            {[lead.project_name, formatAedShort(lead.budget_max_aed)]
              .filter((part) => part && part !== '—').join(' · ')}
            {/* Dropped on a narrow screen: the project and the budget are what
                decide whether to ring, and the Call button is an inch away. */}
            {lead.phone_e164 && <span className="lead-phone"> · {maskPhone(lead.phone_e164)}</span>}
          </span>
          {/*
            * When it was given to this agent. A third line inside the name
            * cell rather than a sixth column, so the row's grid — and the two
            * breakpoints under it — are left alone.
            *
            * Today reads "Given to you 11:42"; anything older reads
            * "Yesterday 16:30 · 21 h ago" in warm amber, so a two-day-old
            * lead with no call on it looks wrong at a glance. A lead that has
            * never been given out says so.
            */}
          <GivenOn at={lead.assigned_at} label={showOwner ? 'Given' : 'Given to you'} />
        </span>
      </Link>

      <span className="lead-tags">
        <StagePill stage={lead.stage_key} label={humanize(lead.stage_key)} />
        {lead.lead_score !== null && <Score value={lead.lead_score} />}
        {showOwner && lead.owner_name && <span className="lead-owner">{lead.owner_name}</span>}
      </span>

      <span className={`lead-next ${due.tone}`}>
        {lead.next_step_at ? (
          <>
            <Icon name={due.icon} size={13} />
            {due.label}
          </>
        ) : (
          /* Said plainly rather than left blank: a blank cell reads as
             "nothing to do", and this is the opposite of that. */
          <>
            <Icon name="circle-alert" size={13} />
            No next step
          </>
        )}
      </span>

      <span className="lead-last">
        {lead.last_contact_at ? relativeTime(lead.last_contact_at) : 'Never called'}
      </span>

      <LeadActionBar lead={lead} state={actions} compact />
      <LeadActionSheets state={actions} />
    </li>
  );
}

/**
 * "Given to you 11:42" — one line, warm once it is not today's.
 *
 * `label` is "Given to you" on an agent's own list and a plain "Given" to a
 * manager or the owner, who is reading somebody else's row.
 */
function GivenOn({ at, label }: { at: string | null; label: string }) {
  const line = given(at);
  const tone = line.stale ? ' lead-given-old' : line.missing ? ' lead-given-none' : '';
  return (
    <span className={`lead-given${tone}`} title={line.exact ?? undefined}>
      {line.missing ? line.text : `${label} ${line.text}`}
    </span>
  );
}

/** How the promised time should read, and in what colour. */
function dueState(at: string | null): { tone: string; label: string; icon: 'alarm-clock' | 'clock-3' | 'calendar-check' } {
  if (!at) return { tone: 'none', label: 'No next step', icon: 'circle-alert' as never };
  const due = new Date(at);
  const now = new Date();
  if (due.getTime() <= now.getTime()) return { tone: 'overdue', label: `Overdue · ${relativeTime(at)}`, icon: 'alarm-clock' };

  const sameDay = Math.floor((due.getTime() + 4 * 3_600_000) / 86_400_000)
    === Math.floor((now.getTime() + 4 * 3_600_000) / 86_400_000);
  if (sameDay) {
    return {
      tone: 'today',
      label: `Today ${new Intl.DateTimeFormat('en-AE', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false }).format(due)}`,
      icon: 'clock-3',
    };
  }
  return { tone: 'soon', label: relativeTime(at), icon: 'calendar-check' };
}
