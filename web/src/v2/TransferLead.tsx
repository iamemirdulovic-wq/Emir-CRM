import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  /**
   * The languages this person speaks.
   *
   * It used to be one string, and the string was `users.locale` — which
   * language the CRM's own buttons are in. With one locale in the office every
   * agent came back saying "en", the chips below had a single entry, and the
   * whole language filter hid itself. On the one screen whose first question
   * is "who speaks Russian". The owner reported it; the server now reads
   * `agent_profiles.languages`, which the profile page writes.
   */
  languages: string[];
  markedToday: string | null;
  wasLate: boolean;
  lateMinutes: number | null;
  /** When they said they would be back, if they are out right now. */
  backBy: string | null;
  onLeave: boolean;
  dealsThisMonth: number;
  /** Median seconds from being given a lead to touching it. */
  replySeconds: number | null;
  maxOpenLeads: number | null;
}

/** The languages the people on the list actually speak, for the chips. */
function languagesIn(people: Who[]): string[] {
  const found = new Set<string>();
  for (const one of people) {
    for (const word of one.languages ?? []) {
      const tidy = word.trim();
      if (tidy) found.add(tidy);
    }
  }
  return [...found].sort();
}

/** The status chip on each card: In office · Late · 24 min · Outside until 16:00. */
function standing(one: Who): { word: string; chip: string } {
  if (one.onLeave) return { word: 'On leave', chip: 'd-chip d-att-leave' };
  if (one.markedToday === 'outside') {
    const back = one.backBy
      ? new Date(one.backBy).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
      : null;
    return {
      word: back ? `Outside until ${back}` : 'Working outside',
      chip: 'd-chip d-att-outside',
    };
  }
  if (one.markedToday === 'office') {
    return one.wasLate
      ? {
        word: one.lateMinutes ? `Late · ${one.lateMinutes} min` : 'Late',
        chip: 'd-chip d-att-late',
      }
      : { word: 'In office', chip: 'd-chip d-att-office' };
  }
  /* Not checked in and not on leave. The register's own word for it. */
  return { word: 'Not in yet', chip: 'd-chip d-att-absent' };
}

/** "replies in 3 min". Minutes, because seconds read as a stopwatch. */
function replyIn(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = seconds / 3600;
  return hours < 24 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} d`;
}

export function TransferLead({ opportunityId, who, isVip, onDone, onCancel }: {
  opportunityId: string;
  who?: string | null;
  isVip?: boolean;
  onDone: (said: string) => void;
  onCancel: () => void;
}) {
  const people = useAsync<{ items: Who[] }>(() => api.get('/api/v2/transfers/who'), []);
  const navigate = useNavigate();
  const [language, setLanguage] = useState<string>('');
  const [to, setTo] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const all = people.data?.items ?? [];
  const list = language
    ? all.filter((one) => (one.languages ?? [])
      .some((word) => word.toLowerCase() === language.toLowerCase()))
    : all;
  const chosen = all.find((one) => one.id === to) ?? null;
  /* "Best match" goes on the first person who can take it right now — which
     is not the same as the first row, because somebody on leave or not yet in
     is still listed. The build put "Fewest leads" there instead. */
  const best = list.find((one) => !one.onLeave && one.markedToday !== null)?.id ?? null;
  const over = chosen && chosen.maxOpenLeads !== null && chosen.openLeads >= chosen.maxOpenLeads
    ? `${chosen.name} has ${chosen.openLeads} open leads, above the desk maximum of `
      + `${chosen.maxOpenLeads}. ${chosen.name} may say no.`
    : null;

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
            {/* `TransferLead.dc.html`'s own title, with the lead's name
                under it. The computer panel titles itself "Transfer {name}";
                either way the name is on the panel. */}
            <h2>Transfer this lead</h2>
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
                <b>A VIP lead cannot be transferred.</b> The owner gave this lead to you. If you
                cannot take it, send it back from My Day — “I can’t take it” — and the owner
                chooses the next agent.
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
            <>
              {/* The prototype's way out of this state, which the build left
                  as a dead end: the thing to do next is on My Day. */}
              <Link className="d-btn d-primary d-full" to="/v2" onClick={onCancel}>Go to My Day</Link>
              <button type="button" className="d-btn d-full" onClick={onCancel}>Close</button>
            </>
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
              {list.map((one) => {
                const state = standing(one);
                const tooMany = one.maxOpenLeads !== null && one.openLeads >= one.maxOpenLeads;
                const replies = replyIn(one.replySeconds);
                return (
                  <button
                    key={one.id}
                    type="button"
                    disabled={one.onLeave}
                    className={to === one.id ? 'd-opt d-agent-card d-on' : 'd-opt d-agent-card'}
                    onClick={() => setTo(one.id)}
                  >
                    <Avatar name={one.name} src={one.photoUrl ?? undefined} />
                    <span className="d-grow">
                      <span className="d-row d-gap-6">
                        <b className="d-bold">{one.name}</b>
                        {one.id === best && (
                          <span className="d-chip d-green v2-leadtr-best">Best match</span>
                        )}
                        <span className={state.chip}>{state.word}</span>
                      </span>
                      {/* What they speak, which is the reason this screen
                          exists. Blank rather than "en" when nobody has filled
                          their profile in. */}
                      {one.languages.length > 0 && (
                        <span className="d-small d-muted">{one.languages.join(', ')}</span>
                      )}
                      <span className="d-meta">
                        <span>
                          <b className={tooMany ? 'd-t-red' : undefined}>{one.openLeads}</b> open
                          {tooMany ? ` · above max ${one.maxOpenLeads}` : ''}
                        </span>
                        <span><b>{one.dealsThisMonth}</b> deals this month</span>
                        {replies && <span>replies in <b>{replies}</b></span>}
                      </span>
                    </span>
                    {/*
                      * The design puts a Profile link on the card. A link
                      * inside a button is not legal markup, so it is a span
                      * that navigates — and it stops the click reaching the
                      * card, or choosing somebody would also leave the panel.
                      */}
                    <span
                      className="d-card-link"
                      role="link"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); navigate(`/v2/team/${one.id}`); }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.stopPropagation();
                        navigate(`/v2/team/${one.id}`);
                      }}
                    >
                      Profile
                    </span>
                  </button>
                );
              })}
              {list.length === 0 && (
                <div className="d-empty">
                  <b>
                    {language
                      ? `No agent speaks ${language}`
                      : 'Nobody is free to take it right now'}
                  </b>
                  <p>
                    {language
                      ? 'Choose “All” to see everyone.'
                      : people.error ?? 'Everybody is on leave or off today.'}
                  </p>
                </div>
              )}
            </div>
            <span className="d-error">Choose an agent.</span>
            {over && <span className="d-hint">{over}</span>}
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
