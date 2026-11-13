import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';

/**
 * The board, from `design/web/pipeline.html`.
 *
 * Six columns across, Lost kept apart in a strip underneath, and a note in
 * the filter row that says out loud what the design decided: **no drag.** A
 * stage changes when somebody saves a call, a meeting, an offer or Won on the
 * lead itself, which is what `LeadAction` already does. Dragging a card was
 * the one way to move a lead without recording *why* it moved, and a Lost
 * with no reason and a Won with no unit teach nobody anything.
 *
 * Everything with a number on it is counted by the server: the column totals
 * come from `/api/pipeline/board`, the percentages are those totals over
 * their own sum, and the "open leads" count is every stage except Won and
 * Lost. Nothing here is worked out from the handful of cards on screen.
 */

interface Card {
  id: string;
  contact_id: string;
  stage_key: string;
  title?: string | null;
  full_name?: string | null;
  phone_e164?: string | null;
  project_name?: string | null;
  unit_type?: string | null;
  budget_band?: string | null;
  owner_user_id?: string | null;
  owner_name?: string | null;
  stage_changed_at?: string | null;
  last_inbound_at?: string | null;
  sla_due_at?: string | null;
  sla_breached?: number | null;
}

interface Column {
  stageKey: string;
  stageName: string;
  position: number;
  total: number;
  cards: Card[];
}

interface Person { id: string; name: string; role: string }

/** The design's own words for our stage keys, and its colour class per column. */
const STAGE: Record<string, { label: string; tone: string }> = {
  new_lead: { label: 'New', tone: 'new' },
  attempted_contact: { label: 'Called', tone: 'called' },
  engaged_qualified: { label: 'Interested', tone: 'interested' },
  appointment_scheduled: { label: 'Meeting', tone: 'meeting' },
  deal_sent: { label: 'Offer', tone: 'offer' },
  won: { label: 'Won', tone: 'won' },
  lost: { label: 'Lost', tone: 'lost' },
};

/** Five cards a column, then a link to the list. Straight from the design. */
const SHOW = 5;

export function V2Pipeline() {
  const { user } = useAuth();
  const seesEveryone = user?.role !== 'agent';

  const [search, setSearch] = useState('');
  const [project, setProject] = useState('');
  const [agent, setAgent] = useState('');
  const typed = useDebounced(search.trim(), 300);

  const query = new URLSearchParams();
  if (typed) query.set('search', typed);
  if (project) query.set('projectName', project);
  if (agent) query.set('ownerUserId', agent);

  const board = useAsync<{ columns: Column[] }>(
    () => api.get(`/api/pipeline/board?${query.toString()}`),
    [typed, project, agent],
  );

  /* The agent list is the team, not the agents who happen to have a card on
     the board — an owner looking for "who has nothing in Offer" needs to be
     able to pick the person with nothing. */
  const team = useAsync<{ items: Person[] }>(
    () => (seesEveryone ? api.get('/api/v2/team') : Promise.resolve({ items: [] })),
    [seesEveryone],
  );

  /*
   * The projects in the dropdown are the ones on the board, remembered.
   *
   * Picking a project narrows the board to it, and reading the list back off
   * the narrowed board would leave the dropdown holding one option — the one
   * already chosen — with no way back. So the names only ever accumulate.
   */
  const [seen, setSeen] = useState<string[]>([]);
  const loaded = board.data;
  useEffect(() => {
    if (!loaded) return;
    setSeen((was) => {
      const names = new Set(was);
      for (const column of loaded.columns) {
        for (const card of column.cards) if (card.project_name) names.add(card.project_name);
      }
      return names.size === was.length ? was : [...names].sort((a, b) => a.localeCompare(b));
    });
  }, [loaded]);

  if (board.error) return <ErrorNote>{board.error}</ErrorNote>;
  if (!board.data) return <Spinner />;

  const filtered = Boolean(typed || project || agent);
  const columns = board.data.columns.filter((one) => one.stageKey !== 'lost');
  const lost = board.data.columns.find((one) => one.stageKey === 'lost');

  /* The percentage in a column head is that stage's share of everything on
     the board, Lost included, which is how the design reads it. */
  const everything = board.data.columns.reduce((sum, one) => sum + one.total, 0);
  const open = columns.reduce((sum, one) => (one.stageKey === 'won' ? sum : sum + one.total), 0);

  return (
    <div className="v2-pipe p-pipeline">
      <div className="d-filters v2-pipe-filters">
        <div className="d-input-icon">
          <Icon name="search" />
          <input
            className="d-input d-sm"
            value={search}
            aria-label="Name or project"
            placeholder="Name or project"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {seesEveryone && (
          <select
            className="d-select d-sm"
            value={agent}
            aria-label="Agent"
            onChange={(e) => setAgent(e.target.value)}
          >
            <option value="">
              Agent: all{team.data ? ` ${team.data.items.length}` : ''}
            </option>
            {team.data?.items.map((one) => (
              <option key={one.id} value={one.id}>{one.name}</option>
            ))}
          </select>
        )}

        <select
          className="d-select d-sm"
          value={project}
          aria-label="Project"
          onChange={(e) => setProject(e.target.value)}
        >
          <option value="">Project: all</option>
          {seen.map((one) => <option key={one} value={one}>{one}</option>)}
        </select>

        <span className="d-grow" />

        <span className="d-how">
          <Icon name="lock" size={14} />
          No drag. A stage changes when you save a call, a meeting, an offer or Won.
        </span>

        <span className="d-result-count">
          {/* Counted by the server either way, not by adding up the cards on
              screen — each column only sends its first page of them. */}
          {filtered
            ? `${everything.toLocaleString('en-GB')} found`
            : `${open.toLocaleString('en-GB')} open lead${open === 1 ? '' : 's'}${
              seesEveryone && !agent ? ' · every agent' : ''}`}
        </span>
      </div>

      <div className="d-kanban">
        {columns.map((column) => {
          const tone = STAGE[column.stageKey]?.tone ?? 'new';
          const shown = column.cards.slice(0, SHOW);
          /* When a filter is on, the server has already counted only the
             matches, so "+N more" is still the honest difference. */
          const more = column.total - shown.length;

          return (
            <section className={`d-kb-col d-${tone}`} key={column.stageKey}>
              <div className="d-kb-head">
                <span className={`d-chip d-stage-${tone}`}>
                  {STAGE[column.stageKey]?.label ?? column.stageName}
                </span>
                <span className="d-grow" />
                {/* Won is a running total of every unit ever booked, not a
                    share of what is open, so it carries no percentage. */}
                {column.stageKey !== 'won' && everything > 0 && (
                  <span className="d-pc">{Math.round((column.total / everything) * 100)}%</span>
                )}
                <b className="d-ct">{column.total.toLocaleString('en-GB')}</b>
              </div>
              <div className="d-kb-bar" />

              {shown.map((card) => (
                <LeadCard key={card.id} card={card} showAgent={seesEveryone} />
              ))}

              {shown.length === 0 && (
                <div className="d-small d-muted d-center v2-kb-none">No leads here</div>
              )}

              {more > 0 && (
                <Link className="d-kb-more" to="/v2/leads?tab=all">+ {more} more</Link>
              )}
            </section>
          );
        })}
      </div>

      {lost && (
        <div className="d-lost-strip">
          <span className="d-chip d-stage-lost">Lost</span>
          <b className="d-bold">{lost.total.toLocaleString('en-GB')}</b>
          <span className="d-small d-muted">kept apart · not counted in open leads</span>
          <span className="d-row d-gap-8 v2-lost-cards">
            {lost.cards.slice(0, 2).map((card) => (
              <Link className="d-kb-card" key={card.id} to={`/v2/leads/${card.id}`}>
                <b>{nameOf(card)}</b>
                <span className="d-t-sub">{describe(card)}</span>
              </Link>
            ))}
          </span>
          <span className="d-grow" />
          <Link className="d-card-link" to="/v2/leads?tab=lost">
            See all lost <Icon name="arrow-right" size={14} />
          </Link>
        </div>
      )}
    </div>
  );
}

/* ── one card ──────────────────────────────────────────────────────────── */

function LeadCard({ card, showAgent }: { card: Card; showAgent: boolean }) {
  const next = latest(card);

  return (
    <div className="d-kb-card">
      {/*
       * The whole card opens the lead, as the design has it. The link is
       * stretched over the card rather than wrapped around it because Call
       * sits inside, and an anchor cannot hold another anchor.
       */}
      <Link className="v2-kb-hit" to={`/v2/leads/${card.id}`} aria-label={nameOf(card)} />

      <div className="d-nm"><b>{nameOf(card)}</b></div>
      <span className="d-t-sub">{describe(card)}</span>

      <div className="d-ft">
        {/* The design hangs the agent's name off the avatar as a tooltip; an
            avatar is two letters and nobody learns ten of them. */}
        {showAgent && card.owner_name && (
          <span title={card.owner_name}><Avatar name={card.owner_name} size={20} /></span>
        )}
        <span className={next.urgent ? 'd-nx d-red' : 'd-nx'}>{next.text}</span>
        {card.phone_e164 && (
          <a className="d-btn d-xs v2-kb-call" href={`tel:${card.phone_e164}`}>
            <Icon name="phone" size={14} />Call
          </a>
        )}
      </div>
    </div>
  );
}

function nameOf(card: Card): string {
  return card.full_name ?? card.title ?? 'No name yet';
}

/** "The Archive · 2BR" — the project, then whatever we know about the unit. */
function describe(card: Card): string {
  const unit = card.unit_type ?? card.budget_band ?? null;
  return [card.project_name ?? 'No project yet', unit].filter(Boolean).join(' · ');
}

/**
 * The one line under a card: where this lead stands, and whether it is late.
 *
 * Deliberately short of what the design draws. Its cards say things like
 * "Site visit Thu 11:00", which is the lead's next step — and the board
 * endpoint does not send `next_step_at`, so inventing a plausible one here
 * would be worse than being brief. What the board does send is the clock, the
 * last reply and when the stage last changed, and all three are true.
 */
function latest(card: Card): { text: string; urgent: boolean } {
  if (card.sla_due_at) {
    const minutes = Math.round((new Date(card.sla_due_at).getTime() - Date.now()) / 60_000);
    if (minutes >= 0) return { text: `Call within ${minutes} min`, urgent: true };
  }
  if (card.sla_breached) return { text: 'Nobody called in time', urgent: true };
  if (card.last_inbound_at) return { text: `Replied ${ago(card.last_inbound_at)}`, urgent: false };
  if (!card.stage_changed_at) return { text: 'Nothing recorded yet', urgent: false };

  const verb = VERB[card.stage_key] ?? 'Here since';
  return { text: `${verb} ${when(card.stage_changed_at)}`, urgent: false };
}

const VERB: Record<string, string> = {
  new_lead: 'Arrived',
  attempted_contact: 'Called',
  engaged_qualified: 'Interested since',
  appointment_scheduled: 'Meeting booked',
  deal_sent: 'Offer sent',
  won: 'Booked',
  lost: 'Closed',
};

/** "11:19" today, "4 Nov" before that. Dubai is UTC+4, with no summer time. */
function when(at: string): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return '';
  const day = (ms: number) => new Date(ms + 4 * 3_600_000).toISOString().slice(0, 10);
  return day(then.getTime()) === day(Date.now())
    ? then.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
    : then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function ago(at: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / (60 * 24))} d ago`;
}
