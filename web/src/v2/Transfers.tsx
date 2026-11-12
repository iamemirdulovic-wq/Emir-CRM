import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';

/**
 * Transfers: handing a lead to a colleague.
 *
 * `docs/v2/pages.md` §15. The screen says plainly whose turn it is, because
 * the one way a transfer goes wrong is quietly: the sender thinks it is gone,
 * the receiver has not seen it, and nobody rings the client.
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

const STAGE: Record<string, string> = {
  new_lead: 'New', attempted_contact: 'Called', engaged_qualified: 'Interested',
  appointment_scheduled: 'Meeting', deal_sent: 'Offer', won: 'Won', lost: 'Lost',
};

export function V2Transfers() {
  const { user } = useAuth();
  const lists = useAsync<Lists>(() => api.get('/api/v2/transfers'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

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

  const { forMe, iSent, toApprove, recent } = lists.data;
  const nothing = forMe.length === 0 && iSent.length === 0
    && toApprove.length === 0 && recent.length === 0;

  return (
    <div className="v2-tr">
      <header className="v2-inc-head">
        <h1 className="v2-hi">Transfers</h1>
        <p className="d-muted">
          A lead stays with whoever has it until the other person says yes.
        </p>
      </header>

      {said && <p className="v2-said">{said}</p>}

      {nothing && (
        <div className="v2-empty">
          <span className="v2-empty-mark"><Icon name="repeat" /></span>
          <h2>Nothing to hand over</h2>
          <p>Pass a lead on from the lead itself, with the button at the top.</p>
          <Link className="d-btn d-primary" to="/v2/leads">My leads</Link>
        </div>
      )}

      {forMe.length > 0 && (
        <section className="d-card">
          <div className="d-card-head">
            <h3>For you</h3>
            <span className="d-badge d-accent">{forMe.length}</span>
          </div>
          <ul className="v2-tr-list">
            {forMe.map((one) => (
              <li key={one.id} className="v2-tr-row">
                <Row one={one} />
                <button type="button" className="d-btn d-xs d-primary" disabled={busy === one.id}
                  onClick={() => act(one.id, 'answer', { accept: true }, `${one.leadName ?? 'The lead'} is yours now.`)}>
                  Accept
                </button>
                <button type="button" className="d-btn d-xs" disabled={busy === one.id}
                  onClick={() => act(one.id, 'answer', { accept: false }, 'Sent back to them.')}>
                  No, thanks
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {toApprove.length > 0 && user?.role !== 'agent' && (
        <section className="d-card">
          <div className="d-card-head">
            <h3>Needs your approval</h3>
            <span className="d-badge d-accent">{toApprove.length}</span>
          </div>
          <p className="d-small d-muted">
            These are at Meeting or Offer — a deal in progress does not change hands
            without you.
          </p>
          <ul className="v2-tr-list">
            {toApprove.map((one) => (
              <li key={one.id} className="v2-tr-row">
                <Row one={one} showBoth />
                <button type="button" className="d-btn d-xs d-primary" disabled={busy === one.id}
                  onClick={() => act(one.id, 'approve', { agree: true }, `${one.toName} can take it if they accept.`)}>
                  Approve
                </button>
                <button type="button" className="d-btn d-xs d-danger" disabled={busy === one.id}
                  onClick={() => act(one.id, 'approve', { agree: false }, `It stays with ${one.fromName}.`)}>
                  Refuse
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {iSent.length > 0 && (
        <section className="d-card">
          <div className="d-card-head"><h3>You sent</h3></div>
          <ul className="v2-tr-list">
            {iSent.map((one) => (
              <li key={one.id} className="v2-tr-row">
                <Row one={one} showTo />
                <span className="d-chip">
                  {one.status === 'needs_approval' ? 'Waiting for the owner' : 'Waiting for them'}
                </span>
                <button type="button" className="d-btn d-xs" disabled={busy === one.id}
                  onClick={() => act(one.id, 'cancel', {}, 'Taken back.')}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && user?.role !== 'agent' && (
        <section className="d-card">
          <div className="d-card-head">
            <h3>Everything, last seven days</h3>
          </div>
          <ul className="v2-tr-list">
            {recent.map((one) => (
              <li key={one.id} className="v2-tr-row">
                <Row one={one} showBoth />
                <span className={`d-chip ${statusChip(one.status)}`}>{statusWord(one.status)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ one, showTo, showBoth }: { one: Transfer; showTo?: boolean; showBoth?: boolean }) {
  return (
    <>
      <Avatar name={showTo ? one.toName : one.fromName} />
      <span className="v2-tr-what">
        <b>
          {one.leadName ?? 'Unnamed lead'}
          <span className="d-chip">{STAGE[one.stage] ?? one.stage}</span>
        </b>
        <span>
          {showBoth ? `${one.fromName} → ${one.toName}` : showTo ? `to ${one.toName}` : `from ${one.fromName}`}
          {' · '}{REASONS[one.reason] ?? one.reason}
          {one.note ? ` · “${one.note}”` : ''}
          {one.project ? ` · ${one.project}` : ''}
        </span>
        {one.expiresAt && one.status === 'pending' && (
          <span className="v2-tr-by">
            Answer by {new Date(one.expiresAt).toLocaleTimeString('en-GB', {
              hour: '2-digit', minute: '2-digit', hour12: false,
            })}
          </span>
        )}
      </span>
      <Link className="d-btn d-xs" to={`/v2/leads/${one.opportunityId}`}>Open</Link>
    </>
  );
}

function statusWord(status: string): string {
  if (status === 'accepted') return 'Taken';
  if (status === 'refused') return 'Refused';
  if (status === 'cancelled') return 'Taken back';
  if (status === 'expired') return 'No answer';
  if (status === 'needs_approval') return 'Waiting for the owner';
  return 'Waiting';
}

function statusChip(status: string): string {
  if (status === 'accepted') return 'd-green';
  if (status === 'refused' || status === 'expired') return 'd-red';
  return '';
}
