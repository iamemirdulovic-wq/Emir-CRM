import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { formatAedShort, humanize, formatDateTime } from '../lib/format.js';
import { Icon } from '../design/index.js';
import { ago, Avatar, Empty, ErrorNote, Note, Panel, Score, Spinner, useToast } from '../design/ui.js';

/**
 * Incoming: the leads nobody is working.
 *
 * Not where every lead starts. A new lead is still assigned the instant it
 * arrives and the client still gets a reply inside thirty seconds — routing
 * every lead through a person first would mean one arriving at 2am waits
 * until morning. This is the exception queue: nobody was on shift, nobody
 * speaks the language, an agent let their clock run out, or a batch was
 * imported for someone to place by hand.
 *
 * Ordered oldest first, because the one at the top is the one going coldest.
 */

interface IncomingLead {
  id: string;
  contactId: string;
  name: string | null;
  phone: string | null;
  language: string | null;
  project: string | null;
  budgetMaxAed: number | null;
  source: string | null;
  score: number | null;
  bounceCount: number;
  /** Set when this one came back to you after an agent ran out of time. */
  returnedAt: string | null;
  reason: string | null;
  arrivedAt: string;
}

interface Agent {
  userId: string;
  name: string;
  openLeads: number;
}

export function Incoming() {
  const toast = useToast();
  const leads = useAsync<{ items: IncomingLead[] }>(() => api.get('/api/incoming'), []);
  /*
   * Everybody who can take a lead, not just the people on a desk.
   *
   * This list used to be built from the desks in Settings, so a brokerage
   * with nine agents and no desk saw "Add agents to a desk in Settings before
   * you can assign leads" and could not hand out a single lead -- which is
   * where Emir ended up with 56 of them selected and nowhere to send them.
   * Desks group agents for round-robin rules; they were never meant to decide
   * who exists.
   */
  const team = useAsync<{ items: { id: string; name: string; open_leads: number }[] }>(
    () => api.get('/api/leads/agents'),
    [],
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  /*
   * The five-minute clock, off unless asked for.
   *
   * It used to start on everything handed out from here, which is the loop
   * Emir got caught in: give Tej a lead, Tej does not tap accept within five
   * minutes, it is taken off him mid-conversation and comes back, and handing
   * it out again starts the same clock.
   */
  const [urgent, setUrgent] = useState(false);

  /* Least loaded first, so the obvious press is also the fair one. */
  const agents = useMemo<Agent[]>(
    () => (team.data?.items ?? [])
      .map((row) => ({ userId: row.id, name: row.name, openLeads: Number(row.open_leads) }))
      .sort((a, b) => a.openLeads - b.openLeads || a.name.localeCompare(b.name)),
    [team.data],
  );

  const items = leads.data?.items ?? [];
  const allPicked = items.length > 0 && picked.size === items.length;

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function assign(agentUserId: string, name: string) {
    const opportunityIds = [...picked];
    if (opportunityIds.length === 0) return;
    setBusy(true);
    try {
      const result = await api.post<{ assigned: number; skipped: number }>('/api/incoming/assign', {
        opportunityIds,
        agentUserId,
        ...(urgent ? { urgent: true } : {}),
      });
      const what = result.assigned === 1 ? 'Lead' : `${result.assigned} leads`;
      const clock = urgent ? ' They have 5 minutes.' : ' Theirs to work, no timer.';
      toast(
        result.skipped > 0
          ? `${result.assigned} sent to ${name}. ${result.skipped} had already moved.`
          : `${what} sent to ${name}.${clock}`,
      );
      setPicked(new Set());
      leads.reload();
      team.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not assign those leads');
    } finally {
      setBusy(false);
    }
  }

  if (leads.error) return <ErrorNote>{leads.error}</ErrorNote>;
  if (!leads.data) return <Spinner />;

  return (
    <section id="incoming">
      <Panel
        span={12}
        index={0}
        icon="inbox"
        title={
          items.length === 0
            ? 'Incoming — nothing waiting'
            : `Incoming — ${items.length} waiting for an owner, oldest first`
        }
      >
        {items.length === 0 ? (
          <Empty
            icon="inbox"
            title="Nothing waiting"
            hint="New leads are assigned automatically. One only lands here if nobody was available, or an agent let their five minutes run out and it came back to you."
          />
        ) : (
          <>
            <div className="incoming-bar">
              <label className="pick-all">
                <input
                  type="checkbox"
                  checked={allPicked}
                  onChange={() => setPicked(allPicked ? new Set() : new Set(items.map((lead) => lead.id)))}
                />
                <span>{picked.size > 0 ? `${picked.size} selected` : 'Select all'}</span>
              </label>

              {picked.size > 0 && (
                <div className="assign-to" dir="auto">
                  {/*
                    * The clock, where the decision is made. Off by default:
                    * a lead you place by hand is not a stranger sitting on a
                    * form, and taking it back off the agent five minutes
                    * later undoes the choice you just made.
                    */}
                  <label className="incoming-urgent">
                    <input
                      type="checkbox"
                      checked={urgent}
                      onChange={(event) => setUrgent(event.target.checked)}
                    />
                    <span>
                      <Icon name="flame" />
                      They must call in 5 minutes
                    </span>
                  </label>
                  <span className="assign-label">Send to</span>
                  {agents.length === 0 ? (
                    <Note>
                      Nobody to send these to yet. Add your agents in Settings &rarr; Team.
                    </Note>
                  ) : (
                    agents.map((agent) => (
                      <button
                        key={agent.userId}
                        type="button"
                        className="btn agent-pick"
                        disabled={busy}
                        onClick={() => void assign(agent.userId, agent.name)}
                      >
                        <Avatar name={agent.name} />
                        <span className="agent-name">{agent.name}</span>
                        {/* The number that stops one agent being buried. */}
                        <span className="agent-load">{agent.openLeads} open</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <ul className="incoming-list">
              {items.map((lead) => (
                <li key={lead.id} className={picked.has(lead.id) ? 'incoming-row picked' : 'incoming-row'}>
                  <input
                    type="checkbox"
                    checked={picked.has(lead.id)}
                    onChange={() => toggle(lead.id)}
                    aria-label={`Select ${lead.name ?? 'this lead'}`}
                  />
                  <Link to={`/contacts/${lead.contactId}`} className="incoming-main">
                    <span className="incoming-name" dir="auto">{lead.name ?? 'Unnamed lead'}</span>
                    <span className="incoming-meta" dir="auto">
                      {[
                        lead.project,
                        // Budget, because it is the first thing an owner weighs
                        // when deciding which agent should get this one.
                        formatAedShort(lead.budgetMaxAed),
                        lead.source && humanize(lead.source),
                        lead.language?.toUpperCase(),
                      ].filter((part) => part && part !== '—').join(' · ')}
                    </span>
                  </Link>

                  <div className="incoming-tags">
                    {/* Which of the two kinds of waiting lead this is. */}
                    {lead.returnedAt !== null && (
                      <span className="tag bounced" title={lead.reason ?? undefined}>
                        <Icon name="undo-2" />
                        Came back to you
                      </span>
                    )}
                    {lead.returnedAt === null && lead.bounceCount > 0 && (
                      <span className="tag bounced" title={lead.reason ?? undefined}>
                        <Icon name="undo-2" />
                        {lead.bounceCount > 1 ? `Bounced ${lead.bounceCount}×` : 'Bounced'}
                      </span>
                    )}
                    {lead.score !== null && <Score value={lead.score} />}
                    <span className="incoming-age" title={formatDateTime(lead.arrivedAt)}>
                      {ago(lead.arrivedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </section>
  );
}


