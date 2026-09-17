/**
 * Shared task helpers: what the list, the calendar and the form all need.
 */
import { ApiError } from './api.js';
import { civil, dayKeyOfInstant } from './calendar.js';
import type { TaskAttachment, TaskCounts, TaskRow } from './types.js';

/**
 * The four states the toolbar filters on.
 *
 * Only `done` is stored. The other three are a reading of the clock against
 * `due_at`, which is why the form has no status dropdown to set them with: a
 * task is not overdue because somebody marked it overdue, and offering a menu
 * that pretended otherwise would just be a second, lying copy of the due date.
 */
export type TaskStatus = 'done' | 'overdue' | 'today' | 'open';

export function taskStatus(task: TaskRow, now: number = Date.now()): TaskStatus {
  if (task.completed_at) return 'done';
  const due = new Date(task.due_at).getTime();
  if (due < now) return 'overdue';
  if (dayKeyOfInstant(task.due_at) === dayKeyOfInstant(new Date(now))) return 'today';
  return 'open';
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  done: 'Done',
  overdue: 'Overdue',
  today: 'Today',
  open: 'Open',
};

/** The pill class each status wears, borrowed from the stage colours. */
export const STATUS_PILL: Record<TaskStatus, string> = {
  done: 'pill ok',
  overdue: 'pill due',
  today: 'pill wait',
  open: 'pill',
};

/** Priority drives the coloured edge on a calendar chip and the pill on a card. */
export const PRIORITY_COLOUR: Record<TaskRow['priority'], string> = {
  urgent: 'var(--hot)',
  high: '#C4A172',
  normal: 'var(--primary)',
  low: 'var(--ink-3)',
};

export const PRIORITIES: { value: TaskRow['priority']; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export const TASK_TYPES: { value: TaskRow['type']; label: string }[] = [
  { value: 'call', label: 'Call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'other', label: 'Other' },
];

/* ── Attachments ────────────────────────────────────────────────────────── */

/** What the server will accept. Kept in step with `ALLOWED` in attachments.ts. */
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';

export function isImage(contentType: string): boolean {
  return contentType.startsWith('image/');
}

export function attachmentUrl(id: string): string {
  return `/api/tasks/attachments/${id}`;
}

/**
 * Upload one file.
 *
 * The body is the file itself with its name in a header, matching the import
 * upload — no multipart parser on either side, and nothing buffers the request
 * twice. `fetch` is used directly rather than through `api` because that
 * wrapper is built for JSON.
 */
export async function uploadAttachment(taskId: string, file: File): Promise<TaskAttachment> {
  const response = await fetch(`/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': file.type,
      // A filename can hold anything, including newlines, which would split the
      // header. Encoded here and read back as one value on the server.
      'X-Filename': encodeURIComponent(file.name).slice(0, 255),
    },
    body: file,
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(response.status, error?.code ?? 'error', error?.message ?? 'Upload failed');
  }
  return payload as TaskAttachment;
}

export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Group a flat attachment list by the task it belongs to. */
export function byTask(attachments: TaskAttachment[]): Map<string, TaskAttachment[]> {
  const out = new Map<string, TaskAttachment[]>();
  for (const item of attachments) {
    const bucket = out.get(item.task_id);
    if (bucket) bucket.push(item);
    else out.set(item.task_id, [item]);
  }
  return out;
}

/* ── Ordering ───────────────────────────────────────────────────────────── */

/**
 * Where a task belongs in the list.
 *
 * The server returns them ordered, but an optimistic edit happens before the
 * server has seen it — so the same ordering has to exist on the client, or a
 * task you just rescheduled would sit in the wrong place until the next reload
 * and look like the edit had failed.
 */
export function sortTasks(items: TaskRow[], filter: string): TaskRow[] {
  const key = (task: TaskRow) =>
    filter === 'done'
      ? -new Date(task.completed_at ?? task.due_at).getTime()
      : new Date(task.due_at).getTime();
  return [...items].sort((a, b) => key(a) - key(b));
}

/** Does this task still belong under the filter that is showing? */
export function matchesFilter(task: TaskRow, filter: string, now: number = Date.now()): boolean {
  const status = taskStatus(task, now);
  if (filter === 'done') return status === 'done';
  if (filter === 'open') return status !== 'done';
  return status === filter;
}

/** The hour and minute of a task, for the chip in a calendar cell. */
export function clockOf(task: TaskRow): string {
  const c = civil(new Date(task.due_at));
  return `${String(c.getUTCHours()).padStart(2, '0')}:${String(c.getUTCMinutes()).padStart(2, '0')}`;
}

/* ── Keeping the filter chips honest ────────────────────────────────────── */

/**
 * What the filter chips should show when a task appears or disappears.
 *
 * Every chip is a count of the same rows under a different question, so one
 * task can be in two of them at once — an overdue task is also open. Working
 * that out in one place is what keeps "Overdue 3" honest when the list below
 * it shows four.
 */
export function presenceDelta(task: TaskRow, now: number): Partial<TaskCounts> {
  const status = taskStatus(task, now);
  if (status === 'done') return { done: 1 };
  // overdue and today are both subsets of open.
  return { open: 1, ...(status === 'open' ? {} : { [status]: 1 }) };
}

/** Moving a task between done and not-done: out of one set, into the other. */
export function completionDelta(task: TaskRow, toDone: boolean, now: number): Partial<TaskCounts> {
  // Read the task as it is *now*: an overdue task being ticked off leaves the
  // overdue count as well as the open one.
  const asOpen = presenceDelta({ ...task, completed_at: null }, now);
  return toDone ? { ...negate(asOpen), done: 1 } : { ...asOpen, done: -1 };
}

export function negate(delta: Partial<TaskCounts>): Partial<TaskCounts> {
  return Object.fromEntries(Object.entries(delta).map(([key, value]) => [key, -(value as number)]));
}
