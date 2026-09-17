import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatDateTime, humanize } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import { type CalendarView, rangeFor } from '../lib/calendar.js';
import {
  PRIORITY_COLOUR, STATUS_LABEL, STATUS_PILL, attachmentUrl, byTask, completionDelta, isImage,
  matchesFilter, negate, presenceDelta, readableSize, sortTasks, taskStatus, uploadAttachment,
} from '../lib/tasks.js';
import type {
  TaskAttachment, TaskCalendarResponse, TaskCounts, TaskDraft, TaskFilter, TaskRow, TaskScope,
  TasksResponse, UserRow,
} from '../lib/types.js';
import { TaskCalendar } from '../components/TaskCalendar.js';
import { TaskModal, type TaskSubmit } from '../components/TaskModal.js';
import { Icon, type IconName } from '../design/index.js';
import { stageStyle } from '../design/stages.js';
import {
  Avatar, Chip, Empty, ErrorNote, Panel, Score, Seg, Spinner, Toolbar, useNow, useToast,
} from '../design/ui.js';

const TYPE_ICON: Record<TaskRow['type'], IconName> = {
  call: 'phone',
  whatsapp: 'message-circle',
  email: 'mail',
  meeting: 'calendar-check',
  other: 'check-square',
};

const FILTERS: { value: TaskFilter; label: string }[] = [
  { value: 'overdue', label: t('overdue') },
  { value: 'today', label: t('today') },
  { value: 'open', label: t('open') },
  { value: 'done', label: t('done') },
];

const EMPTY_COUNTS: TaskCounts = { overdue: 0, today: 0, open: 0, done: 0 };

/**
 * The working list: what Workflows A and B asked for, plus whatever agents add
 * themselves. Overdue leads the order because a call task that has slipped is
 * the single clearest way a lead goes cold.
 *
 * Every change here is applied to the screen first and sent afterwards. An
 * agent ticking off six calls between appointments should never wait on a
 * round-trip, and if one fails the row goes back exactly as it was with a
 * message saying so — which is the half of "optimistic" that is easy to skip
 * and the only half that makes it safe.
 */
export function Tasks() {
  const { user } = useAuth();
  const toast = useToast();
  const now = useNow(60_000);

  const [mode, setMode] = useState<'list' | 'calendar'>('list');
  const [filter, setFilter] = useState<TaskFilter>('overdue');
  const [scope, setScope] = useState<TaskScope>('mine');
  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';

  const list = useAsync<TasksResponse>(
    () => api.get(`/api/tasks${qs({ scope, filter })}`),
    [scope, filter],
  );

  // Recomputed rather than stored: the range is a function of the view and the
  // day being looked at, and deriving it twice is how the two drift apart.
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const calendar = useAsync<TaskCalendarResponse>(
    () =>
      mode === 'calendar'
        ? api.get(`/api/tasks/calendar${qs({ ...range, scope })}`)
        : Promise.resolve({ items: [], attachments: [] }),
    [mode, range.from, range.to, scope],
  );

  // Only managers may list the team, and only they may assign to someone else.
  const team = useAsync<{ items: UserRow[] }>(
    () => (isManager ? api.get('/api/users') : Promise.resolve({ items: [] })),
    [isManager],
  );

  const items = list.data?.items ?? [];
  const counts = list.data?.counts ?? EMPTY_COUNTS;
  const files = useMemo(
    () => byTask([...(list.data?.attachments ?? []), ...(calendar.data?.attachments ?? [])]),
    [list.data?.attachments, calendar.data?.attachments],
  );

  /**
   * Apply a change to both loaded lists at once.
   *
   * The same task can be on screen twice — in the list and in a calendar cell —
   * and a completion that updated only one of them would look like a bug.
   */
  const patchEverywhere = useCallback(
    (taskId: string, change: (task: TaskRow) => TaskRow | null) => {
      list.setData((current) =>
        current
          ? {
              ...current,
              items: current.items.flatMap((task) => {
                if (task.id !== taskId) return [task];
                const next = change(task);
                return next ? [next] : [];
              }),
            }
          : current,
      );
      calendar.setData((current) =>
        current
          ? {
              ...current,
              items: current.items.flatMap((task) => {
                if (task.id !== taskId) return [task];
                const next = change(task);
                return next ? [next] : [];
              }),
            }
          : current,
      );
    },
    [list, calendar],
  );

  /** Counts are shown on the filter chips, so they move with the rows. */
  const shiftCounts = useCallback(
    (change: Partial<TaskCounts>) => {
      list.setData((current) =>
        current
          ? {
              ...current,
              counts: {
                overdue: Math.max(0, current.counts.overdue + (change.overdue ?? 0)),
                today: Math.max(0, current.counts.today + (change.today ?? 0)),
                open: Math.max(0, current.counts.open + (change.open ?? 0)),
                done: Math.max(0, current.counts.done + (change.done ?? 0)),
              },
            }
          : current,
      );
    },
    [list],
  );

  /* ── Complete / reopen ────────────────────────────────────────────────── */

  async function toggle(task: TaskRow) {
    const done = Boolean(task.completed_at);
    const before = task.completed_at;
    const delta = completionDelta(task, !done, now);

    // On screen first.
    setBusy(task.id);
    patchEverywhere(task.id, (row) => ({ ...row, completed_at: done ? null : new Date().toISOString() }));
    shiftCounts(delta);

    try {
      await api.post(`/api/tasks/${task.id}/${done ? 'reopen' : 'complete'}`);
    } catch (err) {
      // Put it back exactly as it was — the same delta, negated, so the chips
      // cannot drift out of step with the rows they are counting.
      patchEverywhere(task.id, (row) => ({ ...row, completed_at: before }));
      shiftCounts(negate(delta));
      toast(err instanceof Error ? err.message : 'Could not update the task');
    } finally {
      setBusy(null);
    }
  }

  /* ── Create and edit ──────────────────────────────────────────────────── */

  /** Provisional ids, so a row can appear before the server has named it. */
  const tempId = useRef(0);

  async function submit({ draft, files: picked }: TaskSubmit) {
    setSaving(true);
    try {
      if (editing) {
        const before = editing;
        patchEverywhere(editing.id, (row) => ({
          ...row,
          title: draft.title,
          notes: draft.notes,
          type: draft.type,
          priority: draft.priority,
          due_at: draft.dueAt,
          assigned_user_id: draft.assignedUserId,
          assignee_name: nameOf(draft.assignedUserId, team.data?.items, row.assignee_name),
        }));
        setEditing(null);

        try {
          await api.patch(`/api/tasks/${before.id}`, draft);
        } catch (err) {
          patchEverywhere(before.id, () => before);
          throw err;
        }

        if (picked.length > 0) await attach(before.id, picked);
        toast('Task updated');
      } else {
        const provisional = `new-${(tempId.current += 1)}`;
        const row = draftRow(provisional, draft, user?.id ?? null, nameOf(draft.assignedUserId, team.data?.items, user?.name ?? null));

        // Straight onto the list, in the right place, before the request goes.
        list.setData((current) =>
          current && matchesFilter(row, filter, now)
            ? { ...current, items: sortTasks([...current.items, row], filter) }
            : current,
        );
        const delta = presenceDelta(row, now);
        shiftCounts(delta);
        setAdding(false);

        let id: string;
        try {
          ({ id } = await api.post<{ id: string }>('/api/tasks', draft));
        } catch (err) {
          patchEverywhere(provisional, () => null);
          shiftCounts(negate(delta));
          throw err;
        }

        // Swap the provisional id for the real one, so the row can be edited,
        // completed or deleted straight away without a reload.
        patchEverywhere(provisional, (task) => ({ ...task, id }));
        if (picked.length > 0) await attach(id, picked);
        toast('Task added');
      }
      // The calendar's window may now contain (or no longer contain) this task.
      if (mode === 'calendar') calendar.reload();
    } finally {
      setSaving(false);
    }
  }

  /** Upload the files picked in the form, once the task has an id. */
  async function attach(taskId: string, picked: File[]) {
    const uploaded: TaskAttachment[] = [];
    for (const file of picked) {
      try {
        uploaded.push(await uploadAttachment(taskId, file));
      } catch (err) {
        // The task itself is saved; one rejected file should not undo that.
        toast(err instanceof Error ? err.message : `Could not attach ${file.name}`);
      }
    }
    if (uploaded.length === 0) return;
    list.setData((current) =>
      current ? { ...current, attachments: [...current.attachments, ...uploaded] } : current,
    );
  }

  async function removeAttachment(file: TaskAttachment) {
    list.setData((current) =>
      current ? { ...current, attachments: current.attachments.filter((a) => a.id !== file.id) } : current,
    );
    try {
      await api.del(`/api/tasks/attachments/${file.id}`);
    } catch (err) {
      list.setData((current) =>
        current ? { ...current, attachments: [...current.attachments, file] } : current,
      );
      toast(err instanceof Error ? err.message : 'Could not remove the file');
    }
  }

  async function remove(task: TaskRow) {
    if (!window.confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    patchEverywhere(task.id, () => null);
    shiftCounts(negate(presenceDelta(task, now)));
    setEditing(null);
    try {
      await api.del(`/api/tasks/${task.id}`);
      toast('Task deleted');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete the task');
      list.reload();
      if (mode === 'calendar') calendar.reload();
    }
  }

  if (list.error && mode === 'list') return <ErrorNote>{list.error}</ErrorNote>;

  return (
    <>
      <Toolbar
        right={
          <>
            {isManager && (
              <>
                <Chip on={scope === 'mine'} icon="user" onClick={() => setScope('mine')}>
                  Mine
                </Chip>
                <Chip on={scope === 'team'} icon="users" onClick={() => setScope('team')}>
                  {t('team')}
                </Chip>
              </>
            )}
            <Seg
              value={mode}
              onChange={setMode}
              options={[
                { value: 'list' as const, label: 'List' },
                { value: 'calendar' as const, label: 'Calendar' },
              ]}
            />
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={15} />
              Add task
            </button>
          </>
        }
      >
        {mode === 'list' &&
          FILTERS.map((option) => (
            <Chip key={option.value} on={filter === option.value} onClick={() => setFilter(option.value)}>
              {option.label}
              {counts[option.value] > 0 && (
                <span className="n" style={{ marginInlineStart: 6, opacity: 0.75 }}>
                  {counts[option.value]}
                </span>
              )}
            </Chip>
          ))}
      </Toolbar>

      {mode === 'calendar' ? (
        <Panel index={1} icon="calendar-days" title="Calendar">
          {calendar.error ? (
            <ErrorNote>{calendar.error}</ErrorNote>
          ) : (
            <TaskCalendar
              view={view}
              anchor={anchor}
              tasks={calendar.data?.items ?? []}
              loading={calendar.loading}
              onView={setView}
              onAnchor={setAnchor}
              onOpen={setEditing}
            />
          )}
        </Panel>
      ) : (
        <Panel index={1} icon="check-square" title={`${humanize(filter)} tasks`}>
          {list.loading && items.length === 0 && <Spinner />}
          {!list.loading && items.length === 0 && (
            <Empty
              icon="check-circle-2"
              title={filter === 'overdue' ? 'Nothing overdue' : 'Nothing here'}
              hint={filter === 'overdue' ? 'Every follow-up is on time.' : 'Try another filter, or add a task.'}
            />
          )}

          {items.map((task) => (
            <Row
              key={task.id}
              task={task}
              attachments={files.get(task.id) ?? []}
              scope={scope}
              now={now}
              busy={busy === task.id}
              onToggle={() => void toggle(task)}
              onEdit={() => setEditing(task)}
            />
          ))}
        </Panel>
      )}

      <TaskModal
        open={adding || editing !== null}
        task={editing}
        attachments={editing ? files.get(editing.id) ?? [] : []}
        team={team.data?.items ?? []}
        busy={saving}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSubmit={submit}
        onRemoveAttachment={editing ? (file) => void removeAttachment(file) : undefined}
        onDelete={editing ? () => void remove(editing) : undefined}
      />
    </>
  );
}

/* ── One row ──────────────────────────────────────────────────────────────── */

/**
 * A single task card.
 *
 * Split out and memo-free but cheap: the whole list re-renders on every
 * optimistic change, and a row that does real work in render would make ticking
 * off a task feel heavier than it is.
 */
function Row({
  task, attachments, scope, now, busy, onToggle, onEdit,
}: {
  task: TaskRow;
  attachments: TaskAttachment[];
  scope: TaskScope;
  now: number;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const status = taskStatus(task, now);
  const done = Boolean(task.completed_at);

  return (
    <div className="task" style={{ alignItems: 'flex-start', padding: '12px' }}>
      <button
        type="button"
        className="icon-btn"
        style={{ width: 30, height: 30, borderRadius: 9 }}
        onClick={onToggle}
        disabled={busy}
        aria-label={done ? 'Reopen this task' : 'Mark this task done'}
      >
        <Icon name={done ? 'check-circle-2' : 'circle'} size={16} />
      </button>

      <div className="task-main">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Icon name={TYPE_ICON[task.type]} size={15} style={{ color: PRIORITY_COLOUR[task.priority] }} />
          <b style={{ textDecoration: done ? 'line-through' : undefined }}>{task.title}</b>
          {(task.priority === 'urgent' || task.priority === 'high') && (
            <span className={task.priority === 'urgent' ? 'pill due' : 'pill wait'}>
              {task.priority === 'urgent' ? 'Urgent' : 'High'}
            </span>
          )}
          {task.stage_key && (
            <span className="pill" style={{ color: stageStyle(task.stage_key).colour, borderColor: 'transparent' }}>
              {humanize(task.stage_key)}
            </span>
          )}
        </div>

        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
          {task.contact_id ? (
            <Link to={`/contacts/${task.contact_id}`} className="rowbtn">
              {task.full_name ?? 'Contact'}
            </Link>
          ) : (
            'No contact'
          )}
          {task.project_name ? ` · ${task.project_name}` : ''}
          {` · due ${formatDateTime(task.due_at)}`}
        </div>

        {task.notes && (
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            {task.notes}
          </p>
        )}

        {attachments.length > 0 && (
          <div className="thumbs">
            {attachments.map((file) => (
              <a
                key={file.id}
                className={isImage(file.content_type) ? 'thumb' : 'thumb file'}
                href={attachmentUrl(file.id)}
                target="_blank"
                rel="noreferrer"
                title={`${file.filename} · ${readableSize(file.byte_size)}`}
              >
                {isImage(file.content_type) ? (
                  <img src={attachmentUrl(file.id)} alt={file.filename} loading="lazy" />
                ) : (
                  <>
                    <Icon name="file-text" size={16} />
                    <small>{file.filename}</small>
                  </>
                )}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Grouped, so the phone layout can drop the whole set onto its own row
          rather than letting flex squeeze them in between the text. */}
      <div className="task-side">
        {task.lead_score !== null && <Score value={task.lead_score} />}
        {task.phone_e164 && (
          <a className="icon-btn" href={`tel:${task.phone_e164}`} aria-label={`Call ${task.full_name ?? ''}`}>
            <Icon name="phone" />
          </a>
        )}
        {task.contact_id && (
          <Link className="icon-btn" to={`/inbox?contact=${task.contact_id}`} aria-label="Open the conversation">
            <Icon name="message-circle" />
          </Link>
        )}
        <button type="button" className="icon-btn" onClick={onEdit} aria-label={`Edit ${task.title}`}>
          <Icon name="pencil" />
        </button>
        {scope !== 'mine' && <Avatar name={task.assignee_name} size={26} />}
        <span className={STATUS_PILL[status]}>{STATUS_LABEL[status]}</span>
      </div>
    </div>
  );
}

/* ── Small helpers ────────────────────────────────────────────────────────── */

function nameOf(userId: string | null, team: UserRow[] | undefined, fallback: string | null): string | null {
  if (!userId) return null;
  return team?.find((person) => person.id === userId)?.name ?? fallback;
}

/** A provisional row, shaped like one the server would send. */
function draftRow(id: string, draft: TaskDraft, actorId: string | null, assigneeName: string | null): TaskRow {
  return {
    id,
    type: draft.type,
    title: draft.title,
    notes: draft.notes,
    priority: draft.priority,
    due_at: draft.dueAt,
    completed_at: null,
    contact_id: draft.contactId ?? null,
    opportunity_id: draft.opportunityId ?? null,
    full_name: null,
    phone_e164: null,
    lead_score: null,
    stage_key: null,
    project_name: null,
    assigned_user_id: draft.assignedUserId ?? actorId,
    assignee_name: assigneeName,
  };
}
