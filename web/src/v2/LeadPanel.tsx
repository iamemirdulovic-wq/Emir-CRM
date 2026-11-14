import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useMaybeAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { budgetLabel, useToast } from '../design/ui.js';
import { spacedE164 } from '../design/phone.js';
import { clockIn, originOf } from '../lib/dialling.js';
import { SOURCE_STYLES } from '../design/stages.js';
import { LeadAction, type LeadActionKind } from './LeadAction.js';
import { TransferLead } from './TransferLead.js';
import type { CallActions } from './call.js';
import { LeadNotes } from './LeadNotes.js';
import { LeadNoteBox, type NoteBoxHandle } from './LeadNoteBox.js';
import { CallResultBar, type Asking } from './CallResultBar.js';
import {
  plain, resultsFromActivities, type CallResultLine, type NoAnswerState,
} from './call-result.js';
import {
  STAGE_CHIP, STAGE_LABEL, nextStep, type Row,
} from './Leads.js';
import '../styles/v2-quick-panel.css';

/*
 * Moved out of `Leads.tsx` on 14 November 2026 and rebuilt the same day
 * against §4 of the owner's fix list — "COMPUTER: QUICK PANEL", with the
 * numbered change picture `03-Computer-Quick-panel.png`.
 *
 * His complaint in one line: *"half of it is empty and I cannot do real work
 * in it."* He was right. What opened on a row click was a phone number, a
 * stage, four read-only facts and one note, with Transfer at the foot — so
 * every real action meant leaving the list for the lead page and losing the
 * scroll position, which is the round trip the panel exists to avoid.
 *
 * The nine points, and where each one is below:
 *
 *   §4.1 name, phone, stage, local time, Open full page, X   — the head
 *   §4.2 Call, WhatsApp, Telegram, Follow-up, Meeting        — `v2-qp-acts`
 *   §4.3 next step with Done and Change, or Add one          — `NextStep`
 *   §4.4 "In short" from Homes AI, two lines                 — `InShort`
 *   §4.5 a note box that is always open, mic and Save        — `NoteBox`
 *   §4.6 the last three notes                                — `LastNotes`
 *   §4.7 Project, Unit, Budget, Language                     — the `d-kv`
 *   §4.8 Transfer, Won, Lost                                 — the foot
 *   §4.9 arrow keys move to the next lead                    — `onPrev`/`onNext`
 *
 * Two things it deliberately does not do.
 *
 * **Nothing here invents a figure.** Every line is a column the record really
 * holds or a sentence the server really sent; a field that is empty shows a
 * dash rather than a guess, and "In short" wears the Homes AI chip only when
 * the model really wrote those words.
 *
 * **"Done" cannot clear the next step, because nothing can.** `next_step_at`
 * is written in exactly two places on the server — `runLeadAction` and a note
 * saved with a reminder — and neither of them can set it back to nothing
 * short of closing the lead as Won or Lost. So Done does what the design's
 * own tasks page says it does ("Done asks what happened, so the lead always
 * has a next step"): it asks for the next one, and the answer replaces the
 * old one. See the note on `markDone` below, and the report for 14 Nov.
 */

/** Three lines of the AI's reading of the notes, or nothing to say. */
interface Brief {
  notes: { lines: string[]; watchOut: string | null; at: string | null; stale: boolean };
  advice: { headline: string; note: string; why: string } | null;
}

/**
 * The 480px side panel a row click opens.
 *
 * It reads the lead, its brief and its notes once when it opens, which is
 * what gives it the three things the list rows do not carry. `row` is the
 * table's own copy and is used until the read lands, so the panel is never
 * blank for a moment.
 *
 * `onPrev` and `onNext` are §4.9: up and down move to the lead above or below
 * in the list *without closing the panel*. The selection itself lives in
 * `Leads.tsx`, so the panel only says which way the reader went — both are
 * optional, and until the list wires them the keys simply do nothing.
 */
export function LeadPanel({
  row, book, onClose, onGive, dial, onPrev, onNext, onChanged,
}: {
  row: Row;
  book: boolean;
  onClose: () => void;
  onGive: () => void;
  dial: CallActions;
  /** Open the lead above this one in the list. ArrowUp. */
  onPrev?: () => void;
  /** Open the lead below this one in the list. ArrowDown. */
  onNext?: () => void;
  /** Something on this lead changed, so the row behind the panel is stale. */
  onChanged?: () => void;
}) {
  const toast = useToast();
  /* `useMaybeAuth`, not `useAuth`: `lead-panel.test.tsx` mounts this panel on
     its own with no provider around it, and who is signed in only decides
     whose name goes on a call result the agent has just saved. */
  const me = useMaybeAuth()?.user ?? null;
  const detail = useAsync<{
    lead: Row & {
      email: string | null; language: string | null; preferred_location: string | null;
      /** The run, per `docs/v2/call-results-contract.md` §3, when sent. */
      noAnswer?: NoAnswerState | null;
    };
    /* The lead's history comes with the record and was being thrown away.
       It is where the call results already on the lead are read from. */
    activities?: Array<{
      id: string; type: string; meta?: unknown;
      user_name?: string | null; created_at: string;
    }>;
  }>(() => api.get(`/api/my-leads/${row.id}`), [row.id]);
  const brief = useAsync<Brief>(() => api.get(`/api/my-leads/${row.id}/brief`), [row.id]);

  /** Which dialog is open: a follow-up, a meeting, Won, Lost or a transfer. */
  const [doing, setDoing] = useState<LeadActionKind | null>(null);
  const [handingOver, setHandingOver] = useState(false);
  /*
   * The step the agent said they had done, kept until the follow-up dialog
   * either saves — when it is written down as a note — or is cancelled, when
   * nothing at all has happened. Recording it on the press would leave a note
   * saying a step was done beside a step that is still owed.
   */
  const [doneStep, setDoneStep] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);

  /*
   * §D, in the panel as well as on the lead page — the owner's first line is
   * "same rules on computer, quick panel, lead page, phone and dialler", and
   * the bar, the note box and the notes list below are literally the same
   * three components the lead page draws.
   */
  const [asking, setAsking] = useState<Asking | null>(null);
  const [run, setRun] = useState<NoAnswerState | null>(null);
  const [justSaved, setJustSaved] = useState<CallResultLine[]>([]);
  /** Bumped when a note is saved, so the list under the box re-reads. */
  const [noteStamp, setNoteStamp] = useState(0);
  /* D.5: "Answered" puts the cursor in the note box with Call chosen. */
  const box = useRef<NoteBoxHandle>(null);

  const lead = detail.data?.lead ?? row;
  const step = nextStep(lead);
  const phone = lead.phone_e164 ?? '';
  const origin = originOf(phone);
  const local = origin ? clockIn(origin.timeZone) : null;
  const name = lead.full_name ?? 'Unnamed lead';
  const to = `/v2/leads/${row.id}`;
  const closed = lead.status === 'won' || lead.status === 'lost';
  /* The call results on this lead: the ones already in its history, and the
     ones answered since the panel opened. A past one carries no try number,
     because nothing stores which attempt it was. */
  const results = [...justSaved, ...resultsFromActivities(detail.data?.activities ?? [])];

  /**
   * Everything on this lead is stale: the panel's own reads, the notes list
   * below it, and the row in the table behind it.
   *
   * A plain function rather than a `useCallback`: it is only ever called from
   * an event handler, and memoising it would hold the first render's `reload`
   * closures for the life of the panel.
   */
  function reread() {
    detail.reload();
    brief.reload();
    setNoteStamp((n) => n + 1);
    onChanged?.();
  }

  /*
   * D.6: the bar lights up with "What happened?" the moment the phone or
   * WhatsApp opens, and the moment is read on the press rather than when the
   * agent answers. Each `dial` call stays inside the control it belongs to —
   * `call-wiring.test.ts` reads the element and checks the recording is
   * there, and that check has already caught a screen going back to a bare
   * `tel:` link.
   */

  /*
   * The panel takes focus when it opens, so the arrow keys below are the
   * panel's keys rather than the page's — and so a reader who opened it with
   * the keyboard is not left typing into the table behind it. On mount only:
   * re-focusing on every row change would snatch the cursor out of a
   * half-written note each time the reader pressed down.
   */
  useEffect(() => { panel.current?.focus(); }, []);

  /*
   * Escape closes it, like every other panel in the design, and up and down
   * walk the list — §4.9, and point 8 on the change picture: *"Arrow keys up
   * and down open the next lead without closing the panel."*
   *
   * On `window` rather than the panel, because the row that was clicked keeps
   * the browser's focus in some orders and a listener on the panel alone
   * would answer nothing. A key pressed inside a box somebody is typing in is
   * left alone: up and down move the caret there, and stealing them would
   * throw away the note being written.
   *
   * A dialog over the panel takes the keys back. Escape then shuts the dialog
   * rather than the whole panel, and the arrows do nothing at all — walking
   * to the next lead underneath a half-filled Won form would file it against
   * somebody else.
   */
  const over = doing !== null || handingOver;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        if (over) { setDoing(null); setDoneStep(null); setHandingOver(false); }
        else onClose();
        return;
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (over || isTyping(event.target)) return;
      const go = event.key === 'ArrowUp' ? onPrev : onNext;
      if (!go) return;
      event.preventDefault();
      go();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext, over]);

  /**
   * "Done" on the next step.
   *
   * It asks what happens next rather than ticking a box, because the lead has
   * to be left with a next step — and because the only way the server can
   * retire the old one is to have a new one put in its place. What was done
   * is written down as a note when the dialog saves.
   */
  function markDone() {
    setDoneStep(lead.next_step_note?.trim() || 'the follow-up');
    setDoing('follow_up');
  }

  async function afterAction(said: string) {
    const was = doneStep;
    setDoneStep(null);
    setDoing(null);
    if (was) {
      await api.post(`/api/notes/${row.contact_id}`, {
        body: `Did it: ${was}`,
        type: 'next_step',
        opportunityId: row.id,
      }).catch(() => undefined);
    }
    reread();
    /* The server's own sentences carry emoji — "Moved to Interested 🔥",
       "Deal won! 🏆" — and the owner has asked three times for none anywhere.
       Cleaned on the way to the screen until the server stops sending them. */
    toast(plain(said));
  }

  return (
    <>
      <div className="d-scrim d-show" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label="Lead" ref={panel} tabIndex={-1}>
        {/* §4.1 — the name, with Open full page and the X beside it. */}
        <div className="d-panel-head">
          <h2>
            {name}
            {lead.is_vip === 1 && <> <span className="d-vip-tag">VIP</span></>}
          </h2>
          <Link className="d-btn d-sm" to={to}>
            <Icon name="external-link" />Open full page
          </Link>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-16">
          {/* §4.1 — the phone, the stage, their own clock, and who holds it. */}
          <div className="d-p-top">
            <div className="d-phone-xl" dir="ltr">
              {spacedE164(phone) ?? 'No phone number'}
            </div>
            <div className="d-row d-gap-8 d-wrap d-mt-8">
              <span className={`d-chip d-stage-${STAGE_CHIP[lead.stage_key] ?? 'new'}`}>
                {STAGE_LABEL[lead.stage_key] ?? lead.stage_key}
              </span>
              {origin && local && (
                <span className="d-localtime">
                  <Icon name="clock" size={13} />
                  {origin.zoneLabel ?? origin.name} {local.time}
                </span>
              )}
              <span className="d-muted d-small">
                {lead.owner_name ? `· with ${lead.owner_name}` : '· in Incoming, no agent yet'}
              </span>
            </div>
          </div>

          {/* §4.2 — the five ways to reach them or to put something in the diary. */}
          <div className="v2-qp-acts">
            {phone
              ? (
                <a
                  className="d-btn d-primary v2-qp-a3"
                  href={`tel:${phone}`}
                  onClick={(e) => {
                    e.preventDefault();
                    const at = new Date().toISOString();
                    void dial.call(row).then(() => setAsking({ what: 'call', at }));
                  }}
                >
                  <Icon name="phone" />Call
                </a>
              )
              : <span className="d-btn d-disabled v2-qp-a3">No phone</span>}
            <button
              type="button"
              className="d-btn v2-qp-a3"
              disabled={!phone}
              onClick={() => {
                const at = new Date().toISOString();
                void dial.whatsapp(row).then((tapId) => {
                  setAsking({ what: 'whatsapp', at, tapId });
                });
              }}
            >
              <Icon name="message-circle" />WhatsApp
            </button>
            <button
              type="button"
              className="d-btn v2-qp-a3"
              disabled={!phone}
              onClick={() => {
                const at = new Date().toISOString();
                void dial.whatsapp(row, { app: 'telegram' }).then((tapId) => {
                  setAsking({ what: 'telegram', at, tapId });
                });
              }}
            >
              <Icon name="send" />Telegram
            </button>
            <button
              type="button"
              className="d-btn v2-qp-a2"
              onClick={() => { setDoneStep(null); setDoing('follow_up'); }}
            >
              <Icon name="clock" />Follow-up
            </button>
            <button type="button" className="d-btn v2-qp-a2" onClick={() => setDoing('meeting')}>
              <Icon name="calendar-days" />Meeting
            </button>
          </div>

          {/* §4.3 */}
          <NextStep
            text={step.text}
            late={step.urgent}
            none={step.none}
            closed={closed}
            onDone={markDone}
            onChange={() => { setDoneStep(null); setDoing('follow_up'); }}
          />

          {/* §4.4 */}
          <InShort lead={lead} brief={brief.data} loading={!brief.data && !brief.error} />

          {/* §D — the call-result bar, above the note box, always visible.
              The same component the lead page draws, a little tighter. */}
          <CallResultBar
            opportunityId={row.id}
            lead={row}
            state={run ?? detail.data?.lead.noAnswer ?? null}
            asking={asking}
            dial={dial}
            compact
            onDismiss={() => setAsking(null)}
            onGiveUp={() => { setDoneStep(null); setDoing('lost'); }}
            onAnswered={() => box.current?.focus('call_summary')}
            onSaved={(said, state, result) => {
              setRun(state);
              setAsking(null);
              setJustSaved((was) => [{
                id: `just-${Date.now()}`,
                result,
                tries: state && state.tries > 0 ? state.tries : null,
                maxTries: state && state.tries > 0 ? state.maxTries : null,
                who: me?.name ?? null,
                at: new Date().toISOString(),
              }, ...was]);
              reread();
              toast(plain(said));
            }}
          />

          {/* §4.5 / §E — the note box, always open. */}
          <div className="v2-qp-note">
            <LeadNoteBox
              ref={box}
              key={row.id}
              contactId={row.contact_id}
              opportunityId={row.id}
              who={firstName(name)}
              compact
              onSaved={(said) => {
                setNoteStamp((n) => n + 1);
                brief.reload();
                onChanged?.();
                toast(said);
              }}
            />
          </div>

          {/* §4.6 / §F — the last few things said and done, same shapes as
              the lead page: the pinned note on peach, a call result as one
              thin line, a photo as a thumbnail. */}
          <div className="v2-qp-notes">
            <LeadNotes
              contactId={row.contact_id}
              results={results}
              nextStep={{ at: lead.next_step_at, note: lead.next_step_note }}
              limit={3}
              reloadKey={noteStamp}
              onChanged={onChanged}
              compact
            />
          </div>

          {/* §4.7 — four plain lines, and never a code: "English", not "en". */}
          <dl className="d-kv">
            <PanelRow label="Project" value={lead.project_name} />
            <PanelRow label="Unit" value={lead.unit_type} />
            <PanelRow label="Budget" value={budget(lead)} />
            <PanelRow label="Language" value={languageName(detail.data?.lead.language ?? null)} />
            <PanelRow label="Last contact" value={moment(lead.last_contact_at)} />
            {book && (
              <PanelRow
                label="Source"
                value={lead.source ? SOURCE_STYLES[lead.source]?.label ?? null : null}
              />
            )}
            {book && <PanelRow label="Lead #" value={`#${row.id.slice(0, 8)}`} />}
          </dl>
        </div>

        {/* §4.8 */}
        <div className="d-panel-foot v2-qp-foot">
          {book
            ? (
              <button type="button" className="d-btn" onClick={onGive}>
                <Icon name="repeat" />Transfer
              </button>
            )
            : (
              <button type="button" className="d-btn" onClick={() => setHandingOver(true)}>
                <Icon name="repeat" />Transfer
              </button>
            )}
          <span className="d-grow" />
          <button
            type="button"
            className="d-btn d-green"
            disabled={closed}
            onClick={() => setDoing('won')}
          >
            <Icon name="trophy" />Won
          </button>
          <button
            type="button"
            className="d-btn d-danger"
            disabled={closed}
            onClick={() => setDoing('lost')}
          >
            <Icon name="circle-x" />Lost
          </button>
        </div>
      </aside>

      {doing && (
        <LeadAction
          kind={doing}
          opportunityId={row.id}
          who={name}
          onDone={(said) => { void afterAction(said); }}
          onCancel={() => { setDoing(null); setDoneStep(null); }}
        />
      )}

      {handingOver && (
        <TransferLead
          opportunityId={row.id}
          who={name}
          isVip={lead.is_vip === 1}
          onDone={(said) => { setHandingOver(false); reread(); toast(said); }}
          onCancel={() => setHandingOver(false)}
        />
      )}
    </>
  );
}

/* ── §4.3 · what is owed next ──────────────────────────────────────────── */

/**
 * The next step, with something to press on it.
 *
 * Emir's own words on the change picture: *"Next step is only text. I cannot
 * do anything with it."* Red when it is late, which is the one thing a glance
 * at this panel is for.
 */
function NextStep({ text, late, none, closed, onDone, onChange }: {
  text: string;
  late: boolean;
  none: boolean;
  closed: boolean;
  onDone: () => void;
  onChange: () => void;
}) {
  return (
    <div className={late ? 'v2-qp-next v2-qp-next-late' : 'v2-qp-next'}>
      <div className="v2-qp-next-text">
        <span className="d-sec-label" style={{ color: 'inherit', opacity: 0.75 }}>Next step</span>
        <b>{text}</b>
      </div>
      {/* A lead that is Won or Lost is owed nothing, so neither button is
          offered on one — pressing them would open a dialog that plans a
          follow-up on a closed deal. */}
      {!closed && (
        none
          ? (
            <button type="button" className="d-btn d-sm" onClick={onChange}>
              <Icon name="plus" />Add one
            </button>
          )
          : (
            <>
              <button type="button" className="d-btn d-sm" onClick={onDone}>
                <Icon name="check" />Done
              </button>
              <button type="button" className="d-btn d-sm d-ghost" onClick={onChange}>
                Change
              </button>
            </>
          )
      )}
    </div>
  );
}

/* ── §4.4 · In short ───────────────────────────────────────────────────── */

/**
 * The two lines an agent reads before they dial.
 *
 * The same rule as the lead page, and the same endpoint: the model's own
 * words with the Homes AI chip when it has read the notes, and the record's
 * own facts with no chip when it has not. A card that credits the AI for a
 * sentence the AI did not write is the one thing this may not do.
 */
function InShort({ lead, brief, loading }: {
  lead: Row & { language?: string | null };
  brief: Brief | null;
  loading: boolean;
}) {
  const lines = (brief?.notes.lines ?? []).slice(0, 2);
  const what = [lead.project_name, lead.unit_type, budget(lead)].filter(Boolean).join(' · ');
  const spoke = lead.last_contact_at
    ? `Last spoken to ${moment(lead.last_contact_at).toLowerCase()}`
    : 'Not called yet';

  return (
    <div className="v2-qp-short">
      <div className="d-card-head d-mb-8">
        <h3>In short</h3>
        {lines.length > 0 && (
          <span className="d-chip d-dark">
            <Icon name="sparkles" size={13} />Homes AI
          </span>
        )}
      </div>
      {loading && <p className="d-small d-muted">Reading the lead…</p>}
      {!loading && lines.length > 0 && lines.map((line) => <p key={line}>{line}</p>)}
      {!loading && lines.length === 0 && (
        <p>
          <b>{what || 'Nothing said about what they want yet'}</b>.
          {' '}Stage {STAGE_LABEL[lead.stage_key] ?? lead.stage_key}. {spoke}.
          {lead.language ? ` Speaks ${languageName(lead.language)}.` : ''}
        </p>
      )}
    </div>
  );
}

/* ── Small things ──────────────────────────────────────────────────────── */

function PanelRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="d-kv-row">
      <dt>{label}</dt>
      <dd dir="auto">{value && String(value).trim() !== '' ? value : '—'}</dd>
    </div>
  );
}

/** "AED 1.5M–2M", or nothing when the lead has never said a figure. */
function budget(lead: Row): string | null {
  if (!lead.budget_min_aed && !lead.budget_max_aed && !lead.budget_band) return null;
  const said = budgetLabel(lead.budget_min_aed, lead.budget_max_aed, lead.budget_band ?? null);
  return said === '—' ? null : said;
}

/**
 * The first word of a name, for "Write a note about Marco…".
 *
 * A company name is left whole: "Rubbie" is not what anybody calls Rubbie
 * Realtors, so anything with no space in the first word's own right still
 * reads properly either way.
 */
function firstName(full: string): string {
  const word = full.trim().split(/\s+/)[0];
  return word && word.length > 1 ? word : full.trim() || 'this lead';
}

/**
 * "Today 14:20", "Yesterday 09:05", "12 Nov 18:57" — Dubai time, 24 hour.
 *
 * Always with the clock on it. §1.6 of the same fix list is the Transfers
 * page showing a day with no time, and a note that says only "Yesterday" has
 * the same fault: an agent reading three notes wants to know which came after
 * which call. `whenShort`, which the table uses, drops the clock on anything
 * older than today, so the panel words its own.
 */
function moment(value: string | null): string {
  if (!value) return 'Not yet';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return 'Not yet';
  const clock = at.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai',
  });
  /* Dubai is UTC+4 with no daylight saving, so the day a moment falls on is
     the UTC day shifted four hours. Deliberately not a timezone library. */
  const day = (d: Date) => Math.floor((d.getTime() + 4 * 3_600_000) / 86_400_000);
  const was = day(at);
  const today = day(new Date());
  if (was === today) return `Today ${clock}`;
  if (was === today - 1) return `Yesterday ${clock}`;
  return `${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' })} ${clock}`;
}

/**
 * "English", never "en".
 *
 * §0 of the fix list: *"Never show raw codes to people."* Point 3 on the
 * change picture is this exact line reading `en`. The same mapping as the
 * lead page's; a code nobody has a word for is shown as it stands rather
 * than hidden, because a blank is worse than an odd-looking tag.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', ar: 'Arabic', ru: 'Russian', hi: 'Hindi', ur: 'Urdu', fa: 'Persian',
  fr: 'French', de: 'German', it: 'Italian', es: 'Spanish', tr: 'Turkish', zh: 'Chinese',
  pt: 'Portuguese', sr: 'Serbian', uk: 'Ukrainian',
};

function languageName(code: string | null): string | null {
  const tidy = (code ?? '').trim();
  if (!tidy) return null;
  return LANGUAGE_NAMES[tidy.toLowerCase()] ?? tidy;
}

/**
 * Is this key being pressed inside something somebody is writing in?
 *
 * Up and down move the caret in a text box and change the choice in a select.
 * Taking them over there would throw away a half-written note, which is the
 * one thing this panel was built to collect.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
