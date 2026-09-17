import { describe, expect, it } from 'vitest';
import {
  byTask, completionDelta, isImage, matchesFilter, negate, presenceDelta, readableSize,
  sortTasks, taskStatus,
} from './tasks.js';
import type { TaskAttachment, TaskRow } from './types.js';

/** 17 September 2026, 14:00 in Dubai — 10:00 UTC. */
const NOW = new Date('2026-09-17T10:00:00Z').getTime();

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1',
    type: 'call',
    title: 'Call the lead',
    notes: null,
    priority: 'normal',
    due_at: '2026-09-17T12:00:00Z',
    completed_at: null,
    contact_id: null,
    opportunity_id: null,
    full_name: null,
    phone_e164: null,
    lead_score: null,
    stage_key: null,
    project_name: null,
    assigned_user_id: 'u1',
    assignee_name: 'Sara',
    ...overrides,
  };
}

describe('what state a task is in', () => {
  it('is done when it has been completed, whatever the clock says', () => {
    // Past its deadline, but closed: done wins over overdue.
    const closed = task({ due_at: '2020-01-01T00:00:00Z', completed_at: '2020-01-02T00:00:00Z' });
    expect(taskStatus(closed, NOW)).toBe('done');
  });

  it('is overdue once the deadline has passed', () => {
    expect(taskStatus(task({ due_at: '2026-09-17T09:59:00Z' }), NOW)).toBe('overdue');
  });

  it('is today when it is still to come later the same Dubai day', () => {
    // 19:00 Dubai, still ahead of 14:00.
    expect(taskStatus(task({ due_at: '2026-09-17T15:00:00Z' }), NOW)).toBe('today');
  });

  /*
   * The case that browser-local bucketing gets wrong: 23:30 Dubai on the 17th
   * is 19:30 UTC on the 17th, so both agree. But 00:30 Dubai on the 18th is
   * 20:30 UTC on the *17th* — still "today" by a UTC reading, and correctly
   * "open" by a Dubai one.
   */
  it('is open, not today, for the small hours of tomorrow', () => {
    expect(taskStatus(task({ due_at: '2026-09-17T20:30:00Z' }), NOW)).toBe('open');
  });

  it('is today right up to the last minute of the Dubai day', () => {
    expect(taskStatus(task({ due_at: '2026-09-17T19:59:00Z' }), NOW)).toBe('today');
  });

  it('is open when it is days away', () => {
    expect(taskStatus(task({ due_at: '2026-09-25T06:00:00Z' }), NOW)).toBe('open');
  });
});

describe('which filter a task belongs under', () => {
  it('counts an overdue task as open too', () => {
    const overdue = task({ due_at: '2026-09-16T06:00:00Z' });
    expect(matchesFilter(overdue, 'overdue', NOW)).toBe(true);
    expect(matchesFilter(overdue, 'open', NOW)).toBe(true);
    expect(matchesFilter(overdue, 'done', NOW)).toBe(false);
  });

  it('keeps a completed task out of open', () => {
    const closed = task({ completed_at: '2026-09-17T09:00:00Z' });
    expect(matchesFilter(closed, 'open', NOW)).toBe(false);
    expect(matchesFilter(closed, 'done', NOW)).toBe(true);
    expect(matchesFilter(closed, 'overdue', NOW)).toBe(false);
  });
});

describe('the filter-chip counts', () => {
  it('adds an overdue task to both overdue and open', () => {
    expect(presenceDelta(task({ due_at: '2026-09-16T06:00:00Z' }), NOW)).toEqual({ open: 1, overdue: 1 });
  });

  it('adds a task due later today to both today and open', () => {
    expect(presenceDelta(task({ due_at: '2026-09-17T15:00:00Z' }), NOW)).toEqual({ open: 1, today: 1 });
  });

  it('adds a future task to open alone', () => {
    expect(presenceDelta(task({ due_at: '2026-09-25T06:00:00Z' }), NOW)).toEqual({ open: 1 });
  });

  it('adds a completed task to done alone', () => {
    expect(presenceDelta(task({ completed_at: '2026-09-17T09:00:00Z' }), NOW)).toEqual({ done: 1 });
  });

  it('moves an overdue task out of overdue and open when it is ticked off', () => {
    const overdue = task({ due_at: '2026-09-16T06:00:00Z' });
    expect(completionDelta(overdue, true, NOW)).toEqual({ open: -1, overdue: -1, done: 1 });
  });

  it('puts it back in both when it is reopened', () => {
    const closed = task({ due_at: '2026-09-16T06:00:00Z', completed_at: '2026-09-17T09:00:00Z' });
    expect(completionDelta(closed, false, NOW)).toEqual({ open: 1, overdue: 1, done: -1 });
  });

  /*
   * Completing and then reopening has to leave the chips exactly where they
   * started. This is the invariant the optimistic revert depends on.
   */
  it('is its own inverse', () => {
    for (const due of ['2026-09-16T06:00:00Z', '2026-09-17T15:00:00Z', '2026-09-25T06:00:00Z']) {
      const row = task({ due_at: due });
      const forward = completionDelta(row, true, NOW);
      expect(negate(forward)).toEqual(completionDelta({ ...row, completed_at: 'x' }, false, NOW));
    }
  });

  it('negates every field', () => {
    expect(negate({ open: 1, overdue: 1, done: -1 })).toEqual({ open: -1, overdue: -1, done: 1 });
  });
});

describe('ordering the list', () => {
  it('puts the soonest deadline first', () => {
    const rows = [
      task({ id: 'c', due_at: '2026-09-19T06:00:00Z' }),
      task({ id: 'a', due_at: '2026-09-17T06:00:00Z' }),
      task({ id: 'b', due_at: '2026-09-18T06:00:00Z' }),
    ];
    expect(sortTasks(rows, 'open').map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts the most recently closed first under Done', () => {
    const rows = [
      task({ id: 'a', completed_at: '2026-09-15T06:00:00Z' }),
      task({ id: 'b', completed_at: '2026-09-17T06:00:00Z' }),
    ];
    expect(sortTasks(rows, 'done').map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('does not mutate what it was given', () => {
    const rows = [task({ id: 'b', due_at: '2026-09-19T06:00:00Z' }), task({ id: 'a' })];
    sortTasks(rows, 'open');
    expect(rows.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('attachments', () => {
  const file = (id: string, taskId: string, type = 'image/png'): TaskAttachment => ({
    id,
    task_id: taskId,
    filename: `${id}.png`,
    content_type: type,
    byte_size: 1024,
    created_at: '2026-09-17T06:00:00Z',
  });

  it('groups a flat list by task', () => {
    const grouped = byTask([file('a', 't1'), file('b', 't2'), file('c', 't1')]);
    expect(grouped.get('t1')?.map((f) => f.id)).toEqual(['a', 'c']);
    expect(grouped.get('t2')?.map((f) => f.id)).toEqual(['b']);
    expect(grouped.get('t3')).toBeUndefined();
  });

  it('knows which files have a picture to show', () => {
    expect(isImage('image/jpeg')).toBe(true);
    expect(isImage('application/pdf')).toBe(false);
  });

  it('writes sizes the way a person reads them', () => {
    expect(readableSize(512)).toBe('512 B');
    expect(readableSize(2048)).toBe('2 KB');
    expect(readableSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
