import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { Avatar } from '../design/ui.js';
import { REASONS } from './Transfers.js';

/**
 * The form behind "Give this lead to somebody else".
 *
 * The order of the people is the design's and it is not a score: whoever can
 * take it right now first, then whoever is holding the fewest leads. Somebody
 * on leave is shown greyed and cannot be chosen — a lead handed to somebody
 * who is away is a lead nobody rings.
 */

interface Who {
  id: string;
  name: string;
  photoUrl: string | null;
  openLeads: number;
  language: string | null;
  markedToday: string | null;
  onLeave: boolean;
}

export function TransferLead({ opportunityId, onDone, onCancel }: {
  opportunityId: string;
  onDone: (said: string) => void;
  onCancel: () => void;
}) {
  const who = useAsync<{ items: Who[] }>(() => api.get('/api/v2/transfers/who'), []);
  const [to, setTo] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const needsNote = reason === 'other';
  const ready = to !== null && reason !== null && (!needsNote || note.trim().length >= 5);

  async function send() {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await api.post<{ status: string; toName: string }>('/api/v2/transfers', {
        opportunityId, toUserId: to, reason, note: note.trim() || null,
      });
      onDone(made.status === 'needs_approval'
        ? 'Sent to the owner first — this lead is at Meeting or Offer.'
        : `${made.toName} has been asked. The lead stays with you until they accept.`);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="d-card v2-tr-form">
      <div className="d-card-head">
        <h3>Give this lead to somebody else</h3>
        <button type="button" className="d-card-link" onClick={onCancel}>Not now</button>
      </div>

      <p className="d-small d-muted">
        The lead stays with you until they say yes. They can say no.
      </p>

      <ul className="v2-agent-list">
        {(who.data?.items ?? []).map((one, i) => (
          <li key={one.id}>
            <label className={[
              'v2-agent',
              to === one.id ? 'v2-agent-on' : '',
              one.onLeave ? 'v2-agent-away' : '',
            ].filter(Boolean).join(' ')}
            >
              <input
                type="radio"
                name="to"
                disabled={one.onLeave}
                checked={to === one.id}
                onChange={() => setTo(one.id)}
              />
              <Avatar name={one.name} src={one.photoUrl ?? undefined} />
              <span className="v2-agent-who">
                <b>
                  {one.name}
                  {i === 0 && !one.onLeave && <span className="v2-best">Best match</span>}
                </b>
                <span>
                  {one.openLeads} open
                  {one.onLeave ? ' · on leave'
                    : one.markedToday === 'office' ? ' · in office'
                      : one.markedToday === 'outside' ? ' · outside'
                        : ' · not marked today'}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <span className="v2-field-label">Why? *</span>
      <div className="v2-chips">
        {Object.entries(REASONS).map(([value, label]) => (
          <button key={value} type="button"
            className={reason === value ? 'v2-chip-opt v2-chip-opt-on' : 'v2-chip-opt'}
            onClick={() => setReason(value)}>{label}</button>
        ))}
      </div>

      <label className="v2-field v2-field-wide">
        <span>Anything they should know{needsNote ? ' *' : ''}</span>
        <input className="d-input" value={note} placeholder="He asked for a Russian speaker"
          onChange={(e) => setNote(e.target.value)} />
      </label>

      {problem && <p className="v2-problem">{problem}</p>}

      <button type="button" className="d-btn d-primary" disabled={!ready || busy} onClick={send}>
        {busy ? 'Asking…' : 'Ask them to take it'}
      </button>
    </section>
  );
}
