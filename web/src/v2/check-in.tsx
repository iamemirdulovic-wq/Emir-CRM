import { useCallback, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';

/**
 * The check-in gate.
 *
 * `docs/v2/pages.md`, global shell: before an agent's first call of the day,
 * during work hours, the CRM asks whether they are in the office. Three
 * answers, and all three let the call happen — this is a record, not a lock.
 * "Call anyway" marks that call *not checked in*, and the owner sees it.
 *
 * It is deliberately not asked of owners or admins, outside work hours, or of
 * somebody already marked in or outside for the day. An agent at a developer's
 * sales centre at ten in the morning is working, and a system that nags them
 * about it is one the best people learn to click through without reading.
 */

export type GateAnswer = 'checked_in' | 'outside' | 'anyway' | 'cancel';

interface DayState {
  closed: boolean;
  marked: 'office' | 'outside' | null;
  onOfficeNetwork: boolean;
  enabled: boolean;
  startsAt: string | null;
}

/** Work hours, Dubai. Outside them nobody is asked anything. */
const FROM = 9;
const UNTIL = 18;

export function useCheckIn(): { ask: () => Promise<GateAnswer>; banner: ReactNode } {
  const { user } = useAuth();
  const day = useAsync<DayState>(() => api.get('/api/attendance/today'), []);
  const [asking, setAsking] = useState<((answer: GateAnswer) => void) | null>(null);
  const [saying, setSaying] = useState<string | null>(null);
  /* "I'm working outside" needs to know where. The server requires a note and
     we are not going to invent one: an attendance record that says "outside"
     with no place is the kind of figure an owner cannot act on. */
  const [where, setWhere] = useState<string | null>(null);

  const marked = day.data?.marked ?? null;
  const enabled = day.data?.enabled ?? false;
  const closed = day.data?.closed ?? false;

  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai', hour: '2-digit', hour12: false,
  }).format(new Date()));

  const shouldAsk = user?.role === 'agent'
    && enabled
    && !closed
    && marked === null
    && hour >= FROM
    && hour < UNTIL;

  const ask = useCallback(() => new Promise<GateAnswer>((resolve) => {
    if (!shouldAsk) {
      resolve('checked_in');
      return;
    }
    setAsking(() => resolve);
  }), [shouldAsk]);

  async function answer(choice: GateAnswer) {
    const resolve = asking;
    setAsking(null);
    if (choice === 'checked_in') {
      try {
        await api.post('/api/attendance/check-in', {});
        day.reload();
        setSaying('Checked in. Have a good day.');
      } catch (err) {
        /* Off the office network the server refuses, and it is right to. The
           call still goes ahead, marked as not checked in. */
        setSaying(err instanceof Error ? err.message : 'Could not check you in.');
        resolve?.('anyway');
        return;
      }
    }
    if (choice === 'outside') {
      try {
        await api.post('/api/attendance/outside', { note: (where ?? '').trim() });
        day.reload();
        setSaying('Marked as working outside today.');
      } catch (err) {
        setSaying(err instanceof Error ? err.message : 'Could not mark that.');
        resolve?.('anyway');
        return;
      }
    }
    setWhere(null);
    resolve?.(choice);
  }

  const banner = (
    <>
      {marked === null && enabled && !closed && user?.role === 'agent' && (
        <div className="d-banner d-amber v2-gate-bar">
          <Icon name="alert-triangle" />
          <span className="d-grow">
            <b>You are not checked in.</b> Calls you make now are marked “not checked in”,
            and the owner sees it.
          </span>
          <Link className="d-btn d-xs d-ghost" to="/v2/attendance">I&apos;m working outside</Link>
          <button type="button" className="d-btn d-xs" onClick={() => answer('checked_in')}>
            Check in now
          </button>
        </div>
      )}

      {saying && <p className="v2-gate-said">{saying}</p>}

      {asking && (
        <>
          <div className="d-scrim d-show" aria-hidden />
          <div className="d-dialog d-open d-sm" role="dialog" aria-modal="true" aria-label="You are not checked in yet">
            <div className="d-dialog-head">
              <div className="d-grow">
                <h3>You&apos;re not checked in yet</h3>
                <p>
                  Checking in takes one tap and only works on the office Wi-Fi.
                  You can call either way.
                </p>
              </div>
            </div>

            <div className="d-dialog-body">
              {where === null ? (
                <div className="d-col d-gap-8">
                  <button type="button" className="d-btn d-primary d-block" onClick={() => answer('checked_in')}>
                    <Icon name="check" size={15} />Check in now and call
                  </button>
                  <button type="button" className="d-btn d-block" onClick={() => setWhere('')}>
                    <Icon name="pin" size={15} />I&apos;m working outside
                  </button>
                  <button type="button" className="d-btn d-ghost d-block" onClick={() => answer('anyway')}>
                    Call anyway
                  </button>
                </div>
              ) : (
                <form
                  className="d-col d-gap-8"
                  onSubmit={(e) => { e.preventDefault(); if (where.trim()) void answer('outside'); }}
                >
                  <div className="d-field">
                    <label htmlFor="v2-gate-where">Where are you?</label>
                    <input
                      id="v2-gate-where"
                      className="d-input"
                      value={where}
                      autoFocus
                      placeholder="Emaar sales centre, with a client…"
                      onChange={(e) => setWhere(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="d-btn d-primary d-block" disabled={!where.trim()}>
                    Save and call
                  </button>
                  <button type="button" className="d-btn d-ghost d-block" onClick={() => setWhere(null)}>
                    Back
                  </button>
                </form>
              )}
              <p className="d-small d-muted">
                “Call anyway” marks this call <b>not checked in</b>.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );

  return { ask, banner };
}
