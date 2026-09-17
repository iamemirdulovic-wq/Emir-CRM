import { useEffect, useRef, useState } from 'react';
import { fromLocalInput, toLocalInput } from '../lib/calendar.js';
import {
  ACCEPT, PRIORITIES, STATUS_LABEL, STATUS_PILL, TASK_TYPES, attachmentUrl, isImage,
  readableSize, taskStatus, uploadAttachment,
} from '../lib/tasks.js';
import { useAuth } from '../lib/auth.js';
import type { TaskAttachment, TaskDraft, TaskRow, UserRow } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { Field, Input, Modal, Select, TextArea } from '../design/ui.js';

/** A file chosen before the task exists, waiting for an id to be attached to. */
type Pending = { key: string; file: File; preview: string | null };

export type TaskSubmit = {
  draft: TaskDraft;
  /** Files picked in the form. Uploaded once the task has an id. */
  files: File[];
};

/**
 * The Add / Edit task form.
 *
 * One dialog for both, because the fields are identical and two of them would
 * drift apart. What differs is only what happens on save, which the caller owns.
 */
export function TaskModal({
  open, onClose, onSubmit, task, attachments, team, busy, onRemoveAttachment, onDelete,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: TaskSubmit) => Promise<void>;
  /** Null when adding. */
  task: TaskRow | null;
  attachments: TaskAttachment[];
  /** Empty for an agent, who can only give work to themselves. */
  team: UserRow[];
  busy?: boolean;
  onRemoveAttachment?: (attachment: TaskAttachment) => void;
  /** Only when editing. Absent when adding, since there is nothing to delete. */
  onDelete?: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [type, setType] = useState<TaskRow['type']>('call');
  const [priority, setPriority] = useState<TaskRow['priority']>('normal');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Reset every time the dialog opens, so yesterday's half-typed task never
  // reappears over today's.
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setNotes(task?.notes ?? '');
    setType(task?.type ?? 'call');
    setPriority(task?.priority ?? 'normal');
    setDue(toLocalInput(task ? new Date(task.due_at) : defaultDue()));
    setAssignee(task?.assigned_user_id ?? user?.id ?? '');
    setPending([]);
    setError(null);
  }, [open, task, user?.id]);

  // Object URLs are a leak if they are not revoked; this runs on every change
  // of the list and on unmount.
  useEffect(
    () => () => {
      for (const item of pending) if (item.preview) URL.revokeObjectURL(item.preview);
    },
    [pending],
  );

  function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    const accepted = ACCEPT.split(',');
    const next: Pending[] = [];
    for (const file of Array.from(files)) {
      if (!accepted.includes(file.type)) {
        setError(`${file.name} is not an image or PDF, so it cannot be attached.`);
        continue;
      }
      next.push({
        key: `${file.name}:${file.size}:${Math.random().toString(36).slice(2)}`,
        file,
        preview: isImage(file.type) ? URL.createObjectURL(file) : null,
      });
    }
    if (next.length > 0) setPending((current) => [...current, ...next]);
  }

  function drop(event: React.DragEvent) {
    event.preventDefault();
    setOver(false);
    add(event.dataTransfer.files);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const dueAt = fromLocalInput(due);
    if (!title.trim()) {
      setError('Give the task a title.');
      return;
    }
    if (!dueAt) {
      setError('Pick a due date and time.');
      return;
    }
    setError(null);
    try {
      await onSubmit({
        draft: {
          title: title.trim(),
          notes: notes.trim() || null,
          type,
          priority,
          dueAt: dueAt.toISOString(),
          assignedUserId: assignee || null,
          ...(task ? {} : { contactId: null, opportunityId: null }),
        },
        files: pending.map((item) => item.file),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the task');
    }
  }

  const status = task ? taskStatus(task) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? 'Edit task' : 'Add task'}
      icon="check-square"
      footer={
        <>
          {onDelete && (
            <button
              type="button"
              className="btn"
              onClick={onDelete}
              style={{ flex: '0 0 auto', color: 'var(--hot)' }}
              aria-label={`Delete ${task?.title ?? 'this task'}`}
            >
              <Icon name="trash-2" size={15} />
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="task-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : task ? 'Save changes' : 'Add task'}
          </button>
        </>
      }
    >
      <form id="task-form" onSubmit={(event) => void save(event)}>
        {error && (
          <div className="err" style={{ display: 'block', marginBottom: 12 }} role="alert">
            {error}
          </div>
        )}

        <Field label="Title">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Call Ahmed about Emaar Beachfront"
            maxLength={255}
            required
          />
        </Field>

        <Field label="Description" hint="Optional — what needs doing, or what was agreed.">
          <TextArea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={4000}
          />
        </Field>

        <div className="field-row">
          <Field label="Priority">
            <Select value={priority} onChange={(event) => setPriority(event.target.value as TaskRow['priority'])}>
              {PRIORITIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(event) => setType(event.target.value as TaskRow['type'])}>
              {TASK_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="field-row">
          <Field label="Due date and time" hint="Dubai time.">
            <Input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} required />
          </Field>
          {team.length > 0 ? (
            <Field label="Assigned to">
              <Select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
                {team.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.id === user?.id ? ' (you)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Status" hint="Set by the due date; only Done is yours to change.">
              <div style={{ paddingTop: 6 }}>
                <span className={status ? STATUS_PILL[status] : 'pill'}>
                  {status ? STATUS_LABEL[status] : 'Open'}
                </span>
              </div>
            </Field>
          )}
        </div>

        {/* ── Attachments ────────────────────────────────────────────── */}
        <div className="sec-t">Attachments</div>

        {(attachments.length > 0 || pending.length > 0) && (
          <div className="thumbs" style={{ marginBottom: 10 }}>
            {attachments.map((file) => (
              <Thumb
                key={file.id}
                href={attachmentUrl(file.id)}
                src={isImage(file.content_type) ? attachmentUrl(file.id) : null}
                name={file.filename}
                title={`${file.filename} · ${readableSize(file.byte_size)}`}
                onRemove={onRemoveAttachment ? () => onRemoveAttachment(file) : undefined}
              />
            ))}
            {pending.map((item) => (
              <Thumb
                key={item.key}
                src={item.preview}
                name={item.file.name}
                title={`${item.file.name} · not uploaded yet`}
                onRemove={() => setPending((current) => current.filter((p) => p.key !== item.key))}
              />
            ))}
          </div>
        )}

        <div
          className={over ? 'dropzone over' : 'dropzone'}
          onClick={() => picker.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              picker.current?.click();
            }
          }}
        >
          <Icon name="paperclip" size={16} />
          <span style={{ marginInlineStart: 6 }}>Drop a photo or PDF here, or click to choose</span>
        </div>
        <input
          ref={picker}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            add(event.target.files);
            // Cleared so picking the same file twice in a row still fires.
            event.target.value = '';
          }}
        />
      </form>
    </Modal>
  );
}

/** One square: the picture if there is one, the name and an icon if there is not. */
function Thumb({
  src, name, title, href, onRemove,
}: {
  src: string | null;
  name: string;
  title: string;
  href?: string;
  onRemove?: () => void;
}) {
  const inner = src ? (
    <img src={src} alt={name} loading="lazy" />
  ) : (
    <>
      <Icon name="file-text" size={16} />
      <small>{name}</small>
    </>
  );

  return (
    <div className={src ? 'thumb' : 'thumb file'} title={title}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" aria-label={`Open ${name}`} style={{ display: 'contents' }}>
          {inner}
        </a>
      ) : (
        inner
      )}
      {onRemove && (
        <button type="button" className="x" onClick={onRemove} aria-label={`Remove ${name}`}>
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

/**
 * The default deadline for a new task: the next whole hour. Tomorrow morning is
 * too far away for a callback, and "now" is no deadline at all.
 *
 * Rounded on the timestamp rather than with `setHours`, which would round to the
 * whole hour of whatever zone the browser is in — landing on :30 in Dubai for
 * anyone working from India.
 */
function defaultDue(): Date {
  const HOUR = 3600_000;
  return new Date(Math.ceil((Date.now() + 1) / HOUR) * HOUR);
}

export { uploadAttachment };
