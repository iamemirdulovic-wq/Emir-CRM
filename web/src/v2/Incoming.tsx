import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';
import { clockIn, flagOf, originOf } from '../lib/dialling.js';

/**
 * Incoming: the leads nobody is working on.
 *
 * `docs/v2/pages.md` §11. An agent sees free leads and may take one; an owner
 * sees the same leads plus the people to hand them to. The row says how long
 * it has been waiting and why it is free, because "came back from Shan after
 * 24 hours" and "nobody has ever had this one" are different problems and an
 * owner decides differently on each.
 */

interface FreeLead {
  id: string;
  contactId: string;
  name: string | null;
  phone: string | null;
  language: string | null;
  project: string | null;
  budgetMaxAed: number | null;
  source: string | null;
  score: number | null;
  isVip: boolean;
  waitingMinutes: number;
  returnedAt: string | null;
  bounceCount: number;
  reason: string | null;
}

interface Agent {
  id: string; name: string; photoUrl: string | null; openLeads: number;
  availability: string; markedToday: string | null;
}

type Incoming =
  | { role: 'agent'; free: FreeLead[] }
  | { role: 'owner'; free: FreeLead[]; agents: Agent[]; cameBack: FreeLead[] };

export function V2Incoming() {
  const data = useAsync<Incoming>(() => api.get('/api/v2/incoming'), []);

  if (data.error) return <ErrorNote>{data.error}</ErrorNote>;
  if (!data.data) return <Spinner />;

  return data.data.role === 'agent'
    ? <AgentView free={data.data.free} reload={data.reload} />
    : <OwnerView data={data.data} reload={data.reload} />;
}

function AgentView({ free, reload }: { free: FreeLead[]; reload: () => void }) {
  const [taking, setTaking] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  async function take(lead: FreeLead) {
    setTaking(lead.id);
    setSaid(null);
    try {
      await api.post(`/api/v2/incoming/${lead.id}/take`, {});
      setSaid(`${lead.name ?? 'The lead'} is yours. It is in your leads now.`);
      reload();
    } catch (err) {
      /* "Somebody was quicker" is the usual one, and it is not an error the
         agent did anything about — it is said plainly and the list refreshes. */
      setSaid(err instanceof Error ? err.message : 'That did not work.');
      reload();
    } finally {
      setTaking(null);
    }
  }

  return (
    <div className="p-incoming v2-incoming">
      <header className="v2-inc-head">
        <h1 className="v2-hi">Free leads</h1>
        <p className="d-muted">
          Nobody is working on these. Take one and it is yours.
        </p>
      </header>

      {said && <p className="v2-said">{said}</p>}

      {free.length === 0 ? (
        <div className="v2-empty">
          <span className="v2-empty-mark"><Icon name="inbox" /></span>
          <h2>Nothing waiting</h2>
          <p>Every lead has somebody on it. That is the way it should look.</p>
          <Link className="d-btn d-primary" to="/v2/leads">My leads</Link>
        </div>
      ) : (
        <ul className="v2-inc-list">
          {free.map((lead) => (
            <li key={lead.id} className="d-card v2-inc-card">
              <Row lead={lead} />
              <button
                type="button"
                className="d-btn d-primary"
                disabled={taking === lead.id}
                onClick={() => take(lead)}
              >
                {taking === lead.id ? 'Taking…' : 'Take this lead'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OwnerView({ data, reload }: {
  data: { free: FreeLead[]; agents: Agent[]; cameBack: FreeLead[] };
  reload: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [chosenAgents, setChosenAgents] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const vipPicked = useMemo(
    () => data.free.filter((l) => picked.has(l.id) && l.isVip).length,
    [data.free, picked],
  );

  function toggle(set: Set<string>, id: string, put: (next: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    put(next);
  }

  async function share() {
    if (!confirming) {
      /* Two clicks, as every risky action in this product has. */
      setConfirming(true);
      return;
    }
    setBusy(true);
    setSaid(null);
    try {
      const result = await api.post<{ given: number; vipSkipped: number }>(
        '/api/v2/incoming/share',
        { opportunityIds: [...picked], agentUserIds: [...chosenAgents] },
      );
      setSaid(
        `${result.given} given out`
        + (result.vipSkipped > 0
          ? ` · ${result.vipSkipped} VIP ${result.vipSkipped === 1 ? 'lead' : 'leads'} left for you to give by hand`
          : ''),
      );
      setPicked(new Set());
      setConfirming(false);
      reload();
    } catch (err) {
      setSaid(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const ready = picked.size > 0 && chosenAgents.size > 0;

  return (
    <div className="p-incoming v2-incoming">
      <header className="v2-inc-head">
        <h1 className="v2-hi">Incoming</h1>
        <p className="d-muted">
          {data.free.length} waiting for somebody
          {data.cameBack.length > 0 && ` · ${data.cameBack.length} came back to you`}
        </p>
      </header>

      {said && <p className="v2-said">{said}</p>}

      <div className="v2-inc-grid">
        <div className="v2-inc-main">
          {data.free.length === 0 ? (
            <div className="v2-empty">
              <span className="v2-empty-mark"><Icon name="inbox" /></span>
              <h2>Nothing waiting</h2>
              <p>Every lead has an agent on it.</p>
            </div>
          ) : (
            <ul className="v2-inc-list">
              {data.free.map((lead) => (
                <li
                  key={lead.id}
                  className={picked.has(lead.id) ? 'd-card v2-inc-card v2-inc-on' : 'd-card v2-inc-card'}
                >
                  <label className="v2-pick">
                    <input
                      type="checkbox"
                      checked={picked.has(lead.id)}
                      onChange={() => toggle(picked, lead.id, setPicked)}
                    />
                  </label>
                  <Row lead={lead} />
                </li>
              ))}
            </ul>
          )}

          {data.cameBack.length > 0 && (
            <>
              <h2 className="v2-inc-sub">Came back to you</h2>
              <ul className="v2-inc-list">
                {data.cameBack.map((lead) => (
                  <li key={lead.id} className="d-card v2-inc-card">
                    <Row lead={lead} />
                    <Link className="d-btn" to={`/v2/leads/${lead.id}`}>Open</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <aside className="d-card v2-give">
          <div className="d-card-head"><h3>Give them out</h3></div>
          <p className="d-small d-muted">
            {picked.size === 0
              ? 'Tick the leads to give, then the agents to give them to.'
              : `${picked.size} picked${vipPicked > 0 ? ` · ${vipPicked} VIP` : ''}`}
          </p>

          <ul className="v2-agent-list">
            {data.agents.map((agent) => (
              <li key={agent.id}>
                <label className={chosenAgents.has(agent.id) ? 'v2-agent v2-agent-on' : 'v2-agent'}>
                  <input
                    type="checkbox"
                    checked={chosenAgents.has(agent.id)}
                    onChange={() => toggle(chosenAgents, agent.id, setChosenAgents)}
                  />
                  <Avatar name={agent.name} src={agent.photoUrl ?? undefined} />
                  <span className="v2-agent-who">
                    <b>{agent.name}</b>
                    <span>
                      {agent.openLeads} open
                      {agent.markedToday === 'office' ? ' · in office'
                        : agent.markedToday === 'outside' ? ' · outside'
                          : ' · not marked today'}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {vipPicked > 0 && (
            <p className="v2-warn">
              <Icon name="alert-triangle" />
              {vipPicked} VIP {vipPicked === 1 ? 'lead is' : 'leads are'} ticked. VIP leads are
              never shared out — give those by hand from the lead itself.
            </p>
          )}

          <button
            type="button"
            className={confirming ? 'd-btn d-danger d-solid' : 'd-btn d-primary'}
            disabled={!ready || busy}
            onClick={share}
          >
            {busy ? 'Giving…'
              : confirming ? 'Tap again to share them'
                : `Share ${picked.size - vipPicked} equally`}
          </button>
          {confirming && (
            <button type="button" className="d-btn d-ghost" onClick={() => setConfirming(false)}>
              Not now
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ lead }: { lead: FreeLead }) {
  const origin = originOf(lead.phone);
  const local = origin ? clockIn(origin.timeZone) : null;

  return (
    <div className="v2-inc-row">
      <Avatar name={lead.name ?? '?'} />
      <span className="v2-inc-who">
        <b>
          {lead.name ?? 'Unnamed lead'}
          {lead.isVip && <span className="v2-vip">VIP</span>}
        </b>
        <span>
          {[lead.project, lead.language, lead.source?.replace(/_/g, ' ')]
            .filter(Boolean).join(' · ') || 'Nothing known yet'}
        </span>
      </span>

      {origin && local && (
        <span className="v2-inc-where">
          <span className="d-flag">{flagOf(origin.iso2)}</span>{local.time}
        </span>
      )}

      <span className="v2-inc-wait">
        <b>{waited(lead.waitingMinutes)}</b>
        <span>{why(lead)}</span>
      </span>
    </div>
  );
}

/** "42 min", "3 hours", "2 days" — never "4320 minutes". */
function waited(mins: number): string {
  if (mins < 60) return `waiting ${Math.max(0, mins)} min`;
  if (mins < 60 * 24) {
    const hours = Math.round(mins / 60);
    return `waiting ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(mins / (60 * 24));
  return `waiting ${days} ${days === 1 ? 'day' : 'days'}`;
}

function why(lead: FreeLead): string {
  if (lead.returnedAt) {
    return lead.bounceCount > 1
      ? `came back ${lead.bounceCount} times`
      : 'came back — nobody called in time';
  }
  if (lead.reason) return lead.reason.replace(/_/g, ' ');
  return 'nobody has had this one yet';
}
