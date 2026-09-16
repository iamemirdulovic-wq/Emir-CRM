import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { humanize } from '../lib/format.js';
import type { PoolStatus } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { stageStyle } from '../design/stages.js';
import { ago, Avatar, Empty, ErrorNote, Note, Panel, Score, Spinner, Toolbar, useToast } from '../design/ui.js';

/**
 * The shared lead pool.
 *
 * Leads that belong to nobody, and the ones this agent has claimed. Claiming is
 * atomic on the server, so two agents pressing the button at the same moment
 * get two different people.
 */
export function Pool() {
  const toast = useToast();
  const status = useAsync<PoolStatus>(() => api.get('/api/teams/pool'), []);
  const [busy, setBusy] = useState(false);

  async function claim() {
    setBusy(true);
    try {
      const lead = await api.post<{ fullName: string | null }>('/api/teams/pool/claim');
      toast(`${lead.fullName ?? 'A lead'} is yours — call them now`);
      status.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not claim a lead');
    } finally {
      setBusy(false);
    }
  }

  async function release(opportunityId: string) {
    try {
      await api.post('/api/teams/pool/release', { opportunityId });
      toast('Back in the pool for someone else');
      status.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not release that lead');
    }
  }

  if (status.error) return <ErrorNote>{status.error}</ErrorNote>;
  if (!status.data) return <Spinner />;

  const atLimit = status.data.claimedByYou >= status.data.maxOpenClaims;

  return (
    <>
      <Toolbar
        right={
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || status.data.available === 0 || atLimit}
            onClick={() => void claim()}
          >
            <Icon name="user-plus" />
            <span>{busy ? 'Claiming…' : 'Claim next lead'}</span>
          </button>
        }
      >
        <span className="pill info">{status.data.available} waiting</span>
        <span className={atLimit ? 'pill due' : 'pill'}>
          {status.data.claimedByYou} of {status.data.maxOpenClaims} claimed
        </span>
      </Toolbar>

      <div className="dash">
        <Panel span={12} index={0} icon="inbox" title="Leads you have claimed">
          {atLimit && (
            <p className="err" style={{ display: 'block' }}>
              You are holding {status.data.maxOpenClaims} leads. Work some of them, or give a few back,
              before claiming more.
            </p>
          )}

          {status.data.claimed.length === 0 && (
            <Empty
              icon="inbox"
              title="Nothing claimed yet"
              hint={
                status.data.available > 0
                  ? `${status.data.available} leads are waiting. Press "Claim next lead".`
                  : 'The pool is empty right now.'
              }
            />
          )}

          {status.data.claimed.map((lead) => (
            <div className="bank" key={lead.opportunity_id}>
              <Avatar name={lead.full_name} size={36} colour={stageStyle(lead.stage_key).colour} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block' }}>
                  <Link to={`/contacts/${lead.contact_id}`} style={{ color: 'var(--ink)' }}>
                    {lead.full_name ?? 'Unnamed lead'}
                  </Link>
                </b>
                <small className="muted">
                  {lead.phone_e164 ?? '—'}
                  {lead.project_name ? ` · ${lead.project_name}` : ''} · claimed {ago(lead.claimed_at)} ago
                </small>
              </div>
              <Score value={lead.lead_score} />
              {lead.phone_e164 && (
                <a className="icon-btn" href={`tel:${lead.phone_e164}`} aria-label={`Call ${lead.full_name ?? ''}`}>
                  <Icon name="phone" />
                </a>
              )}
              <Link className="icon-btn" to={`/inbox?contact=${lead.contact_id}`} aria-label="Open the conversation">
                <Icon name="message-circle" />
              </Link>
              <button type="button" className="rowbtn" onClick={() => void release(lead.opportunity_id)}>
                Give back
              </button>
            </div>
          ))}

          <Note>
            A claimed lead you never touch goes back to the pool automatically, so nothing sits
            forgotten in somebody&rsquo;s queue.
          </Note>
        </Panel>
      </div>
    </>
  );
}
