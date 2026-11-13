import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon, type IconName } from '../design/index.js';
import { Spinner, ErrorNote } from '../design/ui.js';
import { clockIn, flagOf, originOf, whenToCall } from '../lib/dialling.js';
import { spacedE164 } from '../design/phone.js';
import { useCheckIn } from './check-in.js';

/**
 * Calling: one lead at a time, until the list is done.
 *
 * Built from `design/web/calling.html` — the topline with the progress bar and
 * the three counts, the dark lead card with the phone number set at fifty
 * pixels, the six outcome tiles, and today's list down the right-hand side.
 *
 * The rule that shapes the whole screen: **an outcome cannot be set before the
 * agent has pressed Call or WhatsApp.** The CRM has no way of knowing whether
 * a call happened, so the only honest sequence is tap first, then say what
 * happened — a result recorded without a tap is a figure nobody should trust
 * afterwards. The design draws that as `#out.locked`, greyed with an amber
 * padlock, which is `d-id-out d-locked` here.
 *
 * The second rule: *Next* is locked until the result is saved, or the agent
 * presses *Skip*. A lead walked past without an answer is the thing that
 * leaves a queue looking done when it is not.
 */

interface QueueLead {
  id: string;
  contactId: string;
  name: string | null;
  phone: string | null;
  project: string | null;
  unitType: string | null;
  budgetMinAed: number | null;
  budgetMaxAed: number | null;
  language: string | null;
  stage: string;
  score: number | null;
  scoreReason: string | null;
  isVip: boolean;
  nextStepAt: string | null;
  nextStepNote: string | null;
  lastContactAt: string | null;
  noAnswerCount: number;
  calledToday: boolean;
}

type Outcome = 'interested' | 'no_answer' | 'busy' | 'call_back' | 'wrong_number' | 'not_interested';

/* The design's six tiles, in its order, with its icons. There is no flag
   glyph in the bundled set, so "wrong number" takes the warning triangle. */
const OUTCOMES: Array<{ key: Outcome; label: string; icon: IconName }> = [
  { key: 'interested', label: 'Interested', icon: 'star' },
  { key: 'no_answer', label: 'No answer', icon: 'phone' },
  { key: 'busy', label: 'Busy', icon: 'clock' },
  { key: 'call_back', label: 'Call back', icon: 'calendar-days' },
  { key: 'wrong_number', label: 'Wrong number', icon: 'alert-triangle' },
  { key: 'not_interested', label: 'Not interested', icon: 'x' },
];

const LOST_REASONS = [
  { key: 'bought_elsewhere', label: 'Bought somewhere else' },
  { key: 'budget_too_low', label: 'Budget too low' },
  { key: 'just_browsing', label: 'Only looking' },
  { key: 'changed_plans', label: 'Changed their plans' },
  { key: 'other', label: 'Something else' },
];

/** What the save line under the tiles says each outcome will do. */
const CONSEQUENCE: Record<Outcome, string> = {
  interested: 'The stage becomes Interested.',
  no_answer: 'Counted as a try. The lead comes back in two hours.',
  busy: 'Counted as a try. The lead comes back in an hour.',
  call_back: 'A follow-up is put in your list for the time you choose.',
  wrong_number: 'The lead is flagged and leaves your list.',
  not_interested: 'The lead moves to Lost, with the reason you give.',
};

/** The six stages, in the words the board uses. */
const STAGE_LABEL: Record<string, string> = {
  new_lead: 'New', attempted_contact: 'Called', engaged_qualified: 'Interested',
  appointment_scheduled: 'Meeting', deal_sent: 'Offer', won: 'Won', lost: 'Lost',
};

const AED = (n: number | null): string =>
  (n === null ? '—' : `AED ${n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : n.toLocaleString()}`);

export function V2Calling() {
  const queue = useAsync<{ items: QueueLead[] }>(() => api.get('/api/v2/queue'), []);
  /* The gate belongs to the screen, not to one lead: the design puts its
     amber bar at the very top, above the count and the progress bar. */
  const gate = useCheckIn();
  const [at, setAt] = useState(0);
  const [done, setDone] = useState<Map<string, string>>(new Map());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [calls, setCalls] = useState(0);
  const [taps, setTaps] = useState(0);
  const [ending, setEnding] = useState(false);

  const items = queue.data?.items ?? [];
  const lead = items[at];

  if (queue.error) return <ErrorNote>{queue.error}</ErrorNote>;
  if (!queue.data) return <Spinner />;

  if (items.length === 0 || !lead) {
    return (
      <div className="p-calling v2-calling">
        <div className="d-card">
          <div className="d-empty">
            <span className="d-ic"><Icon name="check-check" size={26} /></span>
            <b>Nothing to call today</b>
            <p>Every follow-up you promised is done. Worth a look at your hot leads.</p>
            <Link className="d-btn d-sm" to="/v2/leads?tab=hot">See my hot leads</Link>
          </div>
        </div>
      </div>
    );
  }

  const last = at === items.length - 1;

  return (
    <div className="p-calling v2-calling">
      {gate.banner}

      <div className="d-topline">
        <span className="d-pos">Lead {at + 1} <span>of {items.length}</span></span>
        <div
          className="d-bar d-accent"
          style={{ '--v': `${Math.round((done.size / items.length) * 100)}%` } as CSSProperties}
        >
          <i />
        </div>
        <div className="d-counts">
          <span><b>{calls}</b> calls</span>
          <span><b>{taps}</b> WhatsApp</span>
          <span><b>{done.size}</b> results saved</span>
        </div>
        {/*
          * The design puts "+15 points per call" here. There is no such rule:
          * the one the wall really pays is two points for reaching somebody
          * (server/src/wall/xp.ts), so that is what the chip says. A made-up
          * figure on the screen an agent works all morning is worse than a
          * smaller true one.
          */}
        <span className="d-chip d-green">+2 points when you reach someone</span>
        <button type="button" className="d-btn d-sm" onClick={() => setEnding(true)}>End session</button>
      </div>

      <div className="d-call-grid">
        <div>
          <LeadCard
            key={lead.id}
            lead={lead}
            ask={gate.ask}
            saved={done.get(lead.id) ?? null}
            last={last}
            canGoBack={at > 0}
            nextName={items[at + 1]?.name ?? null}
            onCalled={() => setCalls((n) => n + 1)}
            onTapped={() => setTaps((n) => n + 1)}
            onSaved={(said) => {
              setDone((was) => new Map(was).set(lead.id, said));
              setSkipped((was) => {
                const next = new Set(was);
                next.delete(lead.id);
                return next;
              });
            }}
            onUndo={() => setDone((was) => {
              const next = new Map(was);
              next.delete(lead.id);
              return next;
            })}
            onNext={() => (last ? setEnding(true) : setAt((n) => n + 1))}
            onSkip={() => {
              if (!done.has(lead.id)) setSkipped((was) => new Set(was).add(lead.id));
              if (last) setEnding(true); else setAt((n) => n + 1);
            }}
            onPrev={() => setAt((n) => Math.max(0, n - 1))}
          />
        </div>

        <aside className="d-card d-q v2-queue">
          <div className="d-card-head v2-queue-head">
            <h3>Today&apos;s list</h3>
            <span className="d-small d-muted">VIP first</span>
          </div>
          <div>
            {items.map((row, i) => (
              <button
                key={row.id}
                type="button"
                className={
                  `d-qrow${i === at ? ' d-cur' : ''}`
                  + (done.has(row.id) ? ' d-done' : skipped.has(row.id) ? ' d-skip' : '')
                }
                onClick={() => setAt(i)}
              >
                <span className="d-n">{i + 1}</span>
                <span className="d-t">
                  <b>
                    {row.name ?? 'Unnamed lead'}
                    {row.isVip && <span className="d-vip-tag">VIP</span>}
                  </b>
                  <span>
                    {done.get(row.id) ?? (skipped.has(row.id) ? 'Skipped' : whyOf(row))}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>

      {ending && (
        <Summary
          calls={calls}
          taps={taps}
          saved={done.size}
          total={items.length}
          onKeepCalling={() => setEnding(false)}
        />
      )}
    </div>
  );
}

/** The line under a name in today's list: why this lead is on it. */
function whyOf(lead: QueueLead): string {
  if (lead.nextStepNote) return lead.nextStepNote;
  if (lead.noAnswerCount > 0) {
    return `No answer ${lead.noAnswerCount} ${lead.noAnswerCount === 1 ? 'time' : 'times'}`;
  }
  return lead.project ?? 'No project yet';
}

function LeadCard({
  lead, ask, saved, last, canGoBack, nextName,
  onCalled, onTapped, onSaved, onUndo, onNext, onSkip, onPrev,
}: {
  lead: QueueLead;
  ask: () => Promise<'checked_in' | 'outside' | 'anyway' | 'cancel'>;
  saved: string | null;
  last: boolean;
  canGoBack: boolean;
  nextName: string | null;
  onCalled: () => void;
  onTapped: () => void;
  onSaved: (said: string) => void;
  onUndo: () => void;
  onNext: () => void;
  onSkip: () => void;
  onPrev: () => void;
}) {
  const [callId, setCallId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [called, setCalled] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [day, setDay] = useState(() => tomorrow());
  const [time, setTime] = useState('11:00');
  const [alsoWhatsapp, setAlsoWhatsapp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Which field the agent has been told about. The design marks the field
     itself rather than printing a sentence under the button. */
  const [shown, setShown] = useState(false);

  const origin = originOf(lead.phone);
  const local = origin ? clockIn(origin.timeZone) : null;
  const advice = whenToCall(local, origin?.timeZone ?? null);

  /* A new lead is a clean slate: nothing from the last one may carry over. */
  useEffect(() => {
    setCallId(null); setTouched(false); setCalled(false); setOutcome(null); setNote('');
    setReason(null); setError(null); setShown(false); setAlsoWhatsapp(false);
    setDay(tomorrow()); setTime('11:00');
  }, [lead.id]);

  const call = useCallback(async () => {
    const answer = await ask();
    if (answer === 'cancel') return;
    try {
      const started = await api.post<{ id: string }>('/api/v2/calls', {
        opportunityId: lead.id,
        source: 'dialler',
        notCheckedIn: answer === 'anyway',
      });
      setCallId(started.id);
      setTouched(true);
      setCalled(true);
      onCalled();
      if (lead.phone) window.location.href = `tel:${lead.phone}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    }
  }, [ask, lead.id, lead.phone, onCalled]);

  const whatsapp = useCallback(async (text?: string) => {
    try {
      await api.post('/api/v2/taps', {
        opportunityId: lead.id,
        app: 'whatsapp',
        ...(text ? { text } : {}),
      });
      setTouched(true);
      onTapped();
      if (lead.phone) {
        const to = lead.phone.replace(/[^\d]/g, '');
        const query = text ? `?text=${encodeURIComponent(text)}` : '';
        window.open(`https://wa.me/${to}${query}`, '_blank', 'noreferrer');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    }
  }, [lead.id, lead.phone, onTapped]);

  const needsReason = outcome === 'not_interested';
  const needsWhy = outcome === 'call_back';
  const whenOk = !needsWhy || (Boolean(day) && new Date(`${day}T${time || '23:59'}`).getTime() > Date.now());
  const ready = outcome !== null
    && (!needsReason || reason !== null)
    && (!needsWhy || (note.trim().length >= 3 && whenOk));

  async function save() {
    if (!outcome) return;
    if (!ready) { setShown(true); return; }
    setSaving(true);
    setError(null);
    try {
      /*
       * WhatsApp-only outcomes have no call behind them. A call row is still
       * what carries the result, so one is opened and closed in the same
       * breath — the alternative is a second shape of record that every
       * report would then have to know about.
       */
      const id = callId ?? (await api.post<{ id: string }>('/api/v2/calls', {
        opportunityId: lead.id, source: 'dialler',
      })).id;

      const result = await api.patch<{ said: string }>(`/api/v2/calls/${id}`, {
        outcome,
        note: note.trim() || null,
        reason,
        callBackAt: outcome === 'call_back' ? new Date(`${day}T${time}`).toISOString() : null,
      });
      onSaved(result.said);

      /* The design's one tick-box: open WhatsApp afterwards with "I tried to
         call you" already typed. It is still a tap, not a sent message — the
         agent presses send in WhatsApp. */
      if (outcome === 'no_answer' && alsoWhatsapp) {
        const first = (lead.name ?? '').trim().split(/\s+/)[0];
        await whatsapp(
          `Hello${first ? ` ${first}` : ''}, I tried to call you`
          + `${lead.project ? ` about ${lead.project}` : ''}. When is a good time to talk?`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setSaving(false);
    }
  }

  const locked = !touched && !saved;

  return (
    <>
      <section className="d-card d-hero d-id-lead d-fade-in" aria-label="Lead">
        <div className="d-l">
          <div className="d-c-name">
            <span>{lead.name ?? 'Unnamed lead'}</span>
            {lead.isVip && <span className="d-vip-tag">VIP</span>}
            <span className="d-hero-chip">{STAGE_LABEL[lead.stage] ?? lead.stage}</span>
          </div>
          <a className="d-c-phone" href={lead.phone ? `tel:${lead.phone}` : undefined} dir="ltr">
            {spacedE164(lead.phone) ?? 'No number'}
          </a>
          <div className="d-c-meta">
            {origin && local && (
              <span>
                {flagOf(origin.iso2)} <b>{origin.name} {local.time}</b> local time
              </span>
            )}
            {lead.language && <span>Speaks <b>{lead.language}</b></span>}
          </div>
          {(lead.isVip || lead.scoreReason || (advice && !advice.ok)) && (
            <div className="d-c-why">
              <Icon name="zap" size={15} />
              <span>
                {lead.isVip ? 'VIP lead — the owner gave this one personally'
                  : advice && !advice.ok ? advice.line
                    : lead.scoreReason}
              </span>
            </div>
          )}

          <div className="d-c-btns">
            <button
              type="button"
              className={saved ? 'd-btn d-lg d-on-dark' : 'd-btn d-lg d-on-dark d-primary'}
              onClick={call}
            >
              <Icon name="phone" />Call
            </button>
            <button type="button" className="d-btn d-lg d-on-dark" onClick={() => void whatsapp()}>
              <Icon name="message-circle" />WhatsApp
            </button>
            <Link className="d-btn d-lg d-on-dark" to={`/v2/leads/${lead.id}`}>Open the lead</Link>
          </div>
          <span className="d-logged">
            {touched
              ? `${called ? 'Call' : 'WhatsApp'} tap logged. The message itself is sent by you, in WhatsApp.`
              : 'Every tap is logged'}
          </span>
        </div>

        <div className="d-r">
          <dl className="d-c-kv">
            <dt>Project</dt><dd>{lead.project ?? '—'}</dd>
            <dt>Budget</dt>
            <dd>
              {lead.budgetMinAed || lead.budgetMaxAed
                ? `${AED(lead.budgetMinAed)} – ${AED(lead.budgetMaxAed)}`
                : '—'}
            </dd>
            <dt>Wants</dt><dd>{lead.unitType ?? '—'}</dd>
            <dt>Tried</dt>
            <dd>{lead.noAnswerCount > 0 ? `${lead.noAnswerCount} times, no answer` : 'Not yet'}</dd>
          </dl>
          {/* The design writes the agent a script here. Nothing writes one, so
              the box carries what the agent themselves promised last time. */}
          <div className="d-say">
            <b>What you promised</b>
            <span>{lead.nextStepNote ?? 'Nothing written down for this one.'}</span>
          </div>
        </div>
      </section>

      <section
        className={`d-card d-id-out${locked ? ' d-locked' : ''}${saved ? ' d-saved' : ''}`}
        aria-label="Result"
      >
        <div className="d-card-head">
          <h3>What happened?</h3>
          <span className="d-lockmsg"><Icon name="lock" size={14} />Click Call or WhatsApp first</span>
        </div>

        <div className="d-outs">
          {OUTCOMES.map((one) => (
            <button
              key={one.key}
              type="button"
              disabled={locked || Boolean(saved)}
              className={outcome === one.key ? 'd-outb d-on' : 'd-outb'}
              onClick={() => { setOutcome(one.key); setReason(null); setShown(false); }}
            >
              <Icon name={one.icon} size={17} />{one.label}
            </button>
          ))}
        </div>

        {!saved && outcome === 'interested' && (
          <div className="d-sub d-on">
            <div className="d-row">
              <Icon name="star" size={15} />
              <span className="d-grow">
                The lead moves to <b>Interested</b>. Choose what happens next on the lead page.
              </span>
            </div>
            <NoteField note={note} setNote={setNote} />
          </div>
        )}

        {!saved && outcome === 'no_answer' && (
          <div className="d-sub d-on">
            <div className="d-row">
              <Icon name="refresh-cw" size={15} />
              <span className="d-grow">The lead comes back in your list in <b>2 hours</b>.</span>
            </div>
            <label className="d-check">
              <input
                type="checkbox"
                checked={alsoWhatsapp}
                onChange={(e) => setAlsoWhatsapp(e.target.checked)}
              />
              Also open WhatsApp with a short “I tried to call you” message
            </label>
            <NoteField note={note} setNote={setNote} />
          </div>
        )}

        {!saved && outcome === 'busy' && (
          <div className="d-sub d-on">
            <div className="d-row">
              <Icon name="refresh-cw" size={15} />
              <span className="d-grow">The lead comes back in your list in <b>1 hour</b>.</span>
            </div>
            <NoteField note={note} setNote={setNote} />
          </div>
        )}

        {!saved && outcome === 'call_back' && (
          <div className="d-sub d-on">
            <div className="d-form-grid v2-dial-when">
              <div className={shown && !whenOk ? 'd-field d-invalid' : 'd-field'}>
                <label htmlFor="v2-cb-date">Day</label>
                <input
                  id="v2-cb-date"
                  className="d-input"
                  type="date"
                  value={day}
                  min={today()}
                  onChange={(e) => { setDay(e.target.value); setShown(false); }}
                />
                <span className="d-error">Not in the past.</span>
              </div>
              <div className="d-field">
                <label htmlFor="v2-cb-time">Time</label>
                <input
                  id="v2-cb-time"
                  className="d-input"
                  type="time"
                  value={time}
                  onChange={(e) => { setTime(e.target.value); setShown(false); }}
                />
              </div>
              <div className={shown && note.trim().length < 3 ? 'd-field d-invalid' : 'd-field'}>
                <label htmlFor="v2-cb-why">Why <span className="d-req">*</span></label>
                <input
                  id="v2-cb-why"
                  className="d-input"
                  value={note}
                  placeholder="In a meeting, asked for the evening…"
                  onChange={(e) => { setNote(e.target.value); setShown(false); }}
                />
                <span className="d-error">Write why in a few words.</span>
              </div>
            </div>
          </div>
        )}

        {!saved && outcome === 'wrong_number' && (
          <div className="d-sub d-on">
            {/*
              * The design offers "I have the new number" here. Nothing takes a
              * replacement number from this screen, so it is left out rather
              * than drawn as a box that quietly throws the number away.
              */}
            <span className="d-small d-muted">
              The lead leaves your list. The owner sees “wrong number” on it.
            </span>
            <NoteField note={note} setNote={setNote} />
          </div>
        )}

        {!saved && outcome === 'not_interested' && (
          <div className="d-sub d-on">
            <div className={shown && !reason ? 'd-field d-invalid' : 'd-field'}>
              <span className="d-field-label">Reason <span className="d-t-accent">*</span></span>
              <div className="d-chips">
                {LOST_REASONS.map((one) => (
                  <button
                    key={one.key}
                    type="button"
                    className={reason === one.key ? 'd-chip-opt d-on' : 'd-chip-opt'}
                    onClick={() => { setReason(one.key); setShown(false); }}
                  >
                    {one.label}
                  </button>
                ))}
              </div>
              <span className="d-error">Choose a reason. The lead moves to Lost.</span>
            </div>
            <NoteField note={note} setNote={setNote} />
          </div>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className={outcome && !saved ? 'd-row d-mt-16 d-id-save-row' : 'd-row d-mt-16 d-id-save-row d-hide'}>
          <span className="d-small d-muted d-grow">{outcome ? CONSEQUENCE[outcome] : ''}</span>
          <button type="button" className="d-btn d-dark" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save result'}
          </button>
        </div>

        <div className="d-saved-box">
          <Icon name="check" size={16} />
          <span className="d-grow">
            {saved ? (saved.startsWith('Saved') ? saved : `Saved · ${saved}`) : ''}
          </span>
          <button type="button" className="d-btn d-xs" onClick={onUndo}>
            <Icon name="undo-2" size={13} />Undo
          </button>
        </div>

        <div className="d-navrow">
          <button
            type="button"
            className={canGoBack ? 'd-btn' : 'd-btn d-disabled'}
            disabled={!canGoBack}
            onClick={onPrev}
          >
            <Icon name="arrow-left" size={15} />Previous
          </button>
          <span className="d-grow d-small d-muted d-center">
            {saved
              ? (last ? 'That was the last lead.' : `Next: ${nextName ?? 'the next lead'}`)
              : touched ? 'Choose what happened, then save.'
                : 'Save a result before Next, or skip this lead.'}
          </span>
          <button type="button" className="d-btn d-ghost" onClick={onSkip}>Skip</button>
          <button
            type="button"
            className={saved ? 'd-btn d-primary' : 'd-btn d-disabled'}
            disabled={!saved}
            onClick={onNext}
          >
            {last ? 'Finish' : 'Next lead'}<Icon name="arrow-right" size={15} />
          </button>
        </div>
      </section>
    </>
  );
}

/** One line of free text, offered under every outcome the design allows it. */
function NoteField({ note, setNote }: { note: string; setNote: (value: string) => void }) {
  return (
    <div className="d-field">
      <label htmlFor="v2-dial-note">Note <span className="d-muted">· optional</span></label>
      <input
        id="v2-dial-note"
        className="d-input"
        value={note}
        placeholder="Anything worth remembering"
        onChange={(e) => setNote(e.target.value)}
      />
    </div>
  );
}

/**
 * The end-of-session dialog.
 *
 * The design finishes it with "+N points". Nothing on this screen can know
 * what the wall awarded — the rules are capped per day and counted server
 * side — so the banner says what was actually done instead.
 */
function Summary({ calls, taps, saved, total, onKeepCalling }: {
  calls: number; taps: number; saved: number; total: number; onKeepCalling: () => void;
}) {
  const left = total - saved;
  return (
    <>
      <div className="d-scrim d-show" onClick={onKeepCalling} aria-hidden />
      <div className="d-dialog d-open" role="dialog" aria-label="Session summary">
        <div className="d-dialog-head">
          <div className="d-grow">
            <h3>Good work</h3>
            <p>{saved} of {total} leads have a result</p>
          </div>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onKeepCalling}>
            <Icon name="x" />
          </button>
        </div>
        <div className="d-dialog-body">
          <div className="d-sumgrid">
            <div><b>{calls}</b><span>Calls</span></div>
            <div><b>{taps}</b><span>WhatsApps</span></div>
            <div><b>{saved}</b><span>Results saved</span></div>
          </div>
          <div className="d-banner d-green">
            <Icon name="trophy" />
            <span className="d-grow">
              {left === 0
                ? 'Today’s list is done. Well done.'
                : `${left} lead${left === 1 ? '' : 's'} still in today’s list. They stay there.`}
            </span>
          </div>
        </div>
        <div className="d-dialog-foot">
          <button type="button" className="d-btn d-ghost" onClick={onKeepCalling}>Keep calling</button>
          <Link className="d-btn d-primary" to="/v2">Back to My Day</Link>
        </div>
      </div>
    </>
  );
}

/** Local wall-clock dates for the two date inputs — never an ISO string. */
function today(): string {
  return dayOf(new Date());
}

function tomorrow(): string {
  return dayOf(new Date(Date.now() + 86_400_000));
}

function dayOf(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}
