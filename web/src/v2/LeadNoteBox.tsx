import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { api, ApiError } from '../lib/api.js';
import { Icon } from '../design/index.js';
import { readableSize } from '../lib/tasks.js';
import { uploadNoteFile, voiceFilename } from '../lib/note-files.js';
import { VoiceRecorder, canRecord, formatDuration } from '../lib/recorder.js';
import { plain } from './call-result.js';
import {
  MORE_PHRASES, NOTE_TYPES, QUICK_PHRASES, TYPE_ICON, TYPE_LABEL,
  placeholderFor, type NoteType,
} from './note-text.js';
import '../styles/v2-lead-notes.css';

/**
 * The note box — §E of the owner's list, 14 Nov.
 *
 * ── What was wrong with it ────────────────────────────────────────────────
 *
 * His word for the old one was "unprofessional", and he was right about every
 * part of it: six emoji across the top (📝 📞 🏠 💰 ⚠️ ✅), the quick phrases
 * drawn as grey squares with no sign that a tap would do anything, the
 * microphone and the paperclip as bare icons with no word beside them, and
 * Save as a quiet outline button beside a louder Cancel.
 *
 * ── What it is now ────────────────────────────────────────────────────────
 *
 * Read from `docs/v2/note-box-design.md`, which is the reading of his
 * picture: type pills first, pale grey with the chosen one black with white
 * text and an icon; the text itself; the quick phrases as white chips with a
 * `+` in front and **More** in orange for the rest; then a thin line and the
 * bottom row — **Attach**, **Voice** and **Remind me** on the left, each an
 * icon *and* a word, "Ctrl + Enter to save" printed in small grey, and a
 * solid orange **Save note** on the right, grey only when the box is empty.
 *
 * ── One box, three places ─────────────────────────────────────────────────
 *
 * It is the same component on the lead page, in the leads quick panel and on
 * the phone. The owner's first line was *"same rules on computer, quick
 * panel, lead page, phone and dialler"*, and two copies of a note box drift
 * apart inside a week — which is how the page ended up with one box that
 * posted `type: 'call'` and another that posted `type: 'call_summary'`. Only
 * the second is a value the column holds; the first was refused by the server
 * with a validation error every time an agent chose Call in the box above
 * the tabs.
 *
 * Nothing here is sent to a client, and nothing is saved without the press.
 */

/** What a screen can ask the box to do. D.5 is the only caller: "Answered". */
export interface NoteBoxHandle {
  /** Put the cursor in the box, optionally with a type already chosen. */
  focus: (type?: NoteType) => void;
}

interface Staged {
  blob: Blob;
  name: string;
  seconds?: number;
  /** For an image, so it can be shown rather than named. */
  preview?: string;
}

export const LeadNoteBox = forwardRef<NoteBoxHandle, {
  contactId: string;
  /** The enquiry the note is about. Null for a person with no open lead. */
  opportunityId: string | null;
  /** The client's first name, for "Write a note about Rubbie…". */
  who: string;
  /**
   * Saved. The sentence is for a toast; `movedStage` says the lead moved as
   * well, so the screen behind can redraw its stage rather than disagreeing
   * with the toast until somebody reloads.
   */
  onSaved: (said: string, moved: boolean) => void;
  /** The quick panel and the phone: the same box, a little tighter. */
  compact?: boolean;
}>(function LeadNoteBox({ contactId, opportunityId, who, onSaved, compact = false }, ref) {
  const [body, setBody] = useState('');
  const [type, setType] = useState<NoteType>('general');
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  /* Staged, not uploaded: a file has nothing to attach to until the note
     exists, and uploading before Save would leave an orphan behind every
     abandoned draft. */
  const [staged, setStaged] = useState<Staged[]>([]);
  const picker = useRef<HTMLInputElement>(null);

  const recorder = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const [remindOpen, setRemindOpen] = useState(false);
  const [remind, setRemind] = useState('');

  useImperativeHandle(ref, () => ({
    focus: (next?: NoteType) => {
      if (next) setType(next);
      field.current?.focus();
    },
  }), []);

  /* A recording left running holds the microphone and keeps the browser's
     recording dot lit, so leaving the screen stops it. */
  useEffect(() => () => recorder.current?.release(), []);

  /*
   * Every preview URL this box has made, so none of them leaks when the
   * screen closes. It is a ref and not the `staged` list: a cleanup keyed to
   * `staged` runs with the *old* list every time a photo is added, and would
   * revoke the first photo's preview the moment a second one was attached —
   * one blank thumbnail, with nothing on screen to explain it.
   */
  const previews = useRef<string[]>([]);
  useEffect(() => () => {
    for (const url of previews.current) URL.revokeObjectURL(url);
    previews.current = [];
  }, []);

  function previewOf(file: File): string | undefined {
    if (!file.type.startsWith('image/')) return undefined;
    const url = URL.createObjectURL(file);
    previews.current.push(url);
    return url;
  }

  useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  async function startRecording() {
    setProblem(null);
    try {
      recorder.current = new VoiceRecorder();
      await recorder.current.start();
      setElapsed(0);
      setRecording(true);
    } catch (err) {
      recorder.current = null;
      setProblem(err instanceof Error ? plain(err.message) : 'The microphone would not start.');
    }
  }

  async function stopRecording() {
    const active = recorder.current;
    setRecording(false);
    recorder.current = null;
    if (!active) return;
    try {
      const result = await active.stop();
      setStaged((list) => [
        ...list,
        { blob: result.blob, name: voiceFilename(result.mimeType), seconds: result.seconds },
      ]);
    } catch {
      setProblem('The recording did not save.');
    }
  }

  const empty = body.trim() === '' && staged.length === 0;

  async function save() {
    if (empty || saving) return;
    setSaving(true);
    setProblem(null);
    const text = body.trim();
    try {
      const created = await api.post<{ id: string; movedStage?: { to: string } | null }>(
        `/api/notes/${contactId}`,
        {
          /* A voice note or a photo is the whole note: asking for words as
             well would mean typing, which is the thing it exists to avoid.
             The stand-in is plain English and never the file's own name. */
          body: text || placeholderFor(kindOf(staged)),
          type,
          opportunityId,
          ...(remind ? { remindAt: new Date(remind).toISOString() } : {}),
        },
      );

      /* One at a time rather than all at once: these are phone uploads on a
         car's signal, and ten parallel requests is how they all fail. */
      for (const one of staged) {
        await uploadNoteFile(created.id, one.blob, {
          filename: one.name,
          durationSeconds: one.seconds ?? null,
        }).catch((err: unknown) => {
          setProblem(err instanceof ApiError
            ? plain(err.message)
            : `${one.name} did not upload.`);
        });
      }

      for (const url of previews.current) URL.revokeObjectURL(url);
      previews.current = [];
      setStaged([]);
      setBody('');
      setType('general');
      setRemind('');
      setRemindOpen(false);
      setMore(false);
      onSaved(
        remind ? 'Note saved, and you will be reminded.' : 'Note saved.',
        /* `!= null` on purpose: an older build of the endpoint leaves the
           field off altogether rather than sending null. */
        created.movedStage != null,
      );
    } catch (err) {
      setProblem(err instanceof ApiError ? plain(err.message) : 'That note did not save.');
    } finally {
      setSaving(false);
    }
  }

  function add(phrase: string) {
    setBody((current) => (current.trim() === '' ? phrase : `${current.trimEnd()}\n${phrase}`));
    field.current?.focus();
  }

  return (
    <div className="v2-ln-box">
      {/* 1 · what kind of note this is. The chosen one is black with white
          text and an icon; the rest are pale grey and quiet. */}
      <div className="v2-ln-types" role="group" aria-label="What kind of note">
        {NOTE_TYPES.map((one) => (
          <button
            key={one}
            type="button"
            className={type === one ? 'd-chip-opt v2-ln-type d-on' : 'd-chip-opt v2-ln-type'}
            aria-pressed={type === one}
            onClick={() => setType(one)}
          >
            {type === one && <Icon name={TYPE_ICON[one]} size={13} />}
            {TYPE_LABEL[one]}
          </button>
        ))}
      </div>

      {/* 2 · the note itself. */}
      <textarea
        ref={field}
        className="d-textarea v2-ln-text"
        placeholder={`Write a note about ${who}…`}
        aria-label={`Write a note about ${who}`}
        value={body}
        dir="auto"
        disabled={saving}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          /*
           * Ctrl + Enter saves — E.6, and printed on the box so it is
           * discoverable rather than folklore. Plain Enter is a new line:
           * these notes run to three or four sentences, and a box that saved
           * on Enter cost an agent the rest of the thought every time.
           */
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />

      {/* 3 · the phrases an agent writes ten times a day. */}
      <div className="v2-ln-quick">
        {QUICK_PHRASES.map((phrase) => (
          <button key={phrase} type="button" className="v2-ln-qchip" onClick={() => add(phrase)}>
            <Icon name="plus" size={11} />
            {phrase}
          </button>
        ))}
        {more && MORE_PHRASES.map((phrase) => (
          <button key={phrase} type="button" className="v2-ln-qchip" onClick={() => add(phrase)}>
            <Icon name="plus" size={11} />
            {phrase}
          </button>
        ))}
        {/* Orange, because More is one of the four things orange is for. It
            opens a second row in place rather than a sheet: a dropdown over
            a box somebody is typing in hides what they wrote, and at 390px a
            sheet would cover the keyboard they are using. */}
        <button type="button" className="v2-ln-link" onClick={() => setMore((on) => !on)}>
          {more ? 'Less' : 'More'}
        </button>
      </div>

      {staged.length > 0 && (
        <ul className="v2-ln-staged">
          {staged.map((one, index) => (
            <li className="v2-ln-staged-row" key={`${one.name}-${index}`}>
              <Icon name={one.seconds ? 'mic' : one.preview ? 'camera' : 'paperclip'} size={14} />
              <span className="v2-ln-staged-name">
                {one.seconds ? 'Voice note' : one.name}
              </span>
              <small className="d-muted">
                {one.seconds ? formatDuration(one.seconds) : readableSize(one.blob.size)}
              </small>
              <button
                type="button"
                className="d-btn d-icon d-xs d-ghost"
                aria-label={`Take ${one.seconds ? 'the recording' : one.name} off this note`}
                onClick={() => setStaged((list) => list.filter((_, i) => i !== index))}
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {recording && (
        /* The timer is the point: without it nobody knows whether the
           microphone actually started, and they record silence. */
        <div className="v2-ln-rec" role="status">
          <span className="v2-ln-rec-dot" aria-hidden />
          Recording · {formatDuration(elapsed)}
          <span className="d-grow" />
          <button type="button" className="d-btn d-xs d-dark" onClick={() => void stopRecording()}>
            <Icon name="square" size={12} />Stop
          </button>
        </div>
      )}

      {remindOpen && (
        <div className="v2-ln-pick">
          <span className="d-field-label">Remind me</span>
          <div className="v2-ln-pick-row">
            {REMIND_SOON.map((one) => (
              <button
                key={one.label}
                type="button"
                className={remind === localInput(one.at()) ? 'd-chip-opt d-on' : 'd-chip-opt'}
                onClick={() => setRemind(localInput(one.at()))}
              >
                {one.label}
              </button>
            ))}
          </div>
          <input
            className="d-input d-sm"
            type="datetime-local"
            value={remind}
            min={localInput(new Date())}
            aria-label="Remind me at"
            onChange={(e) => setRemind(e.target.value)}
          />
          <span className="d-small d-muted">This becomes the lead’s next step.</span>
        </div>
      )}

      {problem !== null && <p className="d-small d-t-amber">{problem}</p>}

      <div className="v2-ln-div" />

      {/* 4 · Attach, Voice and Remind me on the left; Save note on the
          right. Each of the three carries a word as well as an icon. */}
      <div className="v2-ln-foot">
        <input
          ref={picker}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
          hidden
          onChange={(e) => {
            const chosen = [...(e.target.files ?? [])];
            setStaged((list) => [
              ...list,
              ...chosen.map((file) => {
                const preview = previewOf(file);
                return { blob: file as Blob, name: file.name, ...(preview ? { preview } : {}) };
              }),
            ]);
            /* Cleared, so picking the same file twice in a row still fires. */
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="d-btn v2-ln-tool"
          onClick={() => picker.current?.click()}
        >
          <Icon name="paperclip" size={14} />Attach
        </button>
        {canRecord() && (
          <button
            type="button"
            className={recording ? 'd-btn v2-ln-tool v2-ln-tool-on' : 'd-btn v2-ln-tool'}
            aria-pressed={recording}
            onClick={() => void (recording ? stopRecording() : startRecording())}
          >
            <Icon name="mic" size={14} />{recording ? 'Stop' : 'Voice'}
          </button>
        )}
        <button
          type="button"
          className={remindOpen ? 'd-btn v2-ln-tool v2-ln-tool-on' : 'd-btn v2-ln-tool'}
          aria-pressed={remindOpen}
          disabled={!opportunityId}
          title={opportunityId ? undefined : 'This person has no open lead to be reminded about'}
          onClick={() => {
            setRemindOpen((on) => {
              if (on) setRemind('');
              else if (remind === '') setRemind(localInput(REMIND_SOON[2]?.at() ?? new Date()));
              return !on;
            });
          }}
        >
          <Icon name="bell" size={14} />Remind me
        </button>
        {!compact && <span className="v2-ln-kbd">Ctrl + Enter to save</span>}
        <span className="d-grow" />
        <button
          type="button"
          className="d-btn d-primary v2-ln-save"
          disabled={empty || saving}
          onClick={() => void save()}
        >
          <Icon name="check" size={14} />{saving ? 'Saving…' : 'Save note'}
        </button>
      </div>
    </div>
  );
});

/** What the whole batch is, for the stand-in body when nothing was typed. */
function kindOf(staged: Staged[]): 'voice' | 'image' | 'file' {
  if (staged.some((one) => one.seconds)) return 'voice';
  if (staged.every((one) => one.preview)) return 'image';
  return 'file';
}

/** The three times an agent picks nine times out of ten, and tomorrow. */
const REMIND_SOON: Array<{ label: string; at: () => Date }> = [
  { label: 'In 1 hour', at: () => new Date(Date.now() + 3_600_000) },
  { label: 'Tonight 19:00', at: () => atClock(0, 19) },
  { label: 'Tomorrow 11:00', at: () => atClock(1, 11) },
];

function atClock(daysAhead: number, hour: number): Date {
  const out = new Date();
  out.setDate(out.getDate() + daysAhead);
  out.setHours(hour, 0, 0, 0);
  return out;
}

/** Local wall-clock text for a `datetime-local`, never a UTC ISO string. */
function localInput(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
    + `T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}
