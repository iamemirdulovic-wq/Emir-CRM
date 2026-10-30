import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatAedShort, humanize, maskPhone, relativeTime } from '../lib/format.js';
import { Icon, SkeletonRows, Tabs, type TabItem } from '../design/index.js';
import { Avatar, Empty, ErrorNote, Score, StagePill } from '../design/ui.js';
import type { StageKey } from '../lib/types.js';
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

type Tab = 'today' | 'new' | 'hot' | 'overdue' | 'no_next_step' | 'all';

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
  full_name: string | null;
  phone_e164: string | null;
  email: string | null;
  owner_name: string | null;
}

interface ListResponse {
  tab: Tab;
  items: Lead[];
  total: number;
  empty: { title: string; hint: string };
}

const TAB_LABELS: Record<Tab, string> = {
  today: 'Follow-up today',
  new: 'New',
  hot: 'Hot',
  overdue: 'Overdue',
  no_next_step: 'No next step',
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

  const qs = useMemo(() => {
    const next = new URLSearchParams();
    next.set('tab', tab);
    if (debounced) next.set('search', debounced);
    return next.toString();
  }, [tab, debounced]);

  const leads = useAsync<ListResponse>(() => api.get(`/api/my-leads?${qs}`), [qs, reloadKey]);
  const counts = useAsync<Record<Tab, number>>(
    () => api.get(`/api/my-leads/counts${debounced ? `?search=${encodeURIComponent(debounced)}` : ''}`),
    [debounced, reloadKey],
  );

  const refresh = useCallback(() => setReloadKey((n) => n + 1), []);

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
        <ul className="leads-list">
          {leads.data.items.map((lead) => (
            <LeadRow key={lead.id} lead={lead} onChanged={refresh} showOwner={user?.role !== 'agent'} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LeadRow({
  lead, onChanged, showOwner,
}: { lead: Lead; onChanged: () => void; showOwner: boolean }) {
  const actions = useLeadActions(lead.id, onChanged);
  const due = dueState(lead.next_step_at);

  return (
    <li className="lead-row">
      <Link to={`/contacts/${lead.contact_id}`} className="lead-main">
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
