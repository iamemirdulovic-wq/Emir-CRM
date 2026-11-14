import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { budgetLabel, useToast } from '../design/ui.js';
import { spacedE164 } from '../design/phone.js';
import { clockIn, originOf } from '../lib/dialling.js';
import { SOURCE_STYLES } from '../design/stages.js';
import { uploadNoteFile, voiceFilename } from '../lib/note-files.js';
import { VoiceRecorder, canRecord, formatDuration } from '../lib/recorder.js';
import { LeadAction, type LeadActionKind } from './LeadAction.js';
import { TransferLead } from './TransferLead.js';
import type { CallActions } from './call.js';
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

interface Note {
  id: string;
  body: string;
  author_name?: string | null;
  created_at: string;
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
  const detail = useAsync<{
    lead: Row & { email: string | null; language: string | null; preferred_location: string | null };
  }>(() => api.get(`/api/my-leads/${row.id}`), [row.id]);
  const brief = useAsync<Brief>(() => api.get(`/api/my-leads/${row.id}/brief`), [row.id]);
  const notes = useAsync<{ items: Note[] }>(
    () => api.get(`/api/notes/${row.contact_id}`),
    [row.contact_id],
  );

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

  const lead = detail.data?.lead ?? row;
  const step = nextStep(lead);
  const phone = lead.phone_e164 ?? '';
  const origin = originOf(phone);
  const local = origin ? clockIn(origin.timeZone) : null;
  const name = lead.full_name ?? 'Unnamed lead';
  const to = `/v2/leads/${row.id}`;
  const closed = lead.status === 'won' || lead.status === 'lost';

  /**
   * Everything on this lead is stale: the panel's three reads, and the row in
   * the table behind it.
   *
   * A plain function rather than a `useCallback`: it is only ever called from
   * an event handler, and memoising it would hold the first render's `reload`
   * closures for the life of the panel.
   */
  function reread() {
    detail.reload();
    brief.reload();
    notes.reload();
    onChanged?.();
  }

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
    toast(said);
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
                  onClick={(e) => { e.preventDefault(); void dial.call(row); }}
                >
                  <Icon name="phone" />Call
                </a>
              )
              : <span className="d-btn d-disabled v2-qp-a3">No phone</span>}
            <button
              type="button"
              className="d-btn v2-qp-a3"
              disabled={!phone}
              onClick={() => { void dial.whatsapp(row); }}
            >
              <Icon name="message-circle" />WhatsApp
            </button>
            <button
              type="button"
              className="d-btn v2-qp-a3"
              disabled={!phone}
              onClick={() => { void dial.whatsapp(row, { app: 'telegram' }); }}
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

          {/* §4.5 */}
          <NoteBox
            key={row.id}
            contactId={row.contact_id}
            opportunityId={row.id}
            who={firstName(name)}
            onSaved={() => { notes.reload(); brief.reload(); onChanged?.(); }}
          />

          {/* §4.6 */}
          <LastNotes items={notes.data?.items ?? null} error={notes.error} />

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

/* ── §4.5 · the note box, always open ──────────────────────────────────── */

/**
 * "Write a note about Marco…", a microphone and Save.
 *
 * Point 4 on the change picture is the empty half of the panel, and this is
 * what fills it. It writes through the same `POST /api/notes/{contact}` the
 * lead page and the Notes tab use, so a note left here is the same note, in
 * the same list, under the same name — and a voice note recorded here plays
 * back on the lead page like any other.
 */
function NoteBox({ contactId, opportunityId, who, onSaved }: {
  contactId: string;
  opportunityId: string;
  who: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  /* Staged, not uploaded: a recording has nothing to attach to until the note
     exists, and uploading first would leave one behind every abandoned draft. */
  const [staged, setStaged] = useState<{ blob: Blob; name: string; seconds: number } | null>(null);
  const recorder = useRef<VoiceRecorder | null>(null);

  /* A recording left running holds the microphone and keeps the browser's
     recording dot lit, so closing the panel stops it. */
  useEffect(() => () => recorder.current?.release(), []);

  useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  async function startRecording() {
    try {
      recorder.current = new VoiceRecorder();
      await recorder.current.start();
      setElapsed(0);
      setRecording(true);
    } catch (err) {
      recorder.current = null;
      toast(err instanceof Error ? err.message : 'Could not start recording');
    }
  }

  async function stopRecording() {
    const active = recorder.current;
    setRecording(false);
    recorder.current = null;
    if (!active) return;
    try {
      const result = await active.stop();
      setStaged({ blob: result.blob, name: voiceFilename(result.mimeType), seconds: result.seconds });
    } catch {
      toast('The recording did not save');
    }
  }

  async function save() {
    const text = body.trim();
    /* A voice note is the whole note: asking for words as well would mean
       typing, which is the thing the recording exists to avoid. */
    if (!text && !staged) return;
    setSaving(true);
    try {
      const created = await api.post<{ id: string }>(`/api/notes/${contactId}`, {
        body: text || '🎤 Voice note',
        type: 'general',
        opportunityId,
      });
      if (staged) {
        await uploadNoteFile(created.id, staged.blob, {
          filename: staged.name,
          durationSeconds: staged.seconds,
        }).catch(() => toast('The voice note did not upload'));
      }
      setBody('');
      setStaged(null);
      onSaved();
      toast('Noted');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="v2-qp-note">
      <textarea
        className="d-textarea"
        value={body}
        placeholder={`Write a note about ${who}…`}
        aria-label={`Write a note about ${who}`}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="v2-qp-note-foot">
        {canRecord() && (
          <button
            type="button"
            className={recording ? 'd-btn d-sm d-icon v2-qp-rec' : 'd-btn d-sm d-icon'}
            aria-label={recording ? 'Stop recording' : 'Record a voice note'}
            title={recording ? 'Stop recording' : 'Record a voice note'}
            onClick={() => { void (recording ? stopRecording() : startRecording()); }}
          >
            <Icon name="mic" />
          </button>
        )}
        {recording && <span className="d-small d-muted">Recording {formatDuration(elapsed)}</span>}
        {staged && !recording && (
          <span className="v2-qp-staged">
            Voice note {formatDuration(staged.seconds)}
            <button
              type="button"
              className="d-btn d-xs d-icon d-ghost"
              aria-label="Throw the recording away"
              onClick={() => setStaged(null)}
            >
              <Icon name="x" size={12} />
            </button>
          </span>
        )}
        <span className="d-grow" />
        <button
          type="button"
          className="d-btn d-sm d-primary"
          disabled={saving || (body.trim() === '' && !staged)}
          onClick={() => { void save(); }}
        >
          <Icon name="save" />{saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/* ── §4.6 · the last three notes ───────────────────────────────────────── */

function LastNotes({ items, error }: { items: Note[] | null; error: string | null }) {
  if (error) return <p className="d-small d-muted">{error}</p>;
  if (!items) return <p className="d-small d-muted">Reading the notes…</p>;
  if (items.length === 0) {
    return <p className="d-small d-muted">No notes yet. Write the first one after your call.</p>;
  }

  /* Newest first, whatever order they arrived in: the server puts pinned
     notes at the top, and "the last three notes" means the last three. */
  const last = [...items]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3);

  return (
    <div className="v2-qp-notes">
      {last.map((one) => (
        <div className="v2-qp-note-row" key={one.id}>
          <div className="v2-qp-note-who">
            <b>{one.author_name?.trim() || 'Someone'}</b>
            <span>{moment(one.created_at)}</span>
          </div>
          <div className="v2-qp-note-body" dir="auto">{one.body}</div>
        </div>
      ))}
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
