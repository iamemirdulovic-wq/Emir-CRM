import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { Avatar } from '../design/ui.js';
import { REASONS } from './Transfers.js';

/**
 * The form behind "Transfer this lead to another agent".
 *
 * The design draws it as the 480px right-hand panel (`lead-kit.js`, the
 * transfer panel): language first, then who, then why, then the three rules
 * that decide what happens next. Its own markup and its own classes, so the
 * panel in this app and the panel in the design are the same panel.
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

/** The languages the people on the list actually speak, for the chips. */
function languagesIn(people: Who[]): string[] {
  const found = new Set<string>();
  for (const one of people) {
    for (const word of (one.language ?? '').split(/[,/]/)) {
      const tidy = word.trim();
      if (tidy) found.add(tidy);
    }
  }
  return [...found].sort();
}

export function TransferLead({ opportunityId, who, isVip, onDone, onCancel }: {
  opportunityId: string;
  who?: string | null;
  isVip?: boolean;
  onDone: (said: string) => void;
  onCancel: () => void;
}) {
  const people = useAsync<{ items: Who[] }>(() => api.get('/api/v2/transfers/who'), []);
  const [language, setLanguage] = useState<string>('');
  const [to, setTo] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const all = people.data?.items ?? [];
  const list = language
    ? all.filter((one) => (one.language ?? '').toLowerCase().includes(language.toLowerCase()))
    : all;
  const chosen = all.find((one) => one.id === to) ?? null;

  const needsNote = reason === 'other';
  const ready = to !== null && reason !== null && (!needsNote || note.trim().length >= 5);

  async function send() {
    setShown(true);
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

  const bad = (test: boolean) => (shown && test ? 'd-field d-invalid' : 'd-field');

  return (
    <>
      <div className="v2-panel-back" onClick={onCancel} aria-hidden />
      <aside className="d-panel d-open" aria-label="Transfer a lead">
        <div className="d-panel-head">
          <div className="d-grow">
            <h2>Transfer a lead</h2>
            <p className="d-small d-muted">{who ?? 'This lead'}</p>
          </div>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onCancel}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-16">
          {isVip && (
            <div className="d-banner d-red">
              <Icon name="crown" />
              <span className="d-grow">
                <b>A VIP lead goes back to the owner.</b> Only the owner gives it to another agent.
              </span>
            </div>
          )}

          {/*
            * A VIP lead gets the banner and nothing else.
            *
            * `server/src/v2/transfers.ts` refuses one outright — "A VIP lead
            * cannot be passed sideways" — so filling the form in could only
            * ever end in that error, and `TransferLead.dc.html` draws the
            * blocked state instead of the form for exactly that reason.
            */}
          {isVip && (
            <button type="button" className="d-btn d-full" onClick={onCancel}>Close</button>
          )}

          {!isVip && languagesIn(all).length > 1 && (
            <div className="d-field">
              <span className="d-field-label">Language</span>
              <div className="d-chips">
                <button
                  type="button"
                  className={language === '' ? 'd-chip-opt d-on' : 'd-chip-opt'}
                  onClick={() => setLanguage('')}
                >
                  All
                </button>
                {languagesIn(all).map((one) => (
                  <button
                    key={one}
                    type="button"
                    className={language === one ? 'd-chip-opt d-on' : 'd-chip-opt'}
                    onClick={() => setLanguage(one)}
                  >
                    {one}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isVip && (
          <>
          <div className={bad(to === null)}>
            <span className="d-field-label">
              Give to <span className="d-t-accent">*</span>{' '}
              <span className="d-muted v2-leadtr-hint">· free now first, then fewest open leads</span>
            </span>
            <div className="d-opt-list">
              {list.map((one, i) => (
                <button
                  key={one.id}
                  type="button"
                  disabled={one.onLeave}
                  className={to === one.id ? 'd-opt d-on' : 'd-opt'}
                  onClick={() => setTo(one.id)}
                >
                  <Avatar name={one.name} src={one.photoUrl ?? undefined} />
                  <span className="d-grow">
                    <b className="d-bold">{one.name}</b>
                    {i === 0 && !one.onLeave && (
                      <span className="d-chip d-green v2-leadtr-best">Fewest leads</span>
                    )}
                    <div className="d-small d-muted">
                      {one.language
                        || (one.onLeave ? 'On leave'
                          : one.markedToday === 'office' ? 'In the office'
                            : one.markedToday === 'outside' ? 'Working outside'
                              : 'Not marked today')}
                    </div>
                  </span>
                  <span className="d-small d-muted d-nowrap">{one.openLeads} open</span>
                </button>
              ))}
              {list.length === 0 && (
                <p className="d-small d-muted">
                  {people.error ?? 'Nobody is free to take it right now.'}
                </p>
              )}
            </div>
            <span className="d-error">Choose an agent.</span>
          </div>

          <div className={bad(reason === null)}>
            <span className="d-field-label">Reason <span className="d-t-accent">*</span></span>
            <div className="d-chips">
              {Object.entries(REASONS).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={reason === value ? 'd-chip-opt d-on' : 'd-chip-opt'}
                  onClick={() => setReason(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="d-error">Choose a reason.</span>
          </div>

          <div className={bad(needsNote && note.trim().length < 5)}>
            <label htmlFor="tr-note">
              Anything they should know{needsNote ? ' ' : ''}
              {needsNote && <span className="d-req">*</span>}
            </label>
            <textarea
              className="d-textarea v2-leadtr-note"
              id="tr-note"
              value={note}
              placeholder="He asked for a Russian speaker"
              onChange={(e) => setNote(e.target.value)}
            />
            <span className="d-error">Write at least 5 letters.</span>
          </div>

          <ul className="d-rules">
            <li>The lead stays with you until the agent accepts.</li>
            <li>No answer by 18:00 ends the request.</li>
            <li>Notes and history go with the lead.</li>
          </ul>

          {problem && <div className="d-banner d-red"><span className="d-grow">{problem}</span></div>}
          </>
          )}
        </div>

        {!isVip && (
        <div className="d-panel-foot">
          <button type="button" className="d-btn d-ghost" onClick={onCancel}>Cancel</button>
          <span className="d-grow" />
          <button type="button" className="d-btn d-primary" disabled={busy} onClick={send}>
            {busy ? 'Asking…' : chosen ? `Send request to ${chosen.name}` : 'Send request'}
          </button>
        </div>
        )}
      </aside>
    </>
  );
}
