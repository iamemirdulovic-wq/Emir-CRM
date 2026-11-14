import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';
import { clockIn, flagOf, originOf, whenToCall } from '../lib/dialling.js';
import { spacedE164 } from '../design/phone.js';
import { useCheckIn } from './check-in.js';
import { useFullAttention, usePhoneHead } from './phone.js';

/**
 * Calling: one lead at a time, until the list is done.
 *
 * Two layouts, one set of rules.
 *
 *  - **The computer** is `design/web/calling.html` — the topline with the
 *    progress bar and the three counts, the dark lead card with the phone
 *    number set at fifty pixels, the six outcome tiles, and today's list down
 *    the right-hand side.
 *  - **The phone** is `design/screens/Dialer.dc.html`, and it is a different
 *    screen rather than the same one made narrow: it has to fit on **one
 *    390px screen with nothing to scroll** (the owner's §6.1, 14 Nov). So the
 *    shell's header and bottom bar go away (`useFullAttention`), the screen
 *    is a fixed full-height column, and the two things that used to push it
 *    past the fold — today's list and End session — move into a sheet behind
 *    a small button in the header.
 *
 * The rule that shapes both: **an outcome cannot be set before the agent has
 * pressed Call or WhatsApp.** The CRM has no way of knowing whether a call
 * happened, so the only honest sequence is tap first, then say what happened —
 * a result recorded without a tap is a figure nobody should trust afterwards.
 * The computer draws that as a greyed panel with an amber padlock; the phone
 * draws it as the design does, by answering the tap with a line in the card
 * head rather than by greying six buttons the thumb will try anyway.
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

/**
 * The phone's own colour for each of the six.
 *
 * `Dialer.dc.html` gives them six tints and no icons — green for Interested,
 * grey for the two that are nobody's fault, blue for Call back, red for a
 * wrong number and the accent for Not interested. The icons go because at
 * 390px six tiles across two rows have room for the word or the picture, and
 * the word is the one an agent reads.
 */
const OUTCOME_TONE: Record<Outcome, string> = {
  interested: 'v2-a-dial-ok',
  no_answer: 'v2-a-dial-flat',
  busy: 'v2-a-dial-flat',
  call_back: 'v2-a-dial-later',
  wrong_number: 'v2-a-dial-bad',
  not_interested: 'v2-a-dial-no',
};

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

/** §4 of `docs/v2/phone-shell.md`: under this, the phone layout. */
const PHONE = 768;

/**
 * Whether this is a phone, in the component rather than only in CSS.
 *
 * The phone dialler is a different screen, not a narrower one: it has its own
 * header, its own order and a fixed bottom bar, and the shell's header is
 * taken away under it. None of that can be done from a media query.
 */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width:${PHONE - 1}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${PHONE - 1}px)`);
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

/** The sheet's own title and sub-line, one per outcome — the design's words. */
const SHEET_HEAD: Record<Outcome, { title: string; sub: string; icon: IconName }> = {
  interested: { title: 'Interested', sub: 'Great! Set the next step now', icon: 'star' },
  no_answer: { title: 'No answer', sub: 'A reminder is set for you', icon: 'phone' },
  busy: { title: 'Busy', sub: 'A reminder is set for you', icon: 'clock' },
  call_back: { title: 'Call back', sub: 'When should you call again?', icon: 'calendar-days' },
  wrong_number: { title: 'Wrong number', sub: 'It is flagged for the owner', icon: 'alert-triangle' },
  not_interested: { title: 'Not interested', sub: 'Pick a reason · the lead goes to Lost', icon: 'x' },
};

export function V2Calling() {
  const queue = useAsync<{ items: QueueLead[] }>(() => api.get('/api/v2/queue'), []);
  /* The gate belongs to the screen, not to one lead: the design puts its
     amber bar at the very top, above the count and the progress bar. */
  const gate = useCheckIn();
  const navigate = useNavigate();
  const [at, setAt] = useState(0);
  const [done, setDone] = useState<Map<string, string>>(new Map());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [calls, setCalls] = useState(0);
  const [taps, setTaps] = useState(0);
  const [ending, setEnding] = useState(false);
  /* The phone's one sheet: today's list, the counters and End session. */
  const [listOpen, setListOpen] = useState(false);

  const phone = useIsPhone();
  /*
   * §6.1: the whole dialler on one screen. The shell's header costs 100px of
   * it, and the design draws no header here at all — a close button, the
   * count and the progress bar are the header. `useFullAttention` is what the
   * inbox already uses to say "this screen is the whole job".
   */
  useFullAttention(phone);

  const items = queue.data?.items ?? [];
  const lead = items[at];

  /*
   * `Dialer.dc.html` has no app bar: a close arrow, a two-line title —
   * "POWER DIALLER · 11 LEFT AFTER THIS" over "Lead 1 of 12" — and a points
   * pill. On a computer the shell still draws the title, so it is handed both
   * rather than drawing a second `<h1>` under the first one.
   */
  const left = Math.max(0, items.length - at - 1);
  usePhoneHead({
    title: items.length > 0 ? `Lead ${at + 1} of ${items.length}` : 'Calling',
    sub: items.length > 0
      ? `Power dialler · ${left === 0 ? 'last one' : `${left} left after this`}`
      : 'Nothing in the queue',
  });

  if (queue.error) return <ErrorNote>{queue.error}</ErrorNote>;
  if (!queue.data) return <Spinner />;

  const close = () => navigate('/v2');

  if (items.length === 0 || !lead) {
    const empty = (
      <div className="d-card">
        <div className="d-empty">
          <span className="d-ic"><Icon name="check-check" size={26} /></span>
          <b>Nothing to call today</b>
          <p>Every follow-up you promised is done. Worth a look at your hot leads.</p>
          <Link className="d-btn d-sm" to="/v2/leads?tab=hot">See my hot leads</Link>
        </div>
      </div>
    );
    if (!phone) return <div className="p-calling v2-calling">{empty}</div>;
    return (
      <div className="v2-a-dial v2-a-dial-empty p-calling">
        <header className="v2-a-dial-top">
          <button type="button" className="v2-a-dial-x" aria-label="Close" onClick={close}>
            <Icon name="x" />
          </button>
          <div className="v2-a-dial-head">
            <span className="v2-a-dial-kicker">POWER DIALLER</span>
            <span className="v2-a-dial-big">Nothing to call</span>
          </div>
        </header>
        {empty}
      </div>
    );
  }

  const last = at === items.length - 1;

  const onSaved = (said: string) => {
    setDone((was) => new Map(was).set(lead.id, said));
    setSkipped((was) => {
      const next = new Set(was);
      next.delete(lead.id);
      return next;
    });
  };
  const onUndo = () => setDone((was) => {
    const next = new Map(was);
    next.delete(lead.id);
    return next;
  });
  const onNext = () => (last ? setEnding(true) : setAt((n) => n + 1));
  const onSkip = () => {
    if (!done.has(lead.id)) setSkipped((was) => new Set(was).add(lead.id));
    if (last) setEnding(true); else setAt((n) => n + 1);
  };

  const summary = ending && (
    <Summary
      calls={calls}
      taps={taps}
      saved={done.size}
      total={items.length}
      onKeepCalling={() => setEnding(false)}
    />
  );

  /* ── the phone: one screen, nothing to scroll ───────────────────────── */
  if (phone) {
    return (
      <div className="v2-a-dial p-calling">
        <header className="v2-a-dial-top">
          <button type="button" className="v2-a-dial-x" aria-label="Close the dialler" onClick={close}>
            <Icon name="x" />
          </button>
          <div className="v2-a-dial-head">
            <span className="v2-a-dial-kicker">
              POWER DIALLER · {left === 0 ? 'LAST ONE' : `${left} LEFT AFTER THIS`}
            </span>
            <span className="v2-a-dial-big">Lead {at + 1} of {items.length}</span>
          </div>
          {/* The wall pays two points for reaching somebody and nothing for
              dialling — `server/src/wall/xp.ts`. The design's "+15 points per
              call" is not a rule this CRM has. */}
          <span className="v2-a-dial-points">
            <Icon name="zap" size={13} />+2 if they answer
          </span>
          <button
            type="button"
            className="v2-a-dial-list"
            aria-label="Today's list"
            onClick={() => setListOpen(true)}
          >
            <Icon name="list" />
          </button>
        </header>

        <div
          className="v2-a-dial-bar"
          style={{ '--v': `${Math.round(((at + 1) / items.length) * 100)}%` } as CSSProperties}
        >
          <i />
        </div>

        {gate.banner}

        <PhoneLead
          key={lead.id}
          lead={lead}
          ask={gate.ask}
          saved={done.get(lead.id) ?? null}
          last={last}
          canGoBack={at > 0}
          onCalled={() => setCalls((n) => n + 1)}
          onTapped={() => setTaps((n) => n + 1)}
          onSaved={onSaved}
          onUndo={onUndo}
          onNext={onNext}
          onSkip={onSkip}
          onPrev={() => setAt((n) => Math.max(0, n - 1))}
        />

        {listOpen && (
          <>
            <div className="d-scrim d-show" onClick={() => setListOpen(false)} aria-hidden />
            <div className="d-dialog d-open" role="dialog" aria-label="Today's list">
              <div className="d-dialog-head">
                <div className="d-grow">
                  <h3>Today&apos;s list</h3>
                  <p>VIP first · {done.size} of {items.length} done</p>
                </div>
                <button
                  type="button"
                  className="d-btn d-icon d-sm d-ghost"
                  aria-label="Close"
                  onClick={() => setListOpen(false)}
                >
                  <Icon name="x" />
                </button>
              </div>
              <div className="d-dialog-body">
                <div className="d-sumgrid">
                  <div><b>{calls}</b><span>Calls</span></div>
                  <div><b>{taps}</b><span>WhatsApps</span></div>
                  <div><b>{done.size}</b><span>Results saved</span></div>
                </div>
                <QueueRows
                  items={items}
                  at={at}
                  done={done}
                  skipped={skipped}
                  onPick={(i) => { setAt(i); setListOpen(false); }}
                />
              </div>
              <div className="d-dialog-foot">
                <button
                  type="button"
                  className="d-btn d-primary"
                  onClick={() => { setListOpen(false); setEnding(true); }}
                >
                  End session
                </button>
              </div>
            </div>
          </>
        )}

        {summary}
      </div>
    );
  }

  /* ── the computer: `design/web/calling.html`, unchanged ─────────────── */
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
            onSaved={onSaved}
            onUndo={onUndo}
            onNext={onNext}
            onSkip={onSkip}
            onPrev={() => setAt((n) => Math.max(0, n - 1))}
          />
        </div>

        <aside className="d-card d-q v2-queue">
          <div className="d-card-head v2-queue-head">
            <h3>Today&apos;s list</h3>
            <span className="d-small d-muted">VIP first</span>
          </div>
          <div>
            <QueueRows items={items} at={at} done={done} skipped={skipped} onPick={setAt} />
          </div>
        </aside>
      </div>

      {summary}
    </div>
  );
}

/** Today's list, the same rows on the computer and inside the phone's sheet. */
function QueueRows({ items, at, done, skipped, onPick }: {
  items: QueueLead[];
  at: number;
  done: Map<string, string>;
  skipped: Set<string>;
  onPick: (i: number) => void;
}) {
  return (
    <>
      {items.map((row, i) => (
        <button
          key={row.id}
          type="button"
          className={
            `d-qrow${i === at ? ' d-cur' : ''}`
            + (done.has(row.id) ? ' d-done' : skipped.has(row.id) ? ' d-skip' : '')
          }
          onClick={() => onPick(i)}
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
    </>
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

/**
 * Why this one is in front of you, in a few words.
 *
 * The design's pill reads "VIP from Emir · call first". Everything here comes
 * off the record: whether it is a VIP, what the agent promised and when, how
 * many times it has rung out, and the clock where the lead is. Nothing is
 * composed out of nothing — a lead with none of those says "First call",
 * which is what it is.
 */
function whyNow(lead: QueueLead, advice: { ok: boolean; line: string } | null): string {
  if (lead.isVip) return 'VIP · call first';
  if (lead.nextStepAt) {
    const when = new Date(lead.nextStepAt);
    if (when.getTime() < Date.now()) {
      return `Overdue · promised ${new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai',
      }).format(when)}`;
    }
  }
  if (advice && !advice.ok) return advice.line;
  if (lead.noAnswerCount > 0) {
    return `No answer ${lead.noAnswerCount} ${lead.noAnswerCount === 1 ? 'time' : 'times'}`;
  }
  if (lead.nextStepNote) return lead.nextStepNote;
  if (lead.scoreReason) return lead.scoreReason;
  return 'First call';
}

/* ── the work on one lead, shared by both layouts ────────────────────────── */

interface LeadWork {
  touched: boolean;
  called: boolean;
  outcome: Outcome | null;
  needTouch: boolean;
  note: string;
  setNote: (value: string) => void;
  reason: string | null;
  day: string;
  time: string;
  alsoWhatsapp: boolean;
  setAlsoWhatsapp: (value: boolean) => void;
  saving: boolean;
  error: string | null;
  shown: boolean;
  whenOk: boolean;
  ready: boolean;
  locked: boolean;
  pick: (outcome: Outcome) => void;
  clear: () => void;
  setReason: (value: string) => void;
  setDay: (value: string) => void;
  setTime: (value: string) => void;
  call: () => Promise<void>;
  whatsapp: (text?: string) => Promise<void>;
  save: () => Promise<void>;
}

function useLeadWork({ lead, ask, saved, onCalled, onTapped, onSaved }: {
  lead: QueueLead;
  ask: () => Promise<'checked_in' | 'outside' | 'anyway' | 'cancel'>;
  saved: string | null;
  onCalled: () => void;
  onTapped: () => void;
  onSaved: (said: string) => void;
}): LeadWork {
  const [callId, setCallId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [called, setCalled] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [needTouch, setNeedTouch] = useState(false);
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

  /* A new lead is a clean slate: nothing from the last one may carry over. */
  useEffect(() => {
    setCallId(null); setTouched(false); setCalled(false); setOutcome(null); setNote('');
    setReason(null); setError(null); setShown(false); setAlsoWhatsapp(false);
    setNeedTouch(false); setDay(tomorrow()); setTime('11:00');
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
      setNeedTouch(false);
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
      setNeedTouch(false);
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

  const locked = !touched && !saved;

  const save = useCallback(async () => {
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
  }, [
    alsoWhatsapp, callId, day, lead.id, lead.name, lead.project, note, onSaved, outcome,
    ready, reason, time, whatsapp,
  ]);

  return {
    touched, called, outcome, needTouch, note, setNote, reason, day, time,
    alsoWhatsapp, setAlsoWhatsapp, saving, error, shown, whenOk, ready, locked,
    /*
     * The one rule, in one place. On the computer the six tiles are disabled
     * and this is never reached; on the phone they are not, because a thumb
     * will press a greyed tile anyway and deserves to be told why.
     */
    pick: (next: Outcome) => {
      if (locked) { setNeedTouch(true); return; }
      setNeedTouch(false);
      setOutcome(next);
      setReason(null);
      setShown(false);
    },
    clear: () => setOutcome(null),
    setReason: (value: string) => { setReason(value); setShown(false); },
    setDay: (value: string) => { setDay(value); setShown(false); },
    setTime: (value: string) => { setTime(value); setShown(false); },
    call,
    whatsapp,
    save,
  };
}

/**
 * The outcome's own questions.
 *
 * One shape, two containers: `Dialer.dc.html` puts them in a bottom sheet with
 * a coloured mark, a title and a sub-line, while the computer design opens
 * them inside the card. `docs/v2/phone-shell.md` §5.7 is explicit — "build the
 * body of each flow as a shared piece, and let the shell decide sheet vs
 * panel". This is that shared piece.
 */
function OutcomeForm({ work }: { work: LeadWork }) {
  const { outcome, note, setNote, reason, shown, whenOk, day, time } = work;
  if (outcome === 'interested') {
    return (
      <>
        <div className="d-row">
          <Icon name="star" size={15} />
          <span className="d-grow">
            The lead moves to <b>Interested</b>. Choose what happens next on the lead page.
          </span>
        </div>
        <NoteField note={note} setNote={setNote} />
      </>
    );
  }
  if (outcome === 'no_answer') {
    return (
      <>
        <div className="d-row">
          <Icon name="refresh-cw" size={15} />
          <span className="d-grow">The lead comes back in your list in <b>2 hours</b>.</span>
        </div>
        <label className="d-check">
          <input
            type="checkbox"
            checked={work.alsoWhatsapp}
            onChange={(e) => work.setAlsoWhatsapp(e.target.checked)}
          />
          Also open WhatsApp with a short “I tried to call you” message
        </label>
        <NoteField note={note} setNote={setNote} />
      </>
    );
  }
  if (outcome === 'busy') {
    return (
      <>
        <div className="d-row">
          <Icon name="refresh-cw" size={15} />
          <span className="d-grow">The lead comes back in your list in <b>1 hour</b>.</span>
        </div>
        <NoteField note={note} setNote={setNote} />
      </>
    );
  }
  if (outcome === 'call_back') {
    return (
      <div className="d-form-grid v2-dial-when">
        <div className={shown && !whenOk ? 'd-field d-invalid' : 'd-field'}>
          <label htmlFor="v2-cb-date">Day</label>
          <input
            id="v2-cb-date"
            className="d-input"
            type="date"
            value={day}
            min={today()}
            onChange={(e) => work.setDay(e.target.value)}
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
            onChange={(e) => work.setTime(e.target.value)}
          />
        </div>
        <div className={shown && note.trim().length < 3 ? 'd-field d-invalid' : 'd-field'}>
          <label htmlFor="v2-cb-why">Why <span className="d-req">*</span></label>
          <input
            id="v2-cb-why"
            className="d-input"
            value={note}
            placeholder="In a meeting, asked for the evening…"
            onChange={(e) => setNote(e.target.value)}
          />
          <span className="d-error">Write why in a few words.</span>
        </div>
      </div>
    );
  }
  if (outcome === 'wrong_number') {
    return (
      <>
        {/*
          * The design offers "I have the new number" here. Nothing takes a
          * replacement number from this screen, so it is left out rather
          * than drawn as a box that quietly throws the number away.
          */}
        <span className="d-small d-muted">
          The lead leaves your list. The owner sees “wrong number” on it.
        </span>
        <NoteField note={note} setNote={setNote} />
      </>
    );
  }
  if (outcome === 'not_interested') {
    return (
      <>
        <div className={shown && !reason ? 'd-field d-invalid' : 'd-field'}>
          <span className="d-field-label">Reason <span className="d-t-accent">*</span></span>
          <div className="d-chips">
            {LOST_REASONS.map((one) => (
              <button
                key={one.key}
                type="button"
                className={reason === one.key ? 'd-chip-opt d-on' : 'd-chip-opt'}
                onClick={() => work.setReason(one.key)}
              >
                {one.label}
              </button>
            ))}
          </div>
          <span className="d-error">Choose a reason. The lead moves to Lost.</span>
        </div>
        <NoteField note={note} setNote={setNote} />
      </>
    );
  }
  return null;
}

/** The sheet the phone opens once an outcome is chosen. */
function OutcomeSheet({ work, onClose }: { work: LeadWork; onClose: () => void }) {
  const { outcome } = work;
  if (!outcome) return null;
  const head = SHEET_HEAD[outcome];
  return (
    <>
      <div className="d-scrim d-show" onClick={onClose} aria-hidden />
      <div className="d-dialog d-open" role="dialog" aria-label={head.title}>
        <div className="v2-b-out-head">
          <span className="v2-b-out-ic"><Icon name={head.icon} /></span>
          <div className="d-grow">
            <h3>{head.title}</h3>
            <p>{head.sub}</p>
          </div>
          <button
            type="button"
            className="d-btn d-icon d-sm d-ghost"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="d-dialog-body d-col d-gap-8">
          <OutcomeForm work={work} />
          {work.error && <ErrorNote>{work.error}</ErrorNote>}
          <p className="d-small d-muted">{CONSEQUENCE[outcome]}</p>
        </div>
        <div className="d-dialog-foot">
          <button
            type="button"
            className="d-btn d-primary"
            disabled={work.saving}
            onClick={() => void work.save()}
          >
            {work.saving ? 'Saving…' : `Save · ${head.title}`}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── the phone screen ────────────────────────────────────────────────────── */

/**
 * Everything below the progress bar on a phone, in the design's order: the
 * lead card, the two big buttons, "How did it go?" and the fixed bottom bar.
 *
 * Nothing scrolls. The card is the one element allowed to give way, on a
 * phone shorter than the 844px the design is drawn at.
 */
function PhoneLead({
  lead, ask, saved, last, canGoBack,
  onCalled, onTapped, onSaved, onUndo, onNext, onSkip, onPrev,
}: {
  lead: QueueLead;
  ask: () => Promise<'checked_in' | 'outside' | 'anyway' | 'cancel'>;
  saved: string | null;
  last: boolean;
  canGoBack: boolean;
  onCalled: () => void;
  onTapped: () => void;
  onSaved: (said: string) => void;
  onUndo: () => void;
  onNext: () => void;
  onSkip: () => void;
  onPrev: () => void;
}) {
  const work = useLeadWork({ lead, ask, saved, onCalled, onTapped, onSaved });
  const { user } = useAuth();
  /* The brand on the opener. Everyone signed in may read it; when the company
     has not been filled in yet it is the brand this CRM is, not a guess. */
  const company = useAsync<{ company: { legalName?: string; tradingName?: string } }>(
    () => api.get('/api/company'),
    [],
  );

  const origin = originOf(lead.phone);
  const local = origin ? clockIn(origin.timeZone) : null;
  const advice = whenToCall(local, origin?.timeZone ?? null);

  const number = spacedE164(lead.phone);
  const budget = lead.budgetMinAed || lead.budgetMaxAed
    ? (lead.budgetMinAed && lead.budgetMaxAed && lead.budgetMinAed !== lead.budgetMaxAed
      ? `${AED(lead.budgetMinAed)} – ${AED(lead.budgetMaxAed)}`
      : AED(lead.budgetMaxAed ?? lead.budgetMinAed))
    : 'Not known';

  return (
    <>
      <section className="v2-a-dial-card" aria-label="Lead">
        {/* The size is the stylesheet's, so a short phone can shrink it. */}
        <Avatar name={lead.name} />
        <div className="v2-a-dial-who">
          <h2 className="v2-a-dial-name">
            {lead.name ?? 'Unnamed lead'}
            {lead.isVip && <span className="d-vip-tag">VIP</span>}
          </h2>
          <p className="v2-a-dial-phone" dir="ltr">
            {number ?? 'No number'}
            {origin && <> · {flagOf(origin.iso2)} {origin.name}</>}
          </p>
        </div>

        <div className="v2-a-dial-pills">
          {local && (
            <span className="v2-a-dial-pill">
              <Icon name="clock-3" size={13} />{local.time} there
            </span>
          )}
          <span className="v2-a-dial-pill v2-a-dial-pill-why">{whyNow(lead, advice)}</span>
        </div>

        <div className="v2-a-dial-facts">
          <div><span>Project</span><b>{lead.project ?? 'Not known'}</b></div>
          <div><span>Budget</span><b>{budget}</b></div>
          <div><span>Wants</span><b>{lead.unitType ?? 'Not known'}</b></div>
        </div>

        {/*
          * The design's "Say:" line. It is built from this record and nothing
          * else — their first name, the agent signed in, the company and the
          * project they asked about. No figure, no promise and no fact that
          * is not already on the lead goes into it.
          */}
        <p className="v2-a-dial-say">
          <Icon name="sparkles" size={16} />
          <span>
            <b>Say:</b>{' '}
            “{opener(lead, user?.name ?? null, brandOf(company.data?.company))}”
          </span>
        </p>
      </section>

      <div className="v2-a-dial-acts">
        <button type="button" className="v2-a-dial-call" onClick={() => void work.call()}>
          <Icon name="phone" size={21} />Call
        </button>
        <button type="button" className="v2-a-dial-wa" onClick={() => void work.whatsapp()}>
          <Icon name="message-circle" size={21} />WhatsApp
        </button>
      </div>

      <section className="v2-a-dial-out" aria-label="Result">
        <div className="v2-a-dial-out-head">
          {saved
            ? (
              <>
                <span className="v2-a-dial-done">
                  <Icon name="check" size={15} />
                  {saved.startsWith('Saved') ? saved : `Saved · ${saved}`}
                </span>
                <button type="button" className="v2-a-dial-undo" onClick={onUndo}>Undo</button>
              </>
            )
            : work.needTouch
              ? (
                <span className="v2-a-dial-warn">
                  <Icon name="lock" size={14} />Tap Call or WhatsApp first
                </span>
              )
              : <h3>How did it go?</h3>}
        </div>

        <div className="v2-a-dial-outs">
          {OUTCOMES.map((one) => (
            <button
              key={one.key}
              type="button"
              disabled={Boolean(saved)}
              className={
                `v2-a-dial-outb ${OUTCOME_TONE[one.key]}`
                + (work.outcome === one.key ? ' v2-a-dial-on' : '')
              }
              onClick={() => work.pick(one.key)}
            >
              {one.label}
            </button>
          ))}
        </div>
      </section>

      <nav className="v2-a-dial-nav" aria-label="Move through the list">
        <button
          type="button"
          className="v2-a-dial-prev"
          aria-label="The lead before this one"
          disabled={!canGoBack}
          onClick={onPrev}
        >
          <Icon name="chevron-left" size={19} />
        </button>
        <button type="button" className="v2-a-dial-skip" onClick={onSkip}>
          <Icon name="play" size={15} />Skip
        </button>
        <button
          type="button"
          className="v2-a-dial-next"
          disabled={!saved}
          onClick={onNext}
        >
          {last ? 'Finish' : 'Next lead'}<Icon name="chevron-right" size={19} />
        </button>
      </nav>

      {!saved && work.outcome && <OutcomeSheet work={work} onClose={work.clear} />}
    </>
  );
}

/** The trading name, or the brand this CRM is when nobody has filled one in. */
function brandOf(company: { legalName?: string; tradingName?: string } | undefined): string {
  return company?.tradingName?.trim() || company?.legalName?.trim() || 'homes.me';
}

/**
 * The opener the agent reads out, out of this lead's own facts.
 *
 * "Hi Khalid, this is Rocky from homes.me about The Archive." Every part of it
 * is on the record already: their first name, the agent signed in, the company
 * and the project they asked about. When a part is missing it is left out of
 * the sentence rather than filled with something plausible.
 */
function opener(lead: QueueLead, me: string | null, company: string): string {
  const first = (lead.name ?? '').trim().split(/\s+/)[0];
  const mine = (me ?? '').trim().split(/\s+/)[0];
  return [
    `Hi${first ? ` ${first}` : ''},`,
    mine ? ` this is ${mine} from ${company}` : ` this is ${company}`,
    lead.project ? ` about ${lead.project}.` : '.',
  ].join('');
}

/* ── the computer screen ─────────────────────────────────────────────────── */

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
  const work = useLeadWork({ lead, ask, saved, onCalled, onTapped, onSaved });

  const origin = originOf(lead.phone);
  const local = origin ? clockIn(origin.timeZone) : null;
  const advice = whenToCall(local, origin?.timeZone ?? null);

  const { outcome, locked, touched, called } = work;

  const saveRow = (
    <div className={outcome && !saved ? 'd-row d-mt-16 d-id-save-row' : 'd-row d-mt-16 d-id-save-row d-hide'}>
      <span className="d-small d-muted d-grow">{outcome ? CONSEQUENCE[outcome] : ''}</span>
      <button
        type="button"
        className="d-btn d-dark"
        disabled={work.saving}
        onClick={() => void work.save()}
      >
        {work.saving ? 'Saving…' : 'Save result'}
      </button>
    </div>
  );

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
              onClick={() => void work.call()}
            >
              <Icon name="phone" />Call
            </button>
            <button
              type="button"
              className="d-btn d-lg d-on-dark"
              onClick={() => void work.whatsapp()}
            >
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
              onClick={() => work.pick(one.key)}
            >
              <Icon name={one.icon} size={17} />{one.label}
            </button>
          ))}
        </div>

        {!saved && outcome && <div className="d-sub d-on"><OutcomeForm work={work} /></div>}

        {work.error && <ErrorNote>{work.error}</ErrorNote>}

        {saveRow}


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
