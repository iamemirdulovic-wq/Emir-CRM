import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { formatAedShort, humanize } from '../lib/format.js';
import { Icon } from '../design/index.js';
import { useToast } from '../design/ui.js';
import { play } from '../lib/sound.js';

/**
 * The new-lead alert from the approved design, wired to a real lead.
 *
 * It is the card the design puts top-right: flame, project, the one line an
 * agent needs, then Open lead and Call. Both buttons accept the lead, because
 * opening it or ringing the client is accepting it — there is no third thing
 * an agent could mean by pressing either. That matters: a lead nobody accepts
 * bounces back to the owner after the SLA, so without this card on screen the
 * timer would be taking leads off agents who never knew they had one.
 *
 * Added to the approved design: the countdown, so the deadline is a number
 * the agent can see rather than a surprise.
 */

interface PendingLead {
  id: string;
  contactId: string;
  name: string | null;
  phone: string | null;
  project: string | null;
  budgetMaxAed: number | null;
  source: string | null;
  secondsLeft: number;
}

/** How often to ask. The push notification is the instant alert; this is the
 *  copy for an agent who already has the CRM open in front of them. */
const POLL_MS = 10_000;

export function NewLeadCard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [lead, setLead] = useState<PendingLead | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  /* Leads already dealt with here, so a poll already in flight when the
     button was pressed cannot put one back on screen. */
  const handled = useRef<Set<string>>(new Set());

  const poll = useCallback(async () => {
    try {
      const { items } = await api.get<{ items: PendingLead[] }>('/api/incoming/pending');
      const next = items.find((item) => !handled.current.has(item.id)) ?? null;
      setLead((shown) => {
        /* Only when a different lead arrives — a poll every ten seconds that
           chimed each time would be unbearable by lunchtime. */
        if (next && next.id !== shown?.id) play('new-lead');
        return next;
      });
      if (next) setSeconds(next.secondsLeft);
    } catch {
      /* Offline, or the session ended. The next poll settles it either way,
         and a toast every ten seconds on a bad connection is worse than
         silence. */
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [poll]);

  /*
   * Ticked locally so the number moves every second, but reset from the
   * server on every poll: the server's clock is the one the bounce actually
   * runs on, and a phone with the wrong time must not show a deadline that
   * disagrees with it.
   */
  useEffect(() => {
    if (!lead) return undefined;
    const timer = window.setInterval(() => setSeconds((value) => value - 1), 1000);
    return () => window.clearInterval(timer);
  }, [lead]);

  const accept = useCallback(
    async (then: 'open' | 'call') => {
      if (!lead || busy) return;
      setBusy(true);
      try {
        await api.post(`/api/incoming/${lead.id}/accept`);
        handled.current.add(lead.id);
        const { contactId } = lead;
        setLead(null);
        if (then === 'open') navigate(`/contacts/${contactId}`);
        else toast('Yours. Now call them.');
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Could not accept that lead');
        void poll();
      } finally {
        setBusy(false);
      }
    },
    [lead, busy, navigate, toast, poll],
  );

  if (!lead) return null;

  const late = seconds <= 0;
  const line = [
    lead.name,
    formatAedShort(lead.budgetMaxAed),
    lead.source ? humanize(lead.source) : null,
  ].filter((part) => part && part !== '—').join(' · ');

  return (
    <div className="newlead show" role="alert" aria-live="assertive">
      <b>
        <Icon name="flame" style={{ color: 'var(--hot)' }} />
        <span className="newlead-title" dir="auto">
          New lead{lead.project ? ` · ${lead.project}` : ''}
        </span>
        <span className={late ? 'newlead-clock late' : 'newlead-clock'}>
          {late ? 'time up' : clock(seconds)}
        </span>
      </b>
      <p dir="auto">
        {line}
        {late
          ? '. Going back to the owner — open it now to keep it.'
          : '. Open it or call to keep it.'}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void accept('open')}>
          Open lead
        </button>
        {lead.phone && (
          /* A real tel: link, so one tap dials on the phone they are holding. */
          <a className="btn" href={`tel:${lead.phone}`} onClick={() => void accept('call')}>
            <Icon name="phone" />
            Call
          </a>
        )}
      </div>
    </div>
  );
}

function clock(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
