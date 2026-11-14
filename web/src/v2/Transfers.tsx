import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';
import { usePhoneHead } from './phone.js';

/**
 * Transfers: handing a lead to a colleague.
 *
 * Built from `design/web/transfers.html`, which draws two different screens
 * behind one address. An agent sees what is waiting on them, what they sent,
 * and the rules down the right-hand side. An owner sees what needs approving,
 * every transfer of the last week, and who in the office gives leads away and
 * who collects them.
 *
 * The screen says plainly whose turn it is, because the one way a transfer
 * goes wrong is quietly: the sender thinks it is gone, the receiver has not
 * seen it, and nobody rings the client.
 *
 * A transfer is *started* on the lead itself, not here — `TransferLead` is
 * the form, and it needs the lead. So the design's "Transfer a lead" button
 * opens the leads list rather than a panel this screen cannot fill.
 */

export interface Transfer {
  id: string;
  opportunityId: string;
  leadName: string | null;
  project: string | null;
  stage: string;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  reason: string;
  note: string | null;
  status: string;
  requestedAt: string;
  expiresAt: string | null;
}

interface Lists {
  forMe: Transfer[];
  iSent: Transfer[];
  toApprove: Transfer[];
  recent: Transfer[];
}

export const REASONS: Record<string, string> = {
  language: 'Speaks the client’s language',
  leave: 'Going on leave',
  client_asked: 'The client asked',
  knows_project: 'Knows the project better',
  too_many: 'Too many leads',
  other: 'Something else',
};

const STAGE: Record<string, { word: string; chip: string }> = {
  new_lead: { word: 'New', chip: 'd-stage-new' },
  attempted_contact: { word: 'Called', chip: 'd-stage-called' },
  engaged_qualified: { word: 'Interested', chip: 'd-stage-interested' },
  appointment_scheduled: { word: 'Meeting', chip: 'd-stage-meeting' },
  deal_sent: { word: 'Offer', chip: 'd-stage-offer' },
  won: { word: 'Won', chip: 'd-stage-won' },
  lost: { word: 'Lost', chip: 'd-stage-lost' },
};

/** The rules, in the design's own words — a different set for each role. */
const AGENT_RULES: Array<{ icon: IconName; text: ReactNode }> = [
  { icon: 'user', text: <>Only <b>your own</b> leads. One open request per lead.</> },
  { icon: 'clock', text: <>No answer by <b>18:00</b> ends the request. The lead stays with you.</> },
  { icon: 'shield', text: <>Stage <b>Meeting</b> or <b>Offer</b>: the owner approves first, then the agent accepts.</> },
  { icon: 'crown', text: <>A <b>VIP lead</b> cannot be transferred. Send it back to the owner.</> },
  { icon: 'pin', text: <>Agents on leave cannot be chosen.</> },
];

const OWNER_RULES: Array<{ icon: IconName; text: ReactNode }> = [
  { icon: 'shield', text: <>You approve only stage <b>Meeting</b> and <b>Offer</b>. Other stages go straight to the agent.</> },
  { icon: 'clock', text: <>A request with no answer ends at <b>18:00</b>.</> },
  { icon: 'crown', text: <>VIP leads are never transferred. They come back to you.</> },
];

export function V2Transfers() {
  const { user } = useAuth();
  const owner = user?.role === 'owner' || user?.role === 'admin';
  const lists = useAsync<Lists>(() => api.get('/api/v2/transfers'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  /* §1.4, and `Transfers.dc.html`'s own title and two sub-lines — one per
     role. The design centres a 17px "Lead transfers" between the back
     button and nothing, because the list below wants the height. */
  usePhoneHead({
    compact: true,
    title: 'Lead transfers',
    sub: owner ? 'Owner · approve and see every transfer' : 'Leads you give and leads you get',
  });

  async function act(id: string, path: string, body: unknown, told: string) {
    setBusy(id);
    setSaid(null);
    try {
      await api.post(`/api/v2/transfers/${id}/${path}`, body);
      setSaid(told);
      lists.reload();
    } catch (err) {
      setSaid(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  if (lists.error) return <ErrorNote>{lists.error}</ErrorNote>;
  if (!lists.data) return <Spinner />;

  return (
    <div className="v2-tr p-transfers">
      {said && <p className="v2-said">{said}</p>}
      {owner
        ? <OwnerView lists={lists.data} busy={busy} act={act} />
        : <AgentView lists={lists.data} busy={busy} act={act} />}
    </div>
  );
}

type Act = (id: string, path: string, body: unknown, told: string) => void;

/* ── the agent's screen ────────────────────────────────────────────────── */

function AgentView({ lists, busy, act }: { lists: Lists; busy: string | null; act: Act }) {
  const { forMe, iSent } = lists;

  return (
    <>
      <div className="v2-page-head">
        <span className="v2-page-sub">
          Give a lead to a colleague who fits better. It stays with you until they accept.
        </span>
        <span className="d-grow" />
        <Link className="d-btn d-primary" to="/v2/leads">
          <Icon name="repeat" />Pick a lead to transfer
        </Link>
      </div>

      <div className="d-tgrid">
        <div>
          <div className="d-sec">
            <span className="d-sec-label">
              For you {forMe.length > 0 && <span className="d-badge d-accent">{forMe.length}</span>}
            </span>
          </div>

          {forMe.length === 0 ? (
            <div className="d-card">
              <div className="d-empty v2-empty-tight">
                <b>Nothing to answer</b>
                <p>When a colleague wants to give you a lead, it shows here.</p>
              </div>
            </div>
          ) : forMe.map((one) => (
            <div className="d-treq v2-treq-row" key={one.id}>
              <Who one={one} who="from" />
              <Deadline one={one} />
              <div className="d-col d-gap-8 v2-treq-acts">
                <button
                  type="button"
                  className="d-btn d-dark"
                  disabled={busy === one.id}
                  onClick={() => act(one.id, 'answer', { accept: true },
                    `${one.leadName ?? 'The lead'} is yours now. ${one.fromName} has been told.`)}
                >
                  <Icon name="check" />Accept
                </button>
                <button
                  type="button"
                  className="d-btn"
                  disabled={busy === one.id}
                  onClick={() => act(one.id, 'answer', { accept: false },
                    `You said no. The lead stays with ${one.fromName}.`)}
                >
                  No, thanks
                </button>
              </div>
            </div>
          ))}

          <div className="d-sec d-mt-24">
            <span className="d-sec-label">
              You sent {iSent.length > 0 && <span className="d-badge">{iSent.length}</span>}
            </span>
          </div>

          {iSent.length === 0 ? (
            <div className="d-card">
              <div className="d-empty v2-empty-tight">
                <b>You have not sent any</b>
                <p>Open one of your leads and choose “Give this lead to somebody else”.</p>
              </div>
            </div>
          ) : (
            <div className="d-table-wrap">
              <table className="d-table d-id-sent">
                <thead>
                  <tr><th>Lead</th><th>To · reason</th><th>Sent</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {iSent.map((one) => (
                    <tr key={one.id}>
                      <td>
                        <Link className="d-t-main" to={`/v2/leads/${one.opportunityId}`}>
                          {one.leadName ?? 'Unnamed lead'}
                        </Link>
                        <div className="d-t-sub">{detailOf(one)}</div>
                      </td>
                      <td>
                        <span className="d-person">
                          <Avatar name={one.toName} size={26} />
                          <b>{one.toName}</b>
                        </span>
                        <div className="d-t-sub v2-tr-reason">{REASONS[one.reason] ?? one.reason}</div>
                      </td>
                      <td className="d-t-sub">{when(one.requestedAt)}</td>
                      <td>
                        <StatusChip status={one.status} />
                        <div className="d-t-sub v2-tr-reason">{waitingOn(one)}</div>
                      </td>
                      <td>
                        <div className="d-row-actions">
                          <button
                            type="button"
                            className="d-btn d-xs d-danger"
                            disabled={busy === one.id}
                            onClick={() => act(one.id, 'cancel', {},
                              `Request cancelled. ${one.leadName ?? 'The lead'} stays with you.`)}
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="d-col d-gap-16 v2-tr-side">
          <section className="d-card v2-rules-card">
            <h3>The rules</h3>
            {AGENT_RULES.map((rule) => (
              <div className="d-rule" key={rule.icon}>
                <Icon name={rule.icon} /><span>{rule.text}</span>
              </div>
            ))}
          </section>

          {/* The design counts a month. Nothing sends an agent their own
              history — `iSent` is the open ones and `forMe` the unanswered —
              so the card counts what is open instead of inventing a month. */}
          <section className="d-card">
            <div className="d-card-head d-mb-8"><h3>Open right now</h3></div>
            <div className="d-row d-gap-24">
              <div className="d-stat">
                <b className="d-num">{iSent.length}</b><span className="d-label">You sent</span>
              </div>
              <div className="d-stat">
                <b className="d-num">{forMe.length}</b><span className="d-label">Waiting on you</span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

/* ── the owner's screen ────────────────────────────────────────────────── */

const SEGMENTS = [
  { key: '', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Finished' },
];

function OwnerView({ lists, busy, act }: { lists: Lists; busy: string | null; act: Act }) {
  const { toApprove, recent } = lists;
  const [segment, setSegment] = useState('');

  const open = recent.filter((one) => isOpen(one.status));
  const rows = segment === '' ? recent
    : segment === 'open' ? open
      : recent.filter((one) => !isOpen(one.status));

  /* Who gives leads away and who collects them, from the week the endpoint
     actually returns. The design says "this month"; nothing sends a month. */
  const flow = useMemo(() => {
    const seen = new Map<string, { gave: number; got: number }>();
    const bump = (name: string, key: 'gave' | 'got') => {
      const row = seen.get(name) ?? { gave: 0, got: 0 };
      row[key] += 1;
      seen.set(name, row);
    };
    for (const one of recent) {
      bump(one.fromName, 'gave');
      if (one.status === 'accepted') bump(one.toName, 'got');
    }
    return [...seen].map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.gave - a.gave || b.got - a.got || a.name.localeCompare(b.name));
  }, [recent]);

  const most = Math.max(1, ...flow.map((row) => Math.max(row.gave, row.got)));
  const accepted = recent.filter((one) => one.status === 'accepted').length;
  const refused = recent.filter((one) => one.status === 'refused').length;

  return (
    <div className="d-tgrid v2-tr-owner">
      <div>
        <div className="d-sec">
          <span className="d-sec-label">
            Needs your approval
            {toApprove.length > 0 && <span className="d-badge d-accent">{toApprove.length}</span>}
          </span>
          <Link className="d-card-link" to="/v2/leads">
            Move leads yourself <Icon name="arrow-right" size={14} />
          </Link>
        </div>

        {toApprove.length === 0 ? (
          <div className="d-card">
            <div className="d-empty v2-empty-tight">
              <span className="d-ic v2-ic-green"><Icon name="check" size={28} /></span>
              <b>Nothing to approve</b>
              <p>Transfers in stage Meeting or Offer come here first.</p>
            </div>
          </div>
        ) : toApprove.map((one) => (
          <div className="d-treq v2-treq-row" key={one.id}>
            <Who one={one} who="both" />
            <Deadline one={one} />
            <div className="d-col d-gap-8 v2-treq-acts">
              <button
                type="button"
                className="d-btn d-primary"
                disabled={busy === one.id}
                onClick={() => act(one.id, 'approve', { agree: true },
                  `Approved. ${one.leadName ?? 'The lead'} goes to ${one.toName} when they accept.`)}
              >
                <Icon name="check" />Approve
              </button>
              <button
                type="button"
                className="d-btn d-danger"
                disabled={busy === one.id}
                onClick={() => act(one.id, 'approve', { agree: false },
                  `Refused. ${one.leadName ?? 'The lead'} stays with ${one.fromName}.`)}
              >
                Refuse
              </button>
            </div>
          </div>
        ))}

        <div className="d-sec d-mt-24">
          <span className="d-sec-label">All transfers · last 7 days</span>
          <div className="d-seg d-sm" role="group" aria-label="Which transfers">
            {SEGMENTS.map((one) => (
              <button
                key={one.key}
                type="button"
                className={segment === one.key ? 'd-on' : undefined}
                onClick={() => setSegment(one.key)}
              >
                {one.label} · {one.key === '' ? recent.length
                  : one.key === 'open' ? open.length : recent.length - open.length}
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="d-card">
            <div className="d-empty v2-empty-tight">
              <b>Nothing here</b>
              <p>No transfer in the last seven days matches that.</p>
            </div>
          </div>
        ) : (
          <div className="d-table-wrap">
            <table className="d-table d-id-all">
              <thead>
                <tr><th>Lead</th><th>From → to · reason</th><th>When</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((one) => (
                  <tr key={one.id}>
                    <td>
                      <Link className="d-t-main" to={`/v2/leads/${one.opportunityId}`}>
                        {one.leadName ?? 'Unnamed lead'}
                      </Link>
                      <div className="d-t-sub">{detailOf(one)}</div>
                    </td>
                    <td>
                      <span className="d-flow">
                        <span className="d-person">
                          <Avatar name={one.fromName} size={26} /><b>{one.fromName}</b>
                        </span>
                        <Icon name="arrow-right" size={14} />
                        <span className="d-person">
                          <Avatar name={one.toName} size={26} /><b>{one.toName}</b>
                        </span>
                      </span>
                      <div className="d-t-sub v2-tr-reason">{REASONS[one.reason] ?? one.reason}</div>
                    </td>
                    <td className="d-t-sub">{when(one.requestedAt)}</td>
                    <td><StatusChip status={one.status} owner /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <aside className="d-col d-gap-16 v2-tr-side">
        <section className="d-card">
          <div className="d-card-head d-mb-8"><h3>Who gives and who gets</h3></div>
          {flow.length === 0 ? (
            <p className="d-small d-muted">Nobody has passed a lead on this week.</p>
          ) : (
            <>
              <div className="d-gg d-gg-head">
                <span>Agent</span><span>Gave</span><span /><span>Got</span><span />
              </div>
              {flow.map((row) => (
                <div className="d-gg" key={row.name}>
                  <span className="d-nm d-truncate">{row.name}</span>
                  <div className="d-bar" style={{ ['--v' as string]: `${(row.gave / most) * 100}%` }}><i /></div>
                  <b>{row.gave}</b>
                  <div className="d-bar d-green" style={{ ['--v' as string]: `${(row.got / most) * 100}%` }}><i /></div>
                  <b>{row.got}</b>
                </div>
              ))}
            </>
          )}
          <div className="d-card-foot">
            <Icon name="info" size={14} />
            <span>
              {recent.length} transfer{recent.length === 1 ? '' : 's'} in seven days ·
              {' '}{accepted} accepted · {refused} refused
            </span>
          </div>
        </section>

        <section className="d-card v2-rules-card">
          <h3>How transfers work</h3>
          {OWNER_RULES.map((rule) => (
            <div className="d-rule" key={rule.icon}>
              <Icon name={rule.icon} /><span>{rule.text}</span>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}

/* ── the pieces ────────────────────────────────────────────────────────── */

/** The lead, who it came from, and why — the left two thirds of a request. */
function Who({ one, who }: { one: Transfer; who: 'from' | 'both' }) {
  const stage = STAGE[one.stage] ?? { word: one.stage, chip: '' };
  return (
    <>
      <Avatar name={one.leadName ?? '?'} size={64} />
      <div className="d-who">
        <div className="d-nm">
          <Link to={`/v2/leads/${one.opportunityId}`}>{one.leadName ?? 'Unnamed lead'}</Link>
          <span className={`d-chip ${stage.chip}`}>{stage.word}</span>
        </div>
        <div className="d-sub">{detailOf(one)}</div>
        <div className="d-why">
          <span className="d-flow">
            <Avatar name={one.fromName} size={20} />
            {one.fromName}
            <Icon name="arrow-right" size={14} />
            {who === 'both' ? (
              <>
                <Avatar name={one.toName} size={20} />
                {one.toName}
              </>
            ) : 'you'}
          </span>
          <span>
            · “{REASONS[one.reason] ?? one.reason}” · sent {when(one.requestedAt)}
            {one.note ? ` · “${one.note}”` : ''}
          </span>
        </div>
      </div>
    </>
  );
}

/** When the request dies, and how long that leaves. */
function Deadline({ one }: { one: Transfer }) {
  const phone = useIsPhone();
  if (!one.expiresAt) return null;
  const left = Date.parse(one.expiresAt) - Date.now();
  /*
   * `Transfers.dc.html` puts this on the card's top right as one amber pill
   * reading "Answer by 18:00". The computer's version is a 22px clock over a
   * caption, which on a phone was the biggest thing in the card — bigger
   * than the lead's name, which is what the card is about.
   */
  if (phone) {
    return (
      <div className="d-deadline v2-b-by">
        {left > 0 ? `Answer by ${clock(one.expiresAt)}` : 'Time is up'}
      </div>
    );
  }
  return (
    <div className="d-deadline">
      <b>{clock(one.expiresAt)}</b>
      <span>Answer by{left > 0 ? ` · ${howLong(left)} left` : ' · time is up'}</span>
    </div>
  );
}

/** §4 of `docs/v2/phone-shell.md`: under this, the phone layout. */
const PHONE = 768;

/** Whether this is a phone, in the component and not only in CSS. */
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

function StatusChip({ status, owner }: { status: string; owner?: boolean }) {
  if (status === 'accepted') return <span className="d-chip d-green d-pip">Accepted</span>;
  if (status === 'refused') return <span className="d-chip d-red d-pip">Refused</span>;
  if (status === 'cancelled') return <span className="d-chip">Cancelled</span>;
  if (status === 'expired') return <span className="d-chip">Ended 18:00</span>;
  if (status === 'needs_approval') {
    return (
      <span className="d-chip d-orange d-pip">
        {owner ? 'Needs your approval' : 'Owner must approve'}
      </span>
    );
  }
  return <span className="d-chip d-amber d-pip">Waiting</span>;
}

function isOpen(status: string): boolean {
  return status === 'pending' || status === 'needs_approval';
}

/** The line under a lead's name: project, and what stage it is at. */
function detailOf(one: Transfer): string {
  return [one.project, STAGE[one.stage]?.word ?? one.stage].filter(Boolean).join(' · ');
}

function waitingOn(one: Transfer): string {
  if (one.status === 'needs_approval') return 'The owner has not answered yet';
  if (one.status === 'pending') return `Waiting for ${one.toName}`;
  return '';
}

/*
 * Dubai is UTC+4 the whole year and has no daylight saving, so the wall clock
 * is the instant plus four hours. A timezone library would be four hundred
 * kilobytes to say the same thing.
 */
function dubai(at: string): Date {
  return new Date(Date.parse(at) + 4 * 3600_000);
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

function clock(at: string): string {
  const on = dubai(at);
  return `${two(on.getUTCHours())}:${two(on.getUTCMinutes())}`;
}

/**
 * When a request was sent: the day **and** the clock.
 *
 * Emir, 14 Nov 2026: *"Transfers page: the When column shows only the day.
 * Show date AND time."* Today's rows already carried a time and everything
 * older dropped it, so a row from yesterday said "Thu 13 Nov" and there was
 * no way to tell a request sent before the morning meeting from one sent
 * after it. 24-hour, Dubai, like every other time in the product.
 */
export function when(at: string): string {
  const on = dubai(at);
  const today = dubai(new Date().toISOString());
  if (on.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)) {
    return `Today ${clock(at)}`;
  }
  const day = on.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
  return `${day} ${clock(at)}`;
}

function howLong(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  return `${Math.round(mins / 60)} h`;
}
