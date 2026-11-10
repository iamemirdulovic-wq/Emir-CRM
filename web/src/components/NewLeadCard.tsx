import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { formatAedShort, humanize, plural } from '../lib/format.js';
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
 *
 * Added after a morning of it in real use (Emir, 10 Nov 2026):
 *
 *   - **One card for a batch.** Forty-five leads handed over at once used to
 *     queue forty-five cards, each only clearable by opening its lead. Two or
 *     more waiting now means a single card with the count and one press that
 *     takes the lot.
 *   - **An X.** There was no way to put the card down and carry on working.
 *     It hides for ten minutes rather than accepting anything, and says so,
 *     because a card that quietly stopped the clock would be worse than one
 *     that will not close.
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

/** How long the X puts it away for. Long enough to finish a call. */
const SNOOZE_MS = 10 * 60 * 1000;

export function NewLeadCard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [lead, setLead] = useState<PendingLead | null>(null);
  const [total, setTotal] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  /* Leads already dealt with here, so a poll already in flight when the
     button was pressed cannot put one back on screen. */
  const handled = useRef<Set<string>>(new Set());
  /* When the X was last pressed. Kept in state so the card comes back by
     itself once the ten minutes are up, without a reload. */
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const poll = useCallback(async () => {
    try {
      const { items, total: waiting } = await api.get<{ items: PendingLead[]; total?: number }>(
        '/api/incoming/pending',
      );
      const fresh = items.filter((item) => !handled.current.has(item.id));
      const next = fresh[0] ?? null;
      setTotal(waiting ?? fresh.length);
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
    const timer = window.setInterval(() => {
      setSeconds((value) => value - 1);
      setNow(Date.now());
    }, 1000);
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

  /* The whole batch, in one press. */
  const acceptAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { accepted } = await api.post<{ accepted: number; skipped: number }>(
        '/api/incoming/accept-all',
        {},
      );
      setLead(null);
      setTotal(0);
      toast(
        accepted === 0
          ? 'Nothing left to take — somebody got there first.'
          : `${plural(accepted, 'lead')} are yours. Nothing will be taken back.`,
      );
      void poll();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not take those leads');
      void poll();
    } finally {
      setBusy(false);
    }
  }, [busy, toast, poll]);

  const snooze = useCallback(() => {
    setSnoozedUntil(Date.now() + SNOOZE_MS);
    toast(
      total > 1
        ? 'Hidden for 10 minutes. The leads are still yours and the clock is still running.'
        : 'Hidden for 10 minutes. The lead is still yours and the clock is still running.',
    );
  }, [toast, total]);

  /* Back by itself once the ten minutes are up. */
  useEffect(() => {
    if (snoozedUntil === 0) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [snoozedUntil]);

  if (!lead || now < snoozedUntil) return null;

  const late = seconds <= 0;
  const many = total > 1;

  const close = (
    <button type="button" className="newlead-x" onClick={snooze} aria-label="Hide this for 10 minutes">
      <Icon name="x" size={15} />
    </button>
  );

  /*
   * Several at once: the count, not the first one's details. Which of
   * forty-five it happened to pick is not information, and reading it out
   * made the card feel like it was about one lead when it was about a pile.
   */
  if (many) {
    return (
      <div className="newlead show" role="alert" aria-live="assertive">
        <b>
          <Icon name="flame" style={{ color: 'var(--hot)' }} />
          <span className="newlead-title" dir="auto">{total} new leads for you</span>
          <span className={late ? 'newlead-clock late' : 'newlead-clock'}>
            {late ? 'time up' : clock(seconds)}
          </span>
          {close}
        </b>
        <p dir="auto">
          {late
            ? 'The oldest is going back to the owner. Take them to keep them.'
            : `Take them and they are yours — nothing goes back. The oldest one's clock is the number above.`}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void acceptAll()}>
            Take all {total}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => navigate('/my-leads')}>
            See them
          </button>
        </div>
      </div>
    );
  }

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
        {close}
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
