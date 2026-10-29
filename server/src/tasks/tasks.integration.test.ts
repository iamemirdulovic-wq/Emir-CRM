import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, execute, prepareTestDatabase, query, resetTables,
} from '../testing/db.js';
import { createTask, deleteTask, listTasks, tasksInRange, updateTask } from '../services/tasks.js';
import { assertCanViewTask } from '../services/task-access.js';
import { attachmentsFor, saveAttachment } from './attachments.js';
import { sweepTaskReminders } from './reminders.js';
import type { AuditActor } from '../audit/audit.js';

const actor = (id: string, role: 'agent' | 'manager' | 'owner' = 'agent'): AuditActor => ({ userId: id, role });
const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

describeWithDb('the task manager', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
  });
  afterAll(async () => {
    await closeTestDatabase();
  });
  beforeEach(async () => {
    await resetTables();
  });

  it('creates a task assigned to whoever made it by default', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const id = await createTask(
      actor(agent.id),
      { title: 'Call the Damac lead back', dueAt: soon(60), priority: 'high' },
      [agent.id],
    );
    const rows = await query<{ assigned_user_id: string; priority: string; created_by_user_id: string }>(
      'SELECT assigned_user_id, priority, created_by_user_id FROM tasks WHERE id = ?', [id],
    );
    expect(rows[0]?.assigned_user_id).toBe(agent.id);
    expect(rows[0]?.created_by_user_id).toBe(agent.id);
    expect(rows[0]?.priority).toBe('high');
  });

  it('will not let an agent put work on a colleague', async () => {
    // The quieter half of this rule: nobody can hide work by assigning it away.
    const mine = await createTestUser({ role: 'agent' });
    const theirs = await createTestUser({ role: 'agent' });
    await expect(
      createTask(actor(mine.id), { title: 'Not mine to give', dueAt: soon(60), assignedUserId: theirs.id }, [mine.id]),
    ).rejects.toThrow(/only assign a task to yourself/i);
  });

  it('lets a manager assign to their team', async () => {
    const manager = await createTestUser({ role: 'manager' });
    const agent = await createTestUser({ role: 'agent', managerId: manager.id });
    const id = await createTask(
      actor(manager.id, 'manager'),
      { title: 'Chase the EOI', dueAt: soon(120), assignedUserId: agent.id },
      [manager.id, agent.id],
    );
    const rows = await query<{ assigned_user_id: string }>('SELECT assigned_user_id FROM tasks WHERE id = ?', [id]);
    expect(rows[0]?.assigned_user_id).toBe(agent.id);
  });

  it('refuses a due date that is not a date', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await expect(
      createTask(actor(agent.id), { title: 'When?', dueAt: 'next tuesday-ish' }, [agent.id]),
    ).rejects.toThrow(/not a real date/i);
  });

  it('clears the reminder when the deadline moves, so the new one still warns', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const id = await createTask(actor(agent.id), { title: 'Slipping', dueAt: soon(10) }, [agent.id]);
    await execute('UPDATE tasks SET reminder_sent_at = NOW(3) WHERE id = ?', [id]);

    await updateTask(actor(agent.id), id, { dueAt: soon(60 * 24 * 7) }, [agent.id]);

    const rows = await query<{ reminder_sent_at: string | null }>(
      'SELECT reminder_sent_at FROM tasks WHERE id = ?', [id],
    );
    expect(rows[0]?.reminder_sent_at).toBeNull();
  });

  it('deletes a task and its attachments together', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const id = await createTask(actor(agent.id), { title: 'Gone soon', dueAt: soon(60) }, [agent.id]);
    await saveAttachment({
      taskId: id, filename: 'plan.png', contentType: 'image/png',
      body: Buffer.from('not really a png'), uploadedByUserId: agent.id,
    });
    expect(await attachmentsFor([id])).toHaveLength(1);

    await deleteTask(actor(agent.id), id, [agent.id]);
    expect(await query('SELECT id FROM tasks WHERE id = ?', [id])).toHaveLength(0);
    expect(await attachmentsFor([id])).toHaveLength(0);
  });

  it('hides a colleague’s task behind "does not exist"', async () => {
    // Saying "forbidden" would confirm the task exists, which is enough to
    // enumerate someone else's workload one id at a time.
    const mine = await createTestUser({ role: 'agent' });
    const theirs = await createTestUser({ role: 'agent' });
    const id = await createTask(actor(theirs.id), { title: 'Private', dueAt: soon(60) }, [theirs.id]);
    await expect(assertCanViewTask(id, [mine.id])).rejects.toThrow(/does not exist/i);
    await expect(assertCanViewTask(id, [theirs.id])).resolves.toBeUndefined();
  });

  it('returns only the tasks inside the calendar window', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await createTask(actor(agent.id), { title: 'In the window', dueAt: soon(60 * 5) }, [agent.id]);
    await createTask(actor(agent.id), { title: 'Next month', dueAt: soon(60 * 24 * 40) }, [agent.id]);

    const items = await tasksInRange(agent.id, [agent.id], {
      from: new Date(Date.now() - 3600_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
      scope: 'mine',
    });
    expect(items.map((task) => task.title)).toEqual(['In the window']);
  });

  it('refuses a calendar range longer than two months', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await expect(
      tasksInRange(agent.id, [agent.id], {
        from: new Date().toISOString(),
        to: new Date(Date.now() + 200 * 86_400_000).toISOString(),
        scope: 'mine',
      }),
    ).rejects.toThrow(/longer than two months/i);
  });

  it('claims a reminder once, however many times the sweep runs', async () => {
    /*
     * The failure this prevents is a duplicate nudge, which is how people learn
     * to ignore them. The row is claimed before the email is attempted.
     */
    const agent = await createTestUser({ role: 'agent' });
    await createTask(actor(agent.id), { title: 'Due very soon', dueAt: soon(5) }, [agent.id]);

    const first = await sweepTaskReminders();
    expect(first.found).toBe(1);

    const second = await sweepTaskReminders();
    expect(second.found).toBe(0);
  });

  it('still warns about a task whose moment passed while the worker was down', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const id = await createTask(actor(agent.id), { title: 'Missed it', dueAt: soon(60) }, [agent.id]);
    await execute('UPDATE tasks SET due_at = DATE_SUB(NOW(3), INTERVAL 2 HOUR) WHERE id = ?', [id]);

    expect((await sweepTaskReminders()).found).toBe(1);
  });

  it('never nudges about something already done', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const id = await createTask(actor(agent.id), { title: 'Finished', dueAt: soon(5) }, [agent.id]);
    await execute('UPDATE tasks SET completed_at = NOW(3) WHERE id = ?', [id]);

    expect((await sweepTaskReminders()).found).toBe(0);
  });

  it('never nudges a deactivated user', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await createTask(actor(agent.id), { title: 'Left the company', dueAt: soon(5) }, [agent.id]);
    await execute('UPDATE users SET is_active = 0 WHERE id = ?', [agent.id]);

    expect((await sweepTaskReminders()).found).toBe(0);
  });

  it('leaves a distant deadline alone', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await createTask(actor(agent.id), { title: 'Next week', dueAt: soon(60 * 24 * 7) }, [agent.id]);
    expect((await sweepTaskReminders()).found).toBe(0);
  });

  /*
   * "Today" has to mean today in Dubai. Timestamps are stored as UTC, so a bare
   * DATE(due_at) = CURDATE() is a day behind between 20:00 UTC and midnight —
   * the small hours of the next morning in Dubai. An agent opening the app at
   * 1am would be shown yesterday afternoon and none of the day ahead.
   */
  it('counts "today" as the Dubai day, not the UTC one', async () => {
    const agent = await createTestUser({ role: 'agent' });

    // Dubai midnight tonight, expressed as the UTC instant it happens at, then
    // nudged either side of it. Derived from the clock rather than hard-coded,
    // so the test does not start failing on a particular date.
    const dubaiNow = new Date(Date.now() + 4 * 3600_000);
    const midnight = Date.UTC(
      dubaiNow.getUTCFullYear(), dubaiNow.getUTCMonth(), dubaiNow.getUTCDate(),
    ) - 4 * 3600_000;

    const lastMinuteToday = new Date(midnight + 23 * 3600_000 + 30 * 60_000);
    const smallHoursTomorrow = new Date(midnight + 24 * 3600_000 + 60 * 60_000);

    await createTask(actor(agent.id), { title: 'Due 23:30 tonight', dueAt: lastMinuteToday.toISOString() }, [agent.id]);
    await createTask(actor(agent.id), { title: 'Due 01:00 tomorrow', dueAt: smallHoursTomorrow.toISOString() }, [agent.id]);

    const today = await listTasks(agent.id, [agent.id], { scope: 'mine', filter: 'today' });
    expect(today.items.map((task) => task.title)).toEqual(['Due 23:30 tonight']);
    expect(today.counts.today).toBe(1);
    // Both are still open, whichever day they fall on.
    expect(today.counts.open).toBe(2);
  });

  it('shows a new task in the open list straight away', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await createTask(actor(agent.id), { title: 'Fresh', dueAt: soon(120) }, [agent.id]);
    const list = await listTasks(agent.id, [agent.id], { scope: 'mine', filter: 'open' });
    expect(list.items.map((task) => task.title)).toContain('Fresh');
    expect(list.counts.open).toBe(1);
  });
});
