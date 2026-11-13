import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';
import { spacedE164 } from '../design/phone.js';
import { usePhoneHead } from './phone.js';

/**
 * Incoming: the leads nobody is working on.
 *
 * Built from `design/web/incoming.html`, which draws two screens behind one
 * address. An agent sees free leads as a column of wide rows and may take
 * one; an owner sees the same leads with "Give to an agent" on each, the
 * "Share equally" card down the right, and the rules that put a lead here.
 *
 * Every row says how long it has been waiting and why it is free, because
 * "came back from Shan after 24 hours" and "nobody has ever had this one"
 * are different problems and an owner decides differently on each.
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

/** The design's rules card, a different set for each role. */
const OWNER_RULES: Array<{ icon: IconName; text: ReactNode }> = [
  { icon: 'clock', text: <>An imported lead not called in <b>24 hours</b> comes back.</> },
  { icon: 'crown', text: <>A VIP lead not called in time comes back, and you are told.</> },
  { icon: 'plus', text: <>Anyone can add a lead and leave it in Incoming.</> },
  { icon: 'user', text: <>Leads of a deactivated agent come here.</> },
];

const AGENT_RULES: Array<{ icon: IconName; text: ReactNode }> = [
  { icon: 'check', text: <>“Take this lead” moves it to <b>My leads</b>. It is yours at once.</> },
  { icon: 'phone', text: <>Call it <b>today</b>. A lead nobody calls comes back here.</> },
  { icon: 'crown', text: <>A VIP lead cannot be taken. An owner gives it.</> },
];

export function V2Incoming() {
  const data = useAsync<Incoming>(() => api.get('/api/v2/incoming'), []);

  if (data.error) return <ErrorNote>{data.error}</ErrorNote>;
  if (!data.data) return <Spinner />;

  return data.data.role === 'agent'
    ? <AgentView free={data.data.free} reload={data.reload} />
    : <OwnerView data={data.data} reload={data.reload} />;
}

/* ── the agent's screen ────────────────────────────────────────────────── */

function AgentView({ free, reload }: { free: FreeLead[]; reload: () => void }) {
  const [taking, setTaking] = useState<string | null>(null);
  /* `to` is set when the message is about a lead that is now yours, so the
     confirmation has a way through to it — `Incoming.dc.html` replaces the
     card with "{name} is now your lead. It is in My Leads." and an **Open
     the lead and call** link, and the build's banner was a dead end. */
  const [said, setSaid] = useState<{ text: string; to: string | null } | null>(null);

  const normal = free.filter((lead) => !lead.isVip).length;
  const vip = free.length - normal;
  usePhoneHead({ sub: 'Free leads · first agent to take it gets it' });

  async function take(lead: FreeLead) {
    setTaking(lead.id);
    setSaid(null);
    try {
      await api.post(`/api/v2/incoming/${lead.id}/take`, {});
      setSaid({
        text: `${lead.name ?? 'The lead'} is now your lead. It is in My leads.`,
        to: `/v2/leads/${lead.id}`,
      });
      reload();
    } catch (err) {
      /* "Somebody was quicker" is the usual one, and it is not an error the
         agent did anything about — it is said plainly and the list refreshes. */
      setSaid({ text: err instanceof Error ? err.message : 'That did not work.', to: null });
      reload();
    } finally {
      setTaking(null);
    }
  }

  return (
    <div className="p-incoming v2-incoming">
      {said && (
        <p className="v2-said">
          {said.text}
          {said.to && <> <Link className="d-card-link" to={said.to}>Open the lead and call</Link></>}
        </p>
      )}

      <div className="d-inc-grid">
        <div>
          <div className="d-sumline">
            <b className="d-num">{normal}</b>
            <span className="d-label">
              {normal === 1 ? 'free lead to take' : 'free leads to take'}
              {normal > 0 ? ' · the first agent who takes a lead gets it' : ' · you took them all'}
              {vip > 0 && ` · ${vip} VIP ${vip === 1 ? 'lead waits' : 'leads wait'} for an owner`}
            </span>
          </div>

          {free.length === 0 ? (
            <div className="d-card">
              <div className="d-empty">
                <span className="d-ic"><Icon name="inbox" size={26} /></span>
                <b>Incoming is empty</b>
                <p>Every lead has an agent. New free leads show up here.</p>
                <Link className="d-btn d-sm" to="/v2/leads">Open My leads</Link>
              </div>
            </div>
          ) : free.map((lead) => (
            <Row key={lead.id} lead={lead} showPhone={false}>
              {lead.isVip ? (
                <span className="d-chip d-line">
                  <Icon name="lock" size={13} />Only an owner gives it
                </span>
              ) : (
                <button
                  type="button"
                  className="d-btn d-dark"
                  disabled={taking === lead.id}
                  onClick={() => void take(lead)}
                >
                  {taking === lead.id ? 'Taking…' : 'Take this lead'}
                </button>
              )}
            </Row>
          ))}
        </div>

        <aside className="d-col d-gap-16 v2-inc-side">
          <section className="d-card v2-inc-rules">
            <h3>The rules</h3>
            {AGENT_RULES.map((rule) => (
              <div className="d-rule" key={rule.icon}>
                <Icon name={rule.icon} size={16} /><span>{rule.text}</span>
              </div>
            ))}
          </section>
          <Link className="d-shortcut v2-inc-shortcut" to="/v2/leads">
            <Icon name="users" />
            <span className="d-grow">My leads</span>
            <Icon name="arrow-right" size={15} />
          </Link>
        </aside>
      </div>
    </div>
  );
}

/* ── the owner's screen ────────────────────────────────────────────────── */

function OwnerView({ data, reload }: {
  data: { free: FreeLead[]; agents: Agent[]; cameBack: FreeLead[] };
  reload: () => void;
}) {
  const [tab, setTab] = useState<'waiting' | 'back'>('waiting');
  const [confirming, setConfirming] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [giving, setGiving] = useState<FreeLead | null>(null);
  const { user } = useAuth();
  const me = user?.name ?? 'You';
  usePhoneHead({ sub: 'Owner view · give each lead a home' });

  const normal = useMemo(() => data.free.filter((lead) => !lead.isVip), [data.free]);
  /* The people a lead can actually go to: everyone not marked unavailable,
     fewest open leads first — which is the order the endpoint already sends. */
  const working = useMemo(
    () => data.agents.filter((agent) => agent.availability !== 'off'),
    [data.agents],
  );
  const oldest = data.free.reduce((most, lead) => Math.max(most, lead.waitingMinutes), 0);

  async function share() {
    if (!confirming) {
      /* Two taps, as every risky action in this product has. */
      setConfirming(true);
      return;
    }
    setBusy(true);
    setSaid(null);
    try {
      const result = await api.post<{ given: number; vipSkipped: number }>(
        '/api/v2/incoming/share',
        {
          opportunityIds: normal.map((lead) => lead.id),
          agentUserIds: working.map((agent) => agent.id),
        },
      );
      setSaid(
        `${result.given} ${result.given === 1 ? 'lead' : 'leads'} shared · everyone is told now`
        + (result.vipSkipped > 0
          ? ` · ${result.vipSkipped} VIP ${result.vipSkipped === 1 ? 'lead' : 'leads'} left for you to give by hand`
          : ''),
      );
      setConfirming(false);
      reload();
    } catch (err) {
      setSaid(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-incoming v2-incoming">
      <div className="v2-page-head">
        <div className="d-tabs d-pills v2-inc-tabs">
          <button
            type="button"
            className={tab === 'waiting' ? 'd-tab d-on' : 'd-tab'}
            onClick={() => setTab('waiting')}
          >
            Waiting
            {data.free.length > 0 && <span className="d-count d-red">{data.free.length}</span>}
          </button>
          <button
            type="button"
            className={tab === 'back' ? 'd-tab d-on' : 'd-tab'}
            onClick={() => setTab('back')}
          >
            Came back to you
            {data.cameBack.length > 0 && <span className="d-count">{data.cameBack.length}</span>}
          </button>
        </div>
        <span className="d-grow" />
        <Link className="d-btn" to="/v2/leads/new">
          <Icon name="crown" size={15} />Add a lead and give it as VIP
        </Link>
      </div>

      {said && <p className="v2-said">{said}</p>}

      {tab === 'waiting' ? (
        <div className="d-inc-grid">
          <div>
            <div className="d-sumline">
              <b className="d-num">{data.free.length}</b>
              <span className="d-label">
                {data.free.length === 1 ? 'lead waits' : 'leads wait'} for an agent
                {data.free.length > 0 && ` · the oldest waits ${waited(oldest)}`}
              </span>
            </div>

            {data.free.length === 0 ? (
              <div className="d-card">
                <div className="d-empty">
                  <span className="d-ic v2-inc-ic-ok"><Icon name="check" size={26} /></span>
                  <b>Incoming is empty</b>
                  <p>Every lead has an agent. New free leads show up here first.</p>
                  <Link className="d-btn d-sm" to="/v2/leads/new">Add a lead</Link>
                </div>
              </div>
            ) : data.free.map((lead) => (
              <Row key={lead.id} lead={lead} showPhone>
                <button
                  type="button"
                  className={lead.isVip ? 'd-btn d-primary' : 'd-btn d-dark'}
                  onClick={() => setGiving(lead)}
                >
                  {lead.isVip ? 'Give again' : 'Give to an agent'}
                </button>
              </Row>
            ))}
          </div>

          <aside className="d-col d-gap-16 v2-inc-side">
            <section className="d-card">
              <div className="d-card-head">
                <h3>Share equally</h3>
                <span className="d-card-icon"><Icon name="users" /></span>
              </div>
              <p className="d-small d-muted">
                Gives the <b className="d-ink-2">{normal.length} normal {normal.length === 1 ? 'lead' : 'leads'}</b> to
                the working agents with the fewest open leads.
                {' '}<b className="d-ink-2">A VIP lead is never shared</b>: you choose the agent.
              </p>
              <button
                type="button"
                className={normal.length === 0 || working.length === 0 ? 'd-btn d-block d-mt-16 d-disabled' : 'd-btn d-block d-mt-16'}
                disabled={normal.length === 0 || working.length === 0 || busy}
                onClick={share}
              >
                {busy ? 'Sharing…'
                  : confirming
                    ? `Tap again to share ${normal.length} ${normal.length === 1 ? 'lead' : 'leads'}`
                    : 'Share the normal leads equally'}
              </button>
              {confirming && (
                <button type="button" className="d-btn d-ghost d-block d-mt-8" onClick={() => setConfirming(false)}>
                  Not now
                </button>
              )}
            </section>

            <section className="d-card v2-inc-rules">
              <h3>How a lead gets here</h3>
              {OWNER_RULES.map((rule) => (
                <div className="d-rule" key={rule.icon}>
                  <Icon name={rule.icon} size={16} /><span>{rule.text}</span>
                </div>
              ))}
              <Link className="d-card-link" to="/v2/settings/automations">
                Change the take-back times <Icon name="arrow-right" size={13} />
              </Link>
            </section>
          </aside>
        </div>
      ) : (
        <CameBack rows={data.cameBack} me={me} onGive={setGiving} />
      )}

      {giving && (
        <Give
          lead={giving}
          agents={data.agents}
          onClose={() => setGiving(null)}
          onGiven={(told) => { setGiving(null); setSaid(told); reload(); }}
        />
      )}
    </div>
  );
}

/**
 * The leads that bounced back to the owner.
 *
 * The design's second tab is "VIP leads I gave", a table of every handover
 * with its clock running. Nothing sends that list — `vip_handoffs` has no
 * endpoint behind it — so what is drawn is the half of it this screen can
 * honestly fill: the ones that came back, which are the rows that needed the
 * owner in the first place.
 */
function CameBack({ rows, me, onGive }: {
  rows: FreeLead[]; me: string; onGive: (lead: FreeLead) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="d-card">
        <div className="d-empty">
          <span className="d-ic v2-inc-ic-ok"><Icon name="check" size={26} /></span>
          <b>Nothing came back</b>
          <p>A lead you gave out that nobody called in time would be here.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="d-filters">
        <span className="d-grow" />
        <span className="d-result-count">{rows.length} {rows.length === 1 ? 'lead' : 'leads'}</span>
      </div>
      <div className="d-table-wrap">
        <table className="d-table d-id-vip-t">
          <thead>
            <tr><th>Lead</th><th>With</th><th>Back</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((lead) => (
              <tr key={lead.id}>
                <td>
                  <span className="d-t-main">{lead.name ?? 'Unnamed lead'}</span>
                  {lead.isVip && <span className="d-vip-tag">VIP</span>}
                  <div className="d-t-sub">{lead.project ?? 'No project yet'}</div>
                </td>
                <td>
                  <span className="d-person">
                    <Avatar name={me} size={26} />
                    You
                  </span>
                </td>
                <td className="d-t-sub">{waited(lead.waitingMinutes)} ago</td>
                <td>
                  <span className="d-chip d-red d-pip">Came back</span>
                  <div className="d-t-sub v2-inc-why">{why(lead)}</div>
                </td>
                <td>
                  <div className="d-row-actions">
                    <button type="button" className="d-btn d-xs d-dark" onClick={() => onGive(lead)}>
                      Give to another agent
                    </button>
                    <Link className="d-btn d-xs d-ghost" to={`/v2/leads/${lead.id}`}>Open the lead</Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="d-small d-muted d-mt-12">
        <Icon name="info" size={13} /> Giving a lead to another agent tells them at once. With a
        clock on it, it comes back to you if they do not call in five minutes.
      </p>
    </>
  );
}

/**
 * "Give to an agent."
 *
 * The design's dialog offers a clock of 15, 30 or 60 minutes. The only clock
 * the server has for a lead that already exists is the five-minute one
 * (`urgent` on `/api/incoming/assign`), so the choice is drawn as the two it
 * can really keep rather than four it cannot.
 */
function Give({ lead, agents, onClose, onGiven }: {
  lead: FreeLead;
  agents: Agent[];
  onClose: () => void;
  onGiven: (told: string) => void;
}) {
  const choosable = agents.filter((agent) => agent.availability !== 'off');
  const [to, setTo] = useState<string | null>(choosable[0]?.id ?? null);
  const [clock, setClock] = useState(lead.isVip);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const chosen = agents.find((agent) => agent.id === to) ?? null;

  async function give() {
    if (!to || !chosen) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/api/incoming/assign', {
        opportunityIds: [lead.id],
        agentUserId: to,
        ...(clock ? { urgent: true } : {}),
      });
      onGiven(
        `${lead.name ?? 'The lead'} given to ${chosen.name} · ${chosen.name} is told now`
        + (clock ? ' · five minutes to accept it' : ''),
      );
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="d-scrim d-show" onClick={onClose} aria-hidden />
      <div className="d-dialog d-open" role="dialog" aria-label="Give to an agent">
        <div className="d-dialog-head">
          <div className="d-grow">
            <h3>Give {lead.name ?? 'this lead'} to…</h3>
            <p>
              {[lead.isVip ? 'VIP' : null, lead.project, why(lead)].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-dialog-body">
          <div className="d-opt-list v2-inc-agents">
            {agents.map((agent, index) => {
              const off = agent.availability === 'off';
              const best = !off && index === agents.findIndex((one) => one.availability !== 'off');
              return (
                <button
                  key={agent.id}
                  type="button"
                  disabled={off}
                  className={to === agent.id ? 'd-opt d-on' : 'd-opt'}
                  onClick={() => setTo(agent.id)}
                >
                  <Avatar name={agent.name} src={agent.photoUrl ?? undefined} size={32} />
                  <span className="d-grow">
                    <b className="d-bold">{agent.name}</b>
                    {best && <span className="d-chip d-green v2-inc-best">Best match</span>}
                    <div className="d-small d-muted">{whereIs(agent)}</div>
                  </span>
                  <span className="d-small d-muted">{agent.openLeads} open</span>
                </button>
              );
            })}
          </div>

          <div className="d-field d-mt-12">
            <span className="d-field-label">Put a clock on it</span>
            <div className="d-seg d-block">
              <button type="button" className={clock ? '' : 'd-on'} onClick={() => setClock(false)}>
                No clock
              </button>
              <button type="button" className={clock ? 'd-on' : ''} onClick={() => setClock(true)}>
                5 minutes to accept
              </button>
            </div>
          </div>

          <p className="d-small d-muted">
            Fewest open leads first. People marked unavailable cannot be chosen.
          </p>

          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>

        <div className="d-dialog-foot">
          <button type="button" className="d-btn d-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="d-btn d-primary" disabled={!to || busy} onClick={give}>
            {busy ? 'Giving…' : chosen ? `Give to ${chosen.name}` : 'Give'}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── one row ───────────────────────────────────────────────────────────── */

function Row({ lead, showPhone, children }: {
  lead: FreeLead; showPhone: boolean; children: ReactNode;
}) {
  return (
    <div className={lead.isVip ? 'd-wrow d-vip' : 'd-wrow'}>
      <Avatar name={lead.name ?? '?'} size={44} />
      <div className="d-who">
        <div className="d-nm">
          {lead.name ?? 'Unnamed lead'}
          {lead.isVip && <span className="d-vip-tag">VIP</span>}
        </div>
        <div className="d-sub">
          {[
            lead.project,
            lead.source?.replace(/_/g, ' '),
            showPhone ? spacedE164(lead.phone) : null,
          ].filter(Boolean).join(' · ') || 'Nothing known yet'}
        </div>
        <div className="d-why"><Icon name="info" size={13} />{why(lead)}</div>
      </div>
      <div className={lead.waitingMinutes > 30 ? 'd-wait d-old' : 'd-wait'}>
        <b>{waited(lead.waitingMinutes)}</b>
        <span>waiting</span>
      </div>
      {children}
    </div>
  );
}

/** "42 min", "3 hours", "2 days" — never "4320 minutes". */
function waited(mins: number): string {
  if (mins < 60) return `${Math.max(0, mins)} min`;
  if (mins < 60 * 24) {
    const hours = Math.round(mins / 60);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(mins / (60 * 24));
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function why(lead: FreeLead): string {
  if (lead.returnedAt) {
    return lead.bounceCount > 1
      ? `Came back ${lead.bounceCount} times`
      : 'Came back — nobody called in time';
  }
  if (lead.reason) return lead.reason.replace(/_/g, ' ');
  return 'Nobody has had this one yet';
}

/** Where an agent is today, in the words the attendance screen uses. */
function whereIs(agent: Agent): string {
  if (agent.availability === 'off') return 'Not available · cannot be chosen';
  if (agent.markedToday === 'office') return 'In the office';
  if (agent.markedToday === 'outside') return 'Working outside';
  return 'Not marked in today';
}
