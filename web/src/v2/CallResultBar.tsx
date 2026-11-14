import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon, type IconName } from '../design/index.js';
import { formatTime } from '../lib/format.js';
import { civil } from '../lib/calendar.js';
import type { CallActions, CallableLead } from './call.js';
import {
  CALL_RESULTS, RESULT_LABEL, plain,
  type CallResult, type NoAnswerState,
} from './call-result.js';
import '../styles/v2-lead-notes.css';

/**
 * "What happened?" — one row of six results, above the note box.
 *
 * ── Why it exists ──────────────────────────────────────────────────────────
 *
 * The CRM hands the call over to the phone and the message over to WhatsApp,
 * and then cannot see what happened next. Until now the only place an agent
 * could say was the power dialler, so a call made from the lead page or the
 * quick panel was recorded as *a call was started* and never as *this is what
 * came of it*. The owner's §D: one row of buttons, always visible, one tap,
 * saved with the date and the time.
 *
 * ── The one asker ─────────────────────────────────────────────────────────
 *
 * This bar replaces the blue "WhatsApp opened · waiting for your update" line
 * that sat at the top of the lead page's middle column with its own "What
 * happened?" button. Two things asking the same question on one screen is
 * worse than one, so the tap question folded into here: after a tap on Call
 * **or** on WhatsApp the bar highlights and its heading names what was tapped
 * and when, and the answer is written to both records — the call result
 * through the new endpoint, and the tap's own outcome through
 * `PATCH /api/v2/taps/:id`, which has been waiting for an answer since the
 * calling screen was built.
 *
 * ── What it never does ────────────────────────────────────────────────────
 *
 * It never sends anything to a client. `whatsapp.text` is the approved "I
 * tried to call you" message in the client's language; pressing the black
 * pill opens WhatsApp with it typed in and **the agent presses send**. That
 * is the rule the whole figure depends on.
 *
 * It never invents a number. "try 2 of 5" is printed only from what the
 * endpoint answered with; a run it knows nothing about shows no count.
 */

/** The six results, with the tint and the line icon each one wears. */
const PILLS: Record<CallResult, { icon: IconName; tone: string }> = {
  answered: { icon: 'check', tone: 'v2-ln-pill-green' },
  no_answer: { icon: 'phone-off', tone: 'v2-ln-pill-grey' },
  busy: { icon: 'clock', tone: 'v2-ln-pill-grey' },
  call_back: { icon: 'calendar-days', tone: 'v2-ln-pill-blue' },
  wrong_number: { icon: 'alert-triangle', tone: 'v2-ln-pill-red' },
  not_interested: { icon: 'x', tone: 'v2-ln-pill-red' },
};

/**
 * What the agent just tapped, so the heading can say so.
 *
 * `at` is when they tapped it, not when they answered: "You tapped Call at
 * 16:40" is the sentence, and a clock read at answer time would say 16:48.
 */
export interface Asking {
  what: 'call' | 'whatsapp' | 'telegram';
  /** An ISO moment. */
  at: string;
  /** The row `POST /api/v2/taps` wrote, for a message rather than a call. */
  tapId?: string | null;
}

/**
 * A tap outcome the message record can hold, from a call result.
 *
 * `message_taps` has six outcomes of its own and they are a coarser question
 * — did the message go, and did they answer — so the six results map onto
 * them rather than the other way round. Nothing is invented: `answered`,
 * `call_back` and `not_interested` all mean the client said something, which
 * is `replied`; `no_answer` and `busy` mean they did not.
 */
const TAP_OUTCOME: Record<CallResult, string> = {
  answered: 'replied',
  call_back: 'replied',
  not_interested: 'replied',
  no_answer: 'no_reply',
  busy: 'no_reply',
  wrong_number: 'wrong_number',
};

export function CallResultBar({
  opportunityId, lead, state, asking, dial, compact = false,
  onSaved, onAnswered, onDismiss, onGiveUp,
}: {
  opportunityId: string;
  /** The lead itself, for the "I tried to call you" hand-off. */
  lead: CallableLead;
  /** The run as the record holds it, or null when nothing is known yet. */
  state: NoAnswerState | null;
  /** Set after a Call or WhatsApp tap; null when nothing is pending. */
  asking: Asking | null;
  dial: CallActions;
  /** The quick panel and the phone: a tighter row, same buttons. */
  compact?: boolean;
  /**
   * A result was written. The sentence is for a toast, the state is the run
   * as the endpoint now holds it, and the result is what was pressed — the
   * screen turns that into the thin line the notes list draws.
   */
  onSaved: (said: string, state: NoAnswerState | null, result: CallResult) => void;
  /** "Answered" puts the cursor in the note box with Call already chosen. */
  onAnswered?: () => void;
  /** The agent let the question go without answering it. */
  onDismiss?: () => void;
  /** Out of tries: open the Lost dialog, which asks for a reason. */
  onGiveUp?: () => void;
}) {
  const [busy, setBusy] = useState<CallResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<CallResult | null>(null);
  /** Open for Call back, and for Change on the strip. */
  const [picking, setPicking] = useState<null | 'call_back' | 'change'>(null);
  const [when, setWhen] = useState('');
  const card = useRef<HTMLElement>(null);

  /*
   * Bring the question into view when it goes up. The bar sits above the note
   * box rather than at the top of the page, which is where the design puts
   * it, so an agent coming back from the phone on a long lead page would
   * otherwise have to go looking for the thing that is asking them something.
   */
  useEffect(() => {
    if (!asking) return;
    /* A fresh question, so last call's answer stops being ringed: the ring
       says "this is what you told me about *this* call", and leaving it on
       would answer the new question before the agent had. */
    setChosen(null);
    setProblem(null);
    /* jsdom has no `scrollIntoView`, and an unhandled throw inside an effect
       takes the whole component down with it rather than failing quietly. */
    const to = card.current;
    if (to && typeof to.scrollIntoView === 'function') {
      to.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [asking]);

  async function save(result: CallResult, callBackAt?: string) {
    if (busy) return;
    setBusy(result);
    setProblem(null);
    try {
      const next = await api.post<NoAnswerState>(
        `/api/v2/leads/${opportunityId}/call-result`,
        { result, ...(callBackAt ? { callBackAt } : {}) },
      );
      setChosen(result);
      setPicking(null);

      /*
       * The tap, as well as the call. The question was asked once and the
       * answer belongs on both records — otherwise every WhatsApp this
       * company sends stays a tap with no outcome, which is the hole the
       * owner found on 13 Nov. Best-effort: the result is already saved, and
       * failing the whole thing over the second write would lose it.
       */
      if (asking?.tapId) {
        await api.patch(`/api/v2/taps/${asking.tapId}`, { result: TAP_OUTCOME[result] })
          .catch(() => undefined);
      }

      onSaved(saidAbout(result, next), next, result);
      if (result === 'answered') onAnswered?.();
    } catch (err) {
      setProblem(err instanceof Error ? plain(err.message) : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  function pressed(result: CallResult) {
    setProblem(null);
    /* Call back is the one result that needs a time, so it asks for one
       before it saves anything — D.4. */
    if (result === 'call_back') {
      setWhen(localInput(roundUp(new Date())));
      setPicking('call_back');
      return;
    }
    void save(result);
  }

  const tries = state && state.tries > 0 ? state : null;
  /* "nothing happens on its own now" only when the record says so. */
  const message = tries?.whatsapp?.text ?? null;

  return (
    <section
      ref={card}
      className={asking ? 'd-card v2-ln-bar v2-ln-bar-asking' : 'd-card v2-ln-bar'}
      aria-label="What happened on the call"
    >
      <div className="v2-ln-head">
        <b>What happened?</b>
        <span className="d-grow">
          {asking
            ? `You tapped ${tapped(asking.what)} at ${formatTime(asking.at)} · pick a result`
            : 'One tap saves it with the date and the time.'}
        </span>
        {asking && onDismiss && (
          <button
            type="button"
            className="d-btn d-icon d-xs d-ghost"
            aria-label="Not now"
            title="Not now"
            onClick={onDismiss}
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>

      <div className="v2-ln-pills" role="group" aria-label="Call result">
        {CALL_RESULTS.map((one) => {
          const pill = PILLS[one];
          const on = chosen === one;
          return (
            <button
              key={one}
              type="button"
              className={`d-btn v2-ln-pill ${on ? 'v2-ln-pill-on' : pill.tone}`}
              aria-pressed={on}
              disabled={busy !== null}
              onClick={() => pressed(one)}
            >
              <Icon name={pill.icon} size={15} />
              {busy === one ? 'Saving…' : RESULT_LABEL[one]}
            </button>
          );
        })}
      </div>

      {problem !== null && (
        <p className="d-small d-t-amber">{problem}</p>
      )}

      {picking !== null && (
        <div className="v2-ln-pick">
          <span className="d-field-label">
            {picking === 'change' ? 'Try again when?' : 'When shall I call back?'}
          </span>
          <div className="v2-ln-pick-row">
            {SOON.map((one) => (
              <button
                key={one.label}
                type="button"
                className={when === localInput(one.at()) ? 'd-chip-opt d-on' : 'd-chip-opt'}
                onClick={() => setWhen(localInput(one.at()))}
              >
                {one.label}
              </button>
            ))}
          </div>
          <input
            className="d-input d-sm"
            type="datetime-local"
            value={when}
            min={localInput(new Date())}
            aria-label="Date and time"
            onChange={(e) => setWhen(e.target.value)}
          />
          <div className="v2-ln-pick-row">
            <span className="d-small d-muted d-grow">
              {when ? reads(when) : 'Pick a day and a time.'}
            </span>
            <button
              type="button"
              className="d-btn d-sm d-ghost"
              onClick={() => { setPicking(null); setProblem(null); }}
            >
              Cancel
            </button>
            {/* Black, not orange: orange is kept for Save note, Change,
                More and Undo, and this is none of them. */}
            <button
              type="button"
              className="d-btn d-sm d-dark"
              disabled={when === '' || busy !== null}
              onClick={() => { void save('call_back', new Date(when).toISOString()); }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/*
        * Where the run stands. One row: what happened, how many tries, when
        * the next one is, Change — and, pinned to the right end, the one
        * message. The strip is only drawn when there is a real run to
        * describe; a lead nobody has failed to reach shows the six pills and
        * nothing else.
        */}
      {tries && (
        <div className={tries.exhausted ? 'v2-ln-strip v2-ln-strip-done' : 'v2-ln-strip'}>
          <span className="v2-ln-strip-ic">
            <Icon name={tries.exhausted ? 'alert-triangle' : 'phone-off'} size={14} />
          </span>
          <span className="v2-ln-strip-said">
            <span>
              {RESULT_LABEL.no_answer}
              {' · '}
              {/* "of 5" only when the record says 5. A lead row that carries
                  the count without the limit — which is what the list sends
                  today — reads "try 2" rather than "try 2 of undefined". */}
              <b>
                try {tries.tries}
                {typeof tries.maxTries === 'number' && tries.maxTries > 0
                  ? ` of ${tries.maxTries}`
                  : ''}
              </b>
              {tries.nextTryAt ? ` · next try ${dayAndClock(tries.nextTryAt)}` : ''}
            </span>
            {!tries.exhausted && (
              <button
                type="button"
                className="v2-ln-link"
                onClick={() => {
                  setWhen(localInput(
                    tries.nextTryAt ? new Date(tries.nextTryAt) : roundUp(new Date()),
                  ));
                  setPicking('change');
                }}
              >
                Change
              </button>
            )}
            {tries.exhausted && (
              <span>· nothing happens on its own now</span>
            )}
          </span>
          {tries.exhausted && onGiveUp && (
            <button type="button" className="d-btn d-sm" onClick={onGiveUp}>
              <Icon name="circle-x" size={14} />Mark Lost · not reachable
            </button>
          )}
          {message !== null && (
            <button
              type="button"
              className="d-btn d-sm d-dark"
              title="Opens WhatsApp with it typed in. You press send."
              onClick={() => { void dial.whatsapp(lead, { text: message }); }}
            >
              <Icon name="message-circle" size={14} />
              {compact ? 'Send the message' : 'Send “I tried to call you”'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/* ── Words and times ───────────────────────────────────────────────────── */

/** "Call", "WhatsApp", "Telegram" — the app's own name, never a key. */
function tapped(what: Asking['what']): string {
  return what === 'call' ? 'Call' : what === 'telegram' ? 'Telegram' : 'WhatsApp';
}

/**
 * What the toast says, built from the answer rather than from the press.
 *
 * The owner's own wording on the picture: *"Saved · No answer · try 2 of 5 ·
 * next try tomorrow 11:00"*. The two halves after the result are left out
 * when the endpoint did not send them, because a run that has ended has no
 * next try and inventing one would be a promise the CRM does not keep.
 */
export function saidAbout(result: CallResult, state: NoAnswerState | null): string {
  const bits = [`Saved · ${RESULT_LABEL[result]}`];
  if (state && state.tries > 0) {
    bits.push(typeof state.maxTries === 'number' && state.maxTries > 0
      ? `try ${state.tries} of ${state.maxTries}`
      : `try ${state.tries}`);
  }
  if (state?.nextTryAt) bits.push(`next try ${dayAndClock(state.nextTryAt)}`);
  return bits.join(' · ');
}

/** The four times an agent picks nine times out of ten. */
const SOON: Array<{ label: string; at: () => Date }> = [
  { label: 'In 1 hour', at: () => new Date(Date.now() + 3_600_000) },
  { label: 'Tonight 19:00', at: () => atClock(0, 19) },
  { label: 'Tomorrow 11:00', at: () => atClock(1, 11) },
  { label: 'In 2 days 11:00', at: () => atClock(2, 11) },
];

function atClock(daysAhead: number, hour: number): Date {
  const out = new Date();
  out.setDate(out.getDate() + daysAhead);
  out.setHours(hour, 0, 0, 0);
  return out;
}

function roundUp(at: Date): Date {
  const out = new Date(at);
  out.setMinutes(0, 0, 0);
  out.setHours(out.getHours() + 1);
  return out;
}

/** Local wall-clock text for a `datetime-local`, never a UTC ISO string. */
function localInput(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
    + `T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Read a `datetime-local` back the way this CRM writes a moment.
 *
 * Built from the string's own parts rather than through a `Date`: the value
 * is already wall-clock time, and a browser set to US English renders its own
 * control month-first, where 10/11 means two different days to two people in
 * the same office.
 */
function reads(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return '';
  const [, year, month, day, hour, minute] = match as unknown as string[];
  const weekday = DAYS[new Date(Number(year), Number(month) - 1, Number(day)).getDay()];
  return `${weekday} ${Number(day)} ${MONTHS[Number(month) - 1]} · ${hour}:${minute}`;
}

/**
 * "today 16:40", "tomorrow 11:00", "16 Nov 09:00" — Dubai, 24 hour.
 *
 * `civil()` reads the Dubai offset out of `Intl` and `formatTime()` prints
 * the clock in Dubai, so the day word and the clock beside it can never
 * disagree — which they did on this page until 14 Nov, on every laptop
 * outside the UAE.
 */
export function dayAndClock(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  const dayNumber = (d: Date) => Math.floor(civil(d).getTime() / 86_400_000);
  const gap = dayNumber(at) - dayNumber(new Date());
  const clock = formatTime(at);
  if (gap === 0) return `today ${clock}`;
  if (gap === 1) return `tomorrow ${clock}`;
  if (gap === -1) return `yesterday ${clock}`;
  const day = civil(at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
  return `${day} ${clock}`;
}

/** "14 Nov 16:41" — what a saved row is stamped with. F.1. */
export function stamp(value: string | null | undefined): string {
  if (!value) return '';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  const day = civil(at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
  return `${day} ${formatTime(at)}`;
}
