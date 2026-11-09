/**
 * The one tap an agent makes when they arrive.
 *
 * Emir, Nov 9 2026: people open the CRM in the morning and mark that they are
 * in, and the mark only counts on the office Wi-Fi. This sits at the top of
 * the Dashboard, which is where everybody lands, and disappears for the rest
 * of the day once it has been used.
 *
 * It is deliberately one decision wide. A morning card with a form on it is a
 * card people learn to scroll past.
 *
 * Four states, and only ever one of them:
 *   on the office network, not yet marked   -> the big button
 *   somewhere else, not yet marked          -> working outside, with a note
 *   marked                                  -> a quiet line saying so
 *   office closed, or attendance off        -> nothing at all
 */
import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Button } from '../design/forms.js';
import { Icon } from '../design/index.js';

interface DayState {
  closed: boolean;
  marked: 'office' | 'outside' | null;
  markedAt: string | null;
  wasLate: boolean;
  note: string | null;
  onOfficeNetwork: boolean;
  enabled: boolean;
  startsAt: string | null;
}

/**
 * The same three-part greeting the Dashboard below it uses, on the same Dubai
 * clock. It said "Good morning" at any hour, which read as a bug sitting two
 * lines above "Good afternoon, Test" — and it is one.
 */
function greeting(now: Date = new Date()): string {
  const hour = new Date(now.getTime() + 4 * 60 * 60 * 1000).getUTCHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** Minutes past midnight, Dubai, for "is the start time already behind us". */
function dubaiMinutes(now: Date = new Date()): number {
  const at = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  return at.getUTCHours() * 60 + at.getUTCMinutes();
}

function startedAlready(startsAt: string | null): boolean {
  if (!startsAt) return false;
  const [h, m] = startsAt.split(':').map(Number);
  if (Number.isNaN(h as number) || Number.isNaN(m as number)) return false;
  return dubaiMinutes() > (h as number) * 60 + (m as number);
}

function clockOf(iso: string | null): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  /* Dubai, whatever the phone is set to: the office opens at ten in Dubai
     and a traveller's device must not re-tell the morning in another zone. */
  return at.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
  });
}

export function CheckIn() {
  const state = useAsync<DayState>(() => api.get('/api/attendance/today'), []);
  const [where, setWhere] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const day = state.data;
  /* Nothing to say on a closed day, before an owner has switched it on, or
     while the first read is still in the air. */
  if (!day || !day.enabled || day.closed) return null;

  async function send(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const next = await api.post<DayState>(path, body ?? {});
      state.setData(next);
      setAsking(false);
      setWhere('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not save');
    } finally {
      setBusy(false);
    }
  }

  if (day.marked) {
    return (
      <div className={`checkin done${day.marked === 'outside' ? ' away' : ''}`}>
        <span className="checkin-tick" aria-hidden="true">
          <Icon name={day.marked === 'outside' ? 'map-pin' : 'check'} />
        </span>
        <div className="checkin-said">
          <b>
            {day.marked === 'outside' ? 'Working outside today' : 'You are checked in'}
            {day.wasLate && <span className="checkin-late">late</span>}
          </b>
          <small>
            {clockOf(day.markedAt)}
            {day.note ? ` · ${day.note}` : ''}
          </small>
        </div>
      </div>
    );
  }

  return (
    <div className="checkin">
      <div className="checkin-said">
        <b>{greeting()}</b>
        <small>
          {day.onOfficeNetwork
            ? `You are on the office Wi-Fi${day.startsAt
              ? startedAlready(day.startsAt)
                /* Saying "starts 10:00" at two in the afternoon is not news. */
                ? ` · the day started at ${day.startsAt}`
                : ` · starts ${day.startsAt}`
              : ''}`
            : 'You are not on the office Wi-Fi'}
        </small>
      </div>

      {day.onOfficeNetwork ? (
        <Button variant="primary" icon="check" loading={busy}
          onClick={() => void send('/api/attendance/check-in')}>
          I am here
        </Button>
      ) : asking ? (
        <form
          className="checkin-away"
          onSubmit={(event) => {
            event.preventDefault();
            if (where.trim()) void send('/api/attendance/outside', { note: where.trim() });
          }}
        >
          <input
            className="input"
            value={where}
            maxLength={160}
            autoFocus
            placeholder="Emaar sales centre"
            aria-label="Where are you working from today"
            onChange={(event) => setWhere(event.target.value)}
          />
          <Button variant="primary" type="submit" loading={busy} disabled={!where.trim()}>
            Save
          </Button>
          <button type="button" className="checkin-cancel" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <Button icon="map-pin" onClick={() => setAsking(true)}>
          Working outside today
        </Button>
      )}

      {error && <p className="checkin-err">{error}</p>}
    </div>
  );
}
