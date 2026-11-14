import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useMaybeAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, useToast } from '../design/ui.js';
import { readableSize } from '../lib/tasks.js';
import { byNote, type NoteFile } from '../lib/note-files.js';
import { formatDuration } from '../lib/recorder.js';
import { plain, RESULT_LABEL, type CallResultLine } from './call-result.js';
import { dayAndClock, stamp } from './CallResultBar.js';
import {
  TYPE_LABEL, TYPE_TONE, isNoteType, looksLikePlaceholder, type NoteType,
} from './note-text.js';
import '../styles/v2-lead-notes.css';

/**
 * The notes on a lead, as they are read back — §F of the owner's list.
 *
 * ── The three things that were wrong ──────────────────────────────────────
 *
 * 1. **A photo showed its file name as the note.** The Files tab writes the
 *    note on the server as `"Photos · IMG_4821.jpg"`, so the list printed the
 *    folder and the file name where the note should be and drew the picture
 *    nowhere. It now draws the picture — a thumbnail that opens larger — and
 *    leaves the stand-in line out. See `looksLikePlaceholder`.
 * 2. **A call result was a note-shaped card.** The list is about to carry
 *    many of them — a lead can be rung five times — and five cards with an
 *    avatar each bury the one note an agent came to read. A result is now one
 *    thin line: the result, the try, who, and the time.
 * 3. **Emoji everywhere.** Six on the type chips, and two more written into
 *    the bodies of every voice note and attachment already in the database.
 *    The chips carry line icons now, and `plain()` cleans what is already
 *    saved on the way to the screen.
 *
 * ── One list, three places ────────────────────────────────────────────────
 *
 * The lead page's Notes tab draws it whole; the quick panel draws the last
 * few with `limit`; the phone draws whichever of those it is on. One
 * component, because "same rules on computer, quick panel, lead page, phone"
 * cannot survive two copies.
 */

interface Note {
  id: string;
  author_id: string | null;
  author_name: string | null;
  type: string;
  body: string;
  pinned: number;
  edited_at: string | null;
  created_at: string;
}

/** A note or a call result, in one list, newest first. */
type RowKind =
  | { kind: 'note'; at: string; note: Note }
  | { kind: 'result'; at: string; line: CallResultLine };

export function LeadNotes({
  contactId, results = [], nextStep, limit, reloadKey = 0, onChanged, compact = false,
}: {
  contactId: string;
  /**
   * The call results to show as thin lines, newest first or in any order.
   * The screen owns them: the lead page reads them out of the timeline it has
   * already fetched, and both screens add the one just saved.
   */
  results?: CallResultLine[];
  /**
   * The lead's next step, so the note that set it can show its reminder.
   * `lead_notes` has no reminder column — saving a note with a reminder
   * writes the lead's `next_step_at` and copies the note's words into
   * `next_step_note` — so the bell is drawn against the note whose words
   * those are, and against no other. Nothing is guessed: a reminder set from
   * the Follow-up dialog has different words and matches nothing here.
   */
  nextStep?: { at: string | null; note: string | null } | null;
  /** The quick panel's "last three". Pinned notes are always shown. */
  limit?: number;
  /** Bumped by the screen when a note has been saved, to re-read the list. */
  reloadKey?: number;
  /** A note was pinned, edited or deleted, so the screen behind is stale. */
  onChanged?: () => void;
  compact?: boolean;
}) {
  /*
   * `useMaybeAuth`, not `useAuth`: this list is rendered inside the quick
   * panel, which is mounted on its own in `lead-panel.test.tsx` with no
   * provider around it. Who is signed in only decides a face instead of
   * initials and whether the "…" menu offers Delete, and neither is worth a
   * crash — the server checks both anyway.
   */
  const user = useMaybeAuth()?.user ?? null;
  const toast = useToast();
  const notes = useAsync<{ items: Note[]; files: NoteFile[] }>(
    () => api.get(`/api/notes/${contactId}`),
    [contactId, reloadKey],
  );
  const [big, setBig] = useState<{ src: string; name: string } | null>(null);

  const items = notes.data?.items ?? [];
  const filesByNote = useMemo(() => byNote(notes.data?.files ?? []), [notes.data]);

  /*
   * Pinned first and for good — that is what pinning is for — then
   * everything else newest first, notes and call results in one stream so
   * "we rang twice and then he said this" reads in the order it happened.
   */
  const pinned = items.filter((one) => one.pinned === 1);
  const rest: RowKind[] = [
    ...items.filter((one) => one.pinned !== 1)
      .map((note) => ({ kind: 'note' as const, at: note.created_at, note })),
    ...results.map((line) => ({ kind: 'result' as const, at: line.at, line })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const shown = typeof limit === 'number' ? rest.slice(0, limit) : rest;

  async function patch(note: Note, change: Record<string, unknown>) {
    await api.patch(`/api/notes/item/${note.id}`, change).catch((err: unknown) => {
      toast(err instanceof Error ? plain(err.message) : 'That did not save.');
    });
    notes.reload();
    onChanged?.();
  }

  async function remove(note: Note) {
    await patch(note, { deleted: true });
    toast('Note deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          void api.post(`/api/notes/item/${note.id}/restore`).then(() => {
            notes.reload();
            onChanged?.();
          });
        },
      },
    });
  }

  if (notes.error) return <p className="d-small d-muted">{plain(notes.error)}</p>;
  if (!notes.data) return <p className="d-small d-muted">Reading the notes…</p>;

  if (pinned.length === 0 && shown.length === 0) {
    return compact
      ? <p className="d-small d-muted">No notes yet. Write the first one after your call.</p>
      : (
        <div className="d-empty">
          <span className="d-ic"><Icon name="sticky-note" size={26} /></span>
          <b>No notes yet</b>
          <p>What the client actually said is worth more in a month than any field on this page.</p>
        </div>
      );
  }

  return (
    <div className="v2-ln-list">
      {[...pinned.map((note) => ({ kind: 'note' as const, at: note.created_at, note })), ...shown]
        .map((row) => (row.kind === 'result'
          ? <ResultLine key={`r-${row.line.id}`} line={row.line} />
          : (
            <NoteRow
              key={row.note.id}
              note={row.note}
              files={filesByNote.get(row.note.id) ?? []}
              mine={row.note.author_id === user?.id}
              myPhoto={row.note.author_id === user?.id ? user?.photoUrl ?? null : null}
              canDelete={row.note.author_id === user?.id || user?.role === 'owner'}
              reminder={reminderFor(row.note, nextStep ?? null)}
              compact={compact}
              onPin={() => void patch(row.note, { pinned: row.note.pinned !== 1 })}
              onEdit={(body) => void patch(row.note, { body })}
              onDelete={() => void remove(row.note)}
              onOpenImage={(file) => setBig({
                src: `/api/notes/files/${file.id}`,
                name: file.filename,
              })}
            />
          )))}

      {big && (
        /* Bigger, when the thumbnail is tapped. A button rather than a div so
           Escape and the keyboard close it like any other overlay. */
        <button
          type="button"
          className="v2-ln-big"
          aria-label="Close the picture"
          onClick={() => setBig(null)}
        >
          <img src={big.src} alt={big.name} />
        </button>
      )}
    </div>
  );
}

/* ── One note ──────────────────────────────────────────────────────────── */

function NoteRow({
  note, files, mine, myPhoto, canDelete, reminder, compact,
  onPin, onEdit, onDelete, onOpenImage,
}: {
  note: Note;
  files: NoteFile[];
  mine: boolean;
  myPhoto: string | null;
  canDelete: boolean;
  reminder: string | null;
  compact: boolean;
  onPin: () => void;
  onEdit: (body: string) => void;
  onDelete: () => void;
  onOpenImage: (file: NoteFile) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const wrap = useRef<HTMLSpanElement>(null);

  /* A menu left open behind a click elsewhere is the sort of thing nobody
     notices in review and everybody notices on a touchscreen. */
  useEffect(() => {
    if (!menu) return undefined;
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setMenu(false);
    };
    window.addEventListener('click', away);
    return () => window.removeEventListener('click', away);
  }, [menu]);

  const type: NoteType = isNoteType(note.type) ? note.type : 'general';
  const tone = TYPE_TONE[type];
  const body = plain(note.body);
  /* The file name is never the note's text — F.2. When the body is one of the
     stand-ins the CRM wrote, the attachment below says it better. */
  const say = looksLikePlaceholder(body, files.map((one) => one.filename)) && files.length > 0
    ? null
    : body;
  const voice = files.find((one) => one.kind === 'voice') ?? null;

  return (
    <div className={note.pinned === 1 ? 'v2-ln-note v2-ln-note-pinned' : 'v2-ln-note'}>
      <span className="v2-ln-note-who">
        {/* The same fallback as the name beside it, so a note whose author
            has been deleted does not read "?" next to "Someone". */}
        <Avatar
          name={note.author_name ?? 'Someone'}
          src={myPhoto ?? undefined}
          size={compact ? 26 : 32}
        />
      </span>

      <div className="v2-ln-note-main">
        <div className="v2-ln-note-top">
          <b>{note.author_name ?? 'Someone'}</b>
          <span className={tone ? `d-chip ${tone}` : 'd-chip'}>{TYPE_LABEL[type]}</span>
          {note.pinned === 1 && (
            <span className="d-chip d-dark"><Icon name="pin" size={11} />Pinned</span>
          )}
          {voice && <span>voice note {formatDuration(voice.duration_s)}</span>}
          {note.edited_at && <span>edited</span>}
          {/* The time and the menu travel together and sit at the right end.
              Loose, the "…" wrapped to a line of its own in the 480px quick
              panel whenever the pills in front of it ran long. */}
          <span className="v2-ln-note-end">
            {/* The real date and the real time, 24 hour, Dubai — F.1. */}
            <time className="v2-ln-note-time" dateTime={note.created_at}>
              {stamp(note.created_at)}
            </time>
            <span className="v2-ln-menu-wrap" ref={wrap}>
              <button
                type="button"
                className="d-btn d-icon d-xs d-ghost"
                aria-label="More on this note"
                onClick={(e) => { e.stopPropagation(); setMenu((on) => !on); }}
              >
                <Icon name="more-horizontal" size={14} />
              </button>
              {menu && (
                <div className="d-menu d-open v2-ln-menu">
                  <button
                    type="button"
                    className="d-menu-item"
                    onClick={() => { setMenu(false); onPin(); }}
                  >
                    <Icon name="pin" size={15} />{note.pinned === 1 ? 'Unpin' : 'Pin'}
                  </button>
                  {/* Only the author, and the server checks it too. */}
                  {mine && (
                    <button
                      type="button"
                      className="d-menu-item"
                      onClick={() => {
                        setMenu(false);
                        setDraft(body);
                        setEditing(true);
                      }}
                    >
                      <Icon name="pencil" size={15} />Edit
                    </button>
                  )}
                  {canDelete && (
                    <>
                      <div className="d-menu-sep" />
                      <button
                        type="button"
                        className="d-menu-item d-danger"
                        onClick={() => { setMenu(false); onDelete(); }}
                      >
                        <Icon name="trash-2" size={15} />Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </span>
          </span>
        </div>

        {editing
          ? (
            <div className="v2-ln-edit">
              <textarea
                className="d-textarea"
                value={draft}
                dir="auto"
                aria-label="The note"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    if (draft.trim() !== '') { onEdit(draft.trim()); setEditing(false); }
                  }
                }}
              />
              <div className="v2-ln-pick-row">
                <span className="v2-ln-kbd d-grow">Ctrl + Enter to save</span>
                <button
                  type="button"
                  className="d-btn d-sm d-ghost"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="d-btn d-sm d-primary"
                  disabled={draft.trim() === ''}
                  onClick={() => { onEdit(draft.trim()); setEditing(false); }}
                >
                  Save
                </button>
              </div>
            </div>
          )
          : say !== null && <p className="v2-ln-note-body" dir="auto">{say}</p>}

        <NoteAttachments files={files} onOpenImage={onOpenImage} />

        {reminder !== null && (
          <div className="v2-ln-bell">
            <Icon name="bell" size={13} />
            Reminder {reminder}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── A call result: one thin line ──────────────────────────────────────── */

/**
 * "No answer · try 2 of 5 · Test Agents · 14 Nov 16:40".
 *
 * No avatar and no menu, which is what the picture draws and what the owner
 * means by "a thin line, not a big card". The try count appears only when the
 * endpoint sent one: a result read back out of the lead's own history has no
 * attempt number stored anywhere, and a number made up here would be read as
 * a fact.
 */
function ResultLine({ line }: { line: CallResultLine }) {
  return (
    <div className="v2-ln-result">
      <span className="v2-ln-result-ic">
        <Icon name={line.result === 'call_back' ? 'calendar-days' : 'phone-off'} size={13} />
      </span>
      <span className="v2-ln-result-grow">
        <span className="v2-ln-result-said">
          {RESULT_LABEL[line.result]}
          {line.tries === null
            ? ''
            : line.maxTries === null
              ? ` · try ${line.tries}`
              : ` · try ${line.tries} of ${line.maxTries}`}
        </span>
        {line.who ? ` · ${line.who}` : ''}
      </span>
      <time dateTime={line.at} className="v2-ln-note-time">{stamp(line.at)}</time>
    </div>
  );
}

/* ── What a note carries ───────────────────────────────────────────────── */

function NoteAttachments({ files, onOpenImage }: {
  files: NoteFile[];
  onOpenImage: (file: NoteFile) => void;
}) {
  if (files.length === 0) return null;

  return (
    <div className="v2-ln-files">
      {files.map((file) => {
        if (file.kind === 'voice') return <VoicePlayer key={file.id} file={file} />;
        if (file.content_type.startsWith('image/')) {
          return (
            <button
              key={file.id}
              type="button"
              className="v2-ln-thumb"
              aria-label={`Open the picture: ${file.filename}`}
              onClick={() => onOpenImage(file)}
            >
              <img src={`/api/notes/files/${file.id}`} alt={file.filename} loading="lazy" />
            </button>
          );
        }
        return (
          <a
            className="v2-ln-file"
            key={file.id}
            href={`/api/notes/files/${file.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="file-text" size={14} />
            <span>{file.filename}</span>
            <small className="d-muted">{readableSize(file.byte_size)}</small>
          </a>
        );
      })}
    </div>
  );
}

/** How many bars the waveform is drawn with — the design's own count. */
const BARS = 54;

/**
 * A voice note: play, a waveform, the length, and the speed.
 *
 * All four, because the owner asked for all four by name. The audio is real —
 * one `<audio>` element, and the bars fill from its own `currentTime`, so the
 * orange is the true position in the recording.
 *
 * **The shape of the bars is decoration, not the sound.** It is the design's
 * own `22 + |sin(i·1.7)·cos(i·0.45)|·78` figure, drawn from the bar's index
 * and nothing else. Reading the real envelope would mean downloading and
 * decoding every voice note on the lead before the page could draw, and a
 * shape invented from the audio would be a claim about it. The length, the
 * position and the speed are all real.
 */
function VoicePlayer({ file }: { file: NoteFile }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [speed, setSpeed] = useState(1);

  const length = file.duration_s ?? 0;
  /*
   * The length the recorder measured wins over the one the `<audio>` element
   * reports. A WebM out of `MediaRecorder` carries no duration in its header
   * and the element answers `Infinity`, or a couple of seconds, until it has
   * played the whole thing through — so trusting the element would print a
   * 47-second note as "0:02" and then correct itself while it played.
   */
  const [heard, setHeard] = useState<number | null>(null);
  const whole = length > 0 ? length : heard;
  const done = whole && whole > 0 ? Math.min(1, at / whole) : 0;

  useEffect(() => {
    const element = audio.current;
    if (element) element.playbackRate = speed;
  }, [speed]);

  const bars = useMemo(
    () => Array.from({ length: BARS }, (_, i) => (
      22 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45)) * 78
    )),
    [],
  );

  function toggle() {
    const element = audio.current;
    if (!element) return;
    if (playing) { element.pause(); return; }
    element.playbackRate = speed;
    void element.play().catch(() => setPlaying(false));
  }

  /** Tapping the waveform moves the playhead, which is what it looks like. */
  function seek(event: ReactMouseEvent<HTMLButtonElement>) {
    const element = audio.current;
    if (!element || !whole) return;
    const box = event.currentTarget.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    element.currentTime = share * whole;
    setAt(element.currentTime);
  }

  return (
    <div className="v2-ln-player">
      <button type="button" className="v2-ln-play" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>
        <Icon name={playing ? 'square' : 'play'} size={14} />
      </button>
      <button
        type="button"
        className="v2-ln-wave"
        aria-label="Move to a point in the recording"
        onClick={seek}
      >
        {bars.map((height, index) => (
          <span
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            aria-hidden
            className={index / BARS < done ? 'v2-ln-wave-bar v2-ln-wave-on' : 'v2-ln-wave-bar'}
            style={{ height: `${height.toFixed(0)}%` }}
          />
        ))}
      </button>
      <span className="v2-ln-len">
        {playing || at > 0
          ? `${formatDuration(Math.round(at))} / ${formatDuration(whole ?? 0)}`
          : formatDuration(whole ?? 0)}
      </span>
      <button
        type="button"
        className="d-btn d-xs v2-ln-speed"
        title="Playback speed"
        onClick={() => setSpeed((was) => (was === 1 ? 1.5 : was === 1.5 ? 2 : 1))}
      >
        {speed}x
      </button>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audio}
        preload="metadata"
        src={`/api/notes/files/${file.id}`}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setAt(0); }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const got = e.currentTarget.duration;
          if (Number.isFinite(got) && got > 0) setHeard(got);
        }}
        style={{ display: 'none' }}
      />
    </div>
  );
}

/* ── The reminder a note carries ───────────────────────────────────────── */

/**
 * "today 15:30", when this note is the one that set the lead's next step.
 *
 * `addNote` copies the note's first 255 characters into `next_step_note` when
 * it is saved with a reminder, and that is the only link between the two
 * rows. So the bell is drawn against the note whose words the next step is,
 * and against nothing else. A next step set from the Follow-up dialog says
 * something different and matches no note, which is correct.
 */
export function reminderFor(
  note: { body: string },
  nextStep: { at: string | null; note: string | null } | null,
): string | null {
  if (!nextStep?.at || !nextStep.note) return null;
  const said = nextStep.note.trim();
  if (said === '') return null;
  if (plain(note.body).slice(0, 255).trim() !== plain(said).slice(0, 255).trim()) return null;
  return dayAndClock(nextStep.at);
}
