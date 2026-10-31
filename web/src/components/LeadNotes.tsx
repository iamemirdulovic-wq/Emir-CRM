import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { relativeTime, formatDateTime } from '../lib/format.js';
import { Button, IconButton, WhenField } from '../design/forms.js';
import { Icon } from '../design/index.js';
import { Chip, Empty, Spinner, TextArea, useToast } from '../design/ui.js';
import { readableSize } from '../lib/tasks.js';
import { byNote, uploadNoteFile, voiceFilename, type NoteFile } from '../lib/note-files.js';
import { VoiceRecorder, canRecord, formatDuration } from '../lib/recorder.js';

/**
 * Notes on a lead.
 *
 * Replaces a single shared text column that nobody could attribute, correct
 * or search. The pinned ones stay at the top for good — the budget the client
 * actually said, the objection they raised, the fact that they cannot talk
 * before six — and everything else is history that stays out of the way.
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

const TYPES: [string, string, string][] = [
  ['general', '📝', 'Note'],
  ['call_summary', '📞', 'Call'],
  ['viewing_feedback', '🏠', 'Viewing'],
  ['budget', '💰', 'Budget'],
  ['objection', '⚠️', 'Objection'],
  ['next_step', '✅', 'Next step'],
];

/** Phrases an agent writes ten times a day, as one tap each. */
const QUICK = [
  'Client wants 2 BR',
  'Send the payment plan',
  'Call after 6pm',
  'Cash buyer',
  'Needs a mortgage',
  'Wants a sea view',
];

export function LeadNotes({
  contactId, opportunityId, enquiryNote, onLeadChanged,
}: {
  contactId: string;
  opportunityId: string | null;
  /**
   * Called when saving a note also moved the lead, so the page can redraw the
   * stage. Without it the card behind the panel still says New Lead and the
   * agent has to reload to believe the toast.
   */
  onLeadChanged?: () => void;
  /**
   * What the client themselves typed into the ad form. It arrives with the
   * lead and has never been shown on this page — which is a waste, because it
   * is the only thing on the record in the client's own words.
   */
  enquiryNote?: string | null;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const notes = useAsync<{ items: Note[]; files: NoteFile[] }>(
    () => api.get(`/api/notes/${contactId}`),
    [contactId],
  );

  const [body, setBody] = useState('');
  const [type, setType] = useState('general');
  const [remind, setRemind] = useState('');
  const [showRemind, setShowRemind] = useState(false);
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  /* Staged, not uploaded: a file has nothing to attach to until the note
     exists, and uploading before Save would leave orphans behind every
     abandoned draft. */
  const [staged, setStaged] = useState<Array<{ blob: Blob; name: string; seconds?: number }>>([]);
  const picker = useRef<HTMLInputElement>(null);

  const recorder = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  /* A recording left running holds the microphone and keeps the browser's
     recording dot lit, so leaving the page stops it. */
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
    if (!active) return;
    try {
      const result = await active.stop();
      setStaged((list) => [
        ...list,
        { blob: result.blob, name: voiceFilename(result.mimeType), seconds: result.seconds },
      ]);
    } catch {
      toast('The recording did not save');
    } finally {
      recorder.current = null;
    }
  }

  const save = useCallback(async () => {
    const text = body.trim();
    /* A voice note is the whole note: requiring words as well would mean
       typing, which is the thing the recording exists to avoid. */
    if (!text && staged.length === 0) return;
    setSaving(true);
    try {
      const created = await api.post<{ id: string; movedStage: { to: string } | null }>(`/api/notes/${contactId}`, {
        body: text || (staged.some((item) => item.seconds) ? '🎤 Voice note' : '📎 Attachment'),
        type,
        opportunityId,
        ...(remind ? { remindAt: remind } : {}),
      });

      /* One at a time rather than all at once: these are phone uploads on a
         car's signal, and ten parallel requests is how they all fail. */
      for (const item of staged) {
        await uploadNoteFile(created.id, item.blob, {
          filename: item.name,
          durationSeconds: item.seconds ?? null,
        }).catch((err: unknown) => {
          toast(err instanceof ApiError ? err.message : `${item.name} did not upload`);
        });
      }

      setStaged([]);
      setBody('');
      setRemind('');
      setShowRemind(false);
      setType('general');
      notes.reload();

      /*
       * The note moved the lead, so say so. A stage that changes silently
       * under an agent is one they stop trusting — and the first time they
       * notice is in a report that disagrees with their memory.
       */
      if (created.movedStage) {
        onLeadChanged?.();
        toast(remind ? 'Noted — moved to Attempted Contact, and you will be reminded'
          : 'Noted — moved to Attempted Contact');
      } else {
        toast(remind ? 'Noted, and you will be reminded' : 'Noted');
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not save');
    } finally {
      setSaving(false);
    }
  }, [body, type, remind, staged, contactId, opportunityId, notes, toast]);

  async function patch(note: Note, change: Record<string, unknown>) {
    await api.patch(`/api/notes/item/${note.id}`, change).catch(() => undefined);
    notes.reload();
  }

  async function remove(note: Note) {
    await patch(note, { deleted: true });
    toast('Note deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          void api.post(`/api/notes/item/${note.id}/restore`).then(() => notes.reload());
        },
      },
    });
  }

  const items = notes.data?.items ?? [];
  const filesByNote = byNote(notes.data?.files ?? []);

  return (
    <div className="notes">
      {enquiryNote && (
        <div className="note-enquiry">
          <div className="note-enquiry-head">
            <Icon name="quote" size={13} />
            What they wrote on the form
          </div>
          <p dir="auto">{enquiryNote}</p>
        </div>
      )}

      <div className="note-compose">
        <TextArea
          ref={field}
          rows={2}
          placeholder="Write a note… use @name to tag someone"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            /* Enter saves, Shift+Enter is a new line — the way every chat
               box works, which is what an agent's hands expect. */
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void save();
            }
          }}
        />

        <div className="note-types">
          {TYPES.map(([value, emoji, label]) => (
            <Chip key={value} on={type === value} onClick={() => setType(value)}>
              <span aria-hidden>{emoji}</span> {label}
            </Chip>
          ))}
        </div>

        <div className="note-quick">
          {QUICK.map((phrase) => (
            <button
              key={phrase}
              type="button"
              className="note-quick-btn"
              onClick={() => {
                setBody((current) => (current ? `${current.trimEnd()}\n${phrase}` : phrase));
                field.current?.focus();
              }}
            >
              {phrase}
            </button>
          ))}
        </div>

        {staged.length > 0 && (
          <ul className="note-staged">
            {staged.map((item, index) => (
              <li key={`${item.name}-${index}`}>
                <Icon name={item.seconds ? 'mic' : 'paperclip'} size={13} />
                <span className="note-staged-name">{item.name}</span>
                <small>{item.seconds ? formatDuration(item.seconds) : readableSize(item.blob.size)}</small>
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => setStaged((list) => list.filter((_, i) => i !== index))}
                >
                  <Icon name="x" size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {recording && (
          /* The timer is the point: without it nobody knows whether the
             microphone actually started, and they record silence. */
          <div className="note-recording" role="status">
            <span className="note-rec-dot" aria-hidden />
            Recording · {formatDuration(elapsed)}
            <button type="button" className="btn btn-primary" onClick={() => void stopRecording()}>
              <Icon name="square" size={13} /> Stop
            </button>
          </div>
        )}

        {showRemind && (
          <div className="note-remind">
            <WhenField value={remind} onChange={setRemind} />
            <small>This becomes the lead’s next step.</small>
          </div>
        )}

        <div className="note-actions">
          <input
            ref={picker}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            hidden
            onChange={(event) => {
              const chosen = Array.from(event.target.files ?? []);
              setStaged((list) => [...list, ...chosen.map((f) => ({ blob: f, name: f.name }))]);
              /* Cleared, so picking the same file twice in a row still fires. */
              event.target.value = '';
            }}
          />
          <IconButton
            icon="paperclip"
            label="Attach a photo or PDF"
            onClick={() => picker.current?.click()}
          />
          {canRecord() && (
            <IconButton
              icon="mic"
              label={recording ? 'Stop recording' : 'Record a voice note'}
              className={recording ? 'on' : undefined}
              onClick={() => void (recording ? stopRecording() : startRecording())}
            />
          )}
          <button
            type="button"
            className={showRemind ? 'chip on' : 'chip'}
            onClick={() => setShowRemind((on) => !on)}
            disabled={!opportunityId}
            title={opportunityId ? undefined : 'This lead has no open enquiry to remind about'}
          >
            <Icon name="alarm-clock" size={14} />
            Remind me
          </button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!body.trim() && staged.length === 0}
            onClick={() => void save()}
          >
            Save note
          </Button>
        </div>
      </div>

      {!notes.data && <Spinner />}
      {notes.data && items.length === 0 && (
        <Empty
          icon="sticky-note"
          title="No notes yet"
          hint="What the client actually said is worth more in a month than any field on this page."
        />
      )}

      <ul className="note-list">
        {items.map((note) => {
          const mine = note.author_id === user?.id;
          const label = TYPES.find(([value]) => value === note.type);
          return (
            <li key={note.id} className={note.pinned ? 'lead-note pinned' : 'lead-note'}>
              <div className="note-head">
                {note.pinned === 1 && <Icon name="pin" size={13} />}
                <b>{note.author_name ?? 'Someone'}</b>
                {label && <span className={`note-tag t-${note.type}`}>{label[1]} {label[2]}</span>}
                <time dateTime={note.created_at} title={formatDateTime(note.created_at)}>
                  {relativeTime(note.created_at)}
                </time>
                {note.edited_at && <small className="muted">edited</small>}
              </div>

              <p className="note-body" dir="auto">{note.body}</p>

              <NoteFiles files={filesByNote.get(note.id) ?? []} />

              <div className="note-row-actions">
                <button type="button" onClick={() => void patch(note, { pinned: note.pinned !== 1 })}>
                  {note.pinned === 1 ? 'Unpin' : 'Pin'}
                </button>
                {/* Only the author or the owner; the server enforces it too. */}
                {(mine || user?.role === 'owner') && (
                  <button type="button" className="danger" onClick={() => void remove(note)}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * What a note carries.
 *
 * A voice note plays here rather than downloading: the whole point is that it
 * takes one tap to hear what the client said, and a file in the downloads
 * folder is not that.
 */
function NoteFiles({ files }: { files: NoteFile[] }) {
  if (files.length === 0) return null;

  return (
    <div className="note-files">
      {files.map((file) => (
        file.kind === 'voice' ? (
          <div className="note-voice" key={file.id}>
            <Icon name="mic" size={14} />
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls preload="none" src={`/api/notes/files/${file.id}`} />
            <small>{formatDuration(file.duration_s)}</small>
          </div>
        ) : file.content_type.startsWith('image/') ? (
          <a
            className="note-thumb"
            key={file.id}
            href={`/api/notes/files/${file.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <img src={`/api/notes/files/${file.id}`} alt={file.filename} loading="lazy" />
          </a>
        ) : (
          <a
            className="note-file"
            key={file.id}
            href={`/api/notes/files/${file.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="file-text" size={14} />
            <span>{file.filename}</span>
            <small>{readableSize(file.byte_size)}</small>
          </a>
        )
      ))}
    </div>
  );
}
