import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
  type TestUser,
} from '../../testing/db.js';
import { execute, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { setEnvForTesting } from '../../config/env.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';

/**
 * `GET /api/v2/calendar` must answer, whatever is in the book.
 *
 * Written on 14 Nov after the owner reported "Internal server error" on the
 * calendar for an owner and for an agent, on a phone and on a computer. The
 * existing suite only ever called this endpoint without `scope` and against a
 * near-empty table, so it proved almost nothing about the screen people
 * actually open every morning.
 *
 * Two halves, and both matter:
 *
 *  1. The matrix the browser can produce: every role crossed with both values
 *     of `scope`, and the exact URL `web/src/v2/Calendar.tsx` builds — raw
 *     `toISOString()` values, unencoded, for the month, week and day windows.
 *  2. Row shapes. The endpoint joins four tables and maps twenty-odd columns,
 *     most of them nullable, so a single awkward row can take the whole screen
 *     down for everybody. Each shape below is one of those, written out rather
 *     than left to chance: a plan with no lead, a plan whose contact has since
 *     been deleted, a plan belonging to a deactivated colleague, an all-day
 *     plan running over four days, a booking with money and a receipt on it,
 *     a soft-deleted plan, and more rows in the window than the LIMIT allows.
 *
 * It does not reproduce the owner's 500 — nothing here does, which is itself
 * the finding — but it holds the endpoint against every shape we can name.
 */
let server: Server;
let base = '';

/* A fixed seed, so a failure here can be replayed exactly. */
let seed = 20261114;
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
/** The value, or nothing — so every nullable column is sometimes null. */
const maybe = <T>(x: T): T | null => (rnd() < 0.4 ? null : x);

describeWithDb('the calendar window', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    setEnvForTesting(null);
    await new Promise((resolve) => server.close(resolve));
    await closeTestDatabase();
  });
  beforeEach(async () => { await resetTables(); resetRateLimits(); });

  const get = (path: string, cookie: string): Promise<Response> =>
    fetch(`${base}${path}`, { headers: { cookie } });

  /** The window `Calendar.tsx` sends, spelled the way it spells it. */
  const url = (from: Date, to: Date, scope: 'mine' | 'team'): string =>
    `/api/v2/calendar?from=${from.toISOString()}&to=${to.toISOString()}&scope=${scope}`;

  /** A lead to hang plans on, with the fields the calendar reads off it. */
  async function aLead(owner: string): Promise<{ id: string; contactId: string }> {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164, lead_score) VALUES (?, ?, ?, ?)',
      [contactId, 'Omar Khalil', `+9715${String(10_000_000 + Math.floor(rnd() * 8_000_000))}`, 61],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status,
          title, source, project_name, unit_type)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 'Omar', 'manual', 'Valia by Emaar', '2BR')`,
      [id, contactId, stage!.pipeline_id, stage!.id, stage!.key, owner],
    );
    return { id, contactId };
  }

  /**
   * A plan written straight into the table.
   *
   * Deliberately not through `POST /api/v2/meetings`: that route refuses a plan
   * in the past and a lead-less viewing, and the rows this test is about are
   * exactly the ones no route would write today but which are sitting in a
   * two-year-old database all the same.
   */
  async function plan(over: Record<string, unknown>): Promise<void> {
    const cols = Object.keys(over);
    await execute(
      `INSERT INTO meetings (id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
      [newId(), ...Object.values(over)] as never,
    );
  }

  const hoursAway = (h: number): Date => new Date(Date.now() + h * 3_600_000);

  /* ── 1. every role, both scopes, all three views ──────────────────────── */

  for (const role of ['owner', 'admin', 'manager', 'agent'] as const) {
    for (const scope of ['mine', 'team'] as const) {
      it(`answers a ${role} asking for ${scope === 'mine' ? 'their own' : 'the team'} week`, async () => {
        const user = await createTestUser({ role });
        const cookie = await signIn(base, user);
        const now = new Date();
        const res = await get(url(now, new Date(now.getTime() + 7 * 86_400_000), scope), cookie);
        const text = await res.text();
        if (res.status !== 200) throw new Error(`${role}/${scope} -> ${res.status}: ${text.slice(0, 600)}`);
        const body = JSON.parse(text) as { tasks: unknown[]; meetings: unknown[] };
        expect(Array.isArray(body.tasks)).toBe(true);
        expect(Array.isArray(body.meetings)).toBe(true);
      });
    }
  }

  it('answers all three views, including the 43-day month grid', async () => {
    const user = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, user);
    const now = new Date();
    /* What `Calendar.tsx` builds: six whole weeks, plus the day after the last. */
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const grid = new Date(first);
    grid.setDate(first.getDate() - ((first.getDay() + 6) % 7));

    const views: Array<[string, Date, Date]> = [
      ['day', now, new Date(now.getTime() + 86_400_000)],
      ['week', now, new Date(now.getTime() + 7 * 86_400_000)],
      ['month', grid, new Date(grid.getTime() + 43 * 86_400_000)],
    ];
    for (const [view, from, to] of views) {
      const res = await get(url(from, to, 'mine'), cookie);
      if (res.status !== 200) {
        throw new Error(`${view} -> ${res.status}: ${(await res.text()).slice(0, 400)}`);
      }
    }
  });

  it('refuses a window longer than two months in plain English, not with a 500', async () => {
    const user = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, user);
    const now = new Date();
    const res = await get(url(now, new Date(now.getTime() + 200 * 86_400_000), 'mine'), cookie);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toContain('two months');
  });

  /* ── 2. the row shapes a two-year-old book contains ───────────────────── */

  it('answers for every awkward row shape, one shape at a time', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    const ownerCookie = await signIn(base, owner);
    const agentCookie = await signIn(base, agent);
    const lead = await aLead(agent.id);

    const shapes: Array<[string, () => Promise<void>]> = [
      ['an ordinary viewing', async () => {
        await plan({
          user_id: agent.id, opportunity_id: lead.id, contact_id: lead.contactId,
          kind: 'meeting', title: 'Viewing', starts_at: hoursAway(24), ends_at: hoursAway(25),
        });
      }],
      ['a team event, which belongs to no lead', async () => {
        await plan({
          user_id: agent.id, kind: 'team', title: 'Weekly sales meeting',
          starts_at: hoursAway(26), ends_at: hoursAway(27),
        });
      }],
      ['a call with a contact but no opportunity', async () => {
        await plan({
          user_id: agent.id, contact_id: lead.contactId, kind: 'call',
          starts_at: hoursAway(28), ends_at: hoursAway(29),
        });
      }],
      ['a plan with no title', async () => {
        await plan({
          user_id: agent.id, opportunity_id: lead.id, contact_id: lead.contactId,
          kind: 'site_visit', starts_at: hoursAway(30), ends_at: hoursAway(31),
        });
      }],
      ['an all-day plan running over four days', async () => {
        await plan({
          user_id: agent.id, kind: 'team', title: 'Cityscape', all_day: 1,
          starts_at: hoursAway(48), ends_at: hoursAway(144),
        });
      }],
      ['a booking, with money and a receipt on it', async () => {
        await plan({
          user_id: agent.id, opportunity_id: lead.id, contact_id: lead.contactId,
          kind: 'meeting', title: 'Reservation', starts_at: hoursAway(-48), ends_at: hoursAway(-47),
          result: 'booked', interest: 'hot', result_at: hoursAway(-47), result_by: 'client',
          booked_project: 'Valia', booked_unit: '2BR · 1204',
          booked_price_aed: 2_450_000, booked_paid_aed: 50_000,
          receipt_name: 'booking-form.pdf', receipt_type: 'application/pdf', receipt_bytes: 48_221,
        });
      }],
      ['two no-shows on the same lead, which the row counts', async () => {
        for (const h of [-72, -70]) {
          await plan({
            user_id: agent.id, opportunity_id: lead.id, contact_id: lead.contactId,
            kind: 'meeting', starts_at: hoursAway(h), ends_at: hoursAway(h + 1), result: 'no_show',
          });
        }
      }],
      ['a plan whose contact has since been deleted', async () => {
        const contactId = newId();
        await execute('INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
          [contactId, 'Deleted since', '+971500000911']);
        await plan({
          user_id: agent.id, contact_id: contactId, kind: 'meeting',
          starts_at: hoursAway(34), ends_at: hoursAway(35),
        });
        /* The foreign key sets `contact_id` to NULL and leaves the plan. */
        await execute('DELETE FROM contacts WHERE id = ?', [contactId]);
      }],
      ['a plan belonging to a colleague who has been deactivated', async () => {
        const left = await createTestUser({ role: 'agent' });
        await plan({
          user_id: left.id, opportunity_id: lead.id, contact_id: lead.contactId,
          kind: 'meeting', title: 'Handed over', starts_at: hoursAway(36), ends_at: hoursAway(37),
        });
        await execute('UPDATE users SET is_active = 0 WHERE id = ?', [left.id]);
      }],
      ['a soft-deleted plan', async () => {
        await plan({
          user_id: agent.id, kind: 'team', starts_at: hoursAway(38), ends_at: hoursAway(39),
          deleted_at: new Date(),
        });
      }],
      ['a task on a lead, and a task on nothing', async () => {
        await execute(
          `INSERT INTO tasks (id, type, title, due_at, assigned_user_id, contact_id, opportunity_id)
           VALUES (?, 'call', 'Ring Omar back', ?, ?, ?, ?)`,
          [newId(), hoursAway(5), agent.id, lead.contactId, lead.id],
        );
        await execute(
          `INSERT INTO tasks (id, type, title, due_at, assigned_user_id)
           VALUES (?, 'other', 'Paperwork', ?, ?)`,
          [newId(), hoursAway(6), agent.id],
        );
      }],
      ['six hundred plans in the window, past the 500 cap', async () => {
        for (let i = 0; i < 600; i += 1) {
          await plan({
            user_id: agent.id, opportunity_id: lead.id, contact_id: lead.contactId,
            kind: 'call', title: `Call ${i}`,
            starts_at: new Date(Date.now() + 60_000 * i),
            ends_at: new Date(Date.now() + 60_000 * i + 1_800_000),
          });
        }
      }],
    ];

    const now = new Date();
    const from = new Date(now.getTime() - 15 * 86_400_000);
    const to = new Date(now.getTime() + 15 * 86_400_000);
    const broke: string[] = [];

    for (const [label, add] of shapes) {
      await add();
      for (const [who, cookie] of [['owner', ownerCookie], ['agent', agentCookie]] as const) {
        for (const scope of ['mine', 'team'] as const) {
          const res = await get(url(from, to, scope), cookie);
          if (res.status !== 200) {
            broke.push(`after ${label}: ${who}/${scope} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
          }
        }
      }
    }
    expect(broke, broke.join('\n')).toEqual([]);
  }, 120_000);

  /* ── 3. a whole book, every nullable column sometimes null ────────────── */

  it('answers against a book the size of a real one', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const manager = await createTestUser({ role: 'manager' });
    const one = await createTestUser({ role: 'agent' });
    const two = await createTestUser({ role: 'agent' });
    const left = await createTestUser({ role: 'agent' });
    await execute('UPDATE users SET manager_id = ? WHERE id IN (?, ?)', [manager.id, one.id, two.id]);
    const everybody = [owner.id, manager.id, one.id, two.id, left.id];

    const leads: Array<{ id: string; contactId: string }> = [];
    for (let i = 0; i < 40; i += 1) leads.push(await aLead(pick(everybody)));

    const kinds = ['meeting', 'site_visit', 'call', 'follow_up', 'team'] as const;
    const results = [null, 'showed', 'no_show', 'rescheduled', 'booked', 'cancelled'] as const;
    const interests = [null, 'hot', 'warm', 'cold'] as const;
    const askedBy = [null, 'client', 'me', 'developer'] as const;

    for (let i = 0; i < 400; i += 1) {
      const lead = rnd() < 0.2 ? null : pick(leads);
      const allDay = rnd() < 0.12;
      const starts = new Date(Date.now() + (rnd() * 60 - 30) * 86_400_000);
      const result = pick(results);
      await plan({
        opportunity_id: lead?.id ?? null,
        /* Sometimes a plan has the lead but not the person: the contact went. */
        contact_id: rnd() < 0.15 ? null : (lead?.contactId ?? null),
        user_id: pick(everybody),
        kind: pick(kinds),
        title: maybe(`Plan ${i}`),
        starts_at: starts,
        ends_at: new Date(starts.getTime() + (allDay ? 86_400_000 * Math.ceil(rnd() * 4) : 3_600_000)),
        all_day: allDay ? 1 : 0,
        place: maybe('Sales centre, Downtown'),
        reminder_minutes: maybe(Math.floor(rnd() * 1440)),
        result,
        result_note: maybe(`How it went ${i}`),
        interest: pick(interests),
        result_at: result ? starts : null,
        result_by: pick(askedBy),
        booked_project: maybe('Valia'),
        booked_unit: maybe('2BR · 1204'),
        booked_price_aed: maybe(Math.floor(rnd() * 20_000_000)),
        booked_paid_aed: maybe(Math.floor(rnd() * 500_000)),
        receipt_name: maybe('receipt.pdf'),
        created_by: maybe(pick(everybody)),
        deleted_at: rnd() < 0.08 ? new Date() : null,
      });
    }

    for (let i = 0; i < 300; i += 1) {
      const lead = rnd() < 0.25 ? null : pick(leads);
      await execute(
        `INSERT INTO tasks
           (id, type, title, notes, priority, due_at, completed_at,
            contact_id, opportunity_id, assigned_user_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [newId(), pick(['call', 'whatsapp', 'email', 'meeting', 'other'] as const),
          `Task ${i}`, maybe(`Notes ${i}`), pick(['low', 'normal', 'high'] as const),
          new Date(Date.now() + (rnd() * 60 - 30) * 86_400_000),
          rnd() < 0.3 ? new Date() : null,
          lead?.contactId ?? null, lead?.id ?? null,
          /* A task nobody owns: the agent left and it was never handed on. */
          rnd() < 0.1 ? null : pick(everybody)],
      );
    }

    await execute('UPDATE users SET is_active = 0 WHERE id = ?', [left.id]);

    const now = new Date();
    const windows: Array<[string, Date, Date]> = [
      ['the month grid', new Date(now.getTime() - 10 * 86_400_000), new Date(now.getTime() + 33 * 86_400_000)],
      ['this week', now, new Date(now.getTime() + 7 * 86_400_000)],
      ['today', now, new Date(now.getTime() + 86_400_000)],
      ['the longest allowed window', new Date(now.getTime() - 30 * 86_400_000), new Date(now.getTime() + 31 * 86_400_000)],
    ];

    const broke: string[] = [];
    for (const who of [owner, manager, one, two] as TestUser[]) {
      const cookie = await signIn(base, who);
      for (const scope of ['mine', 'team'] as const) {
        for (const [label, from, to] of windows) {
          const res = await get(url(from, to, scope), cookie);
          if (res.status !== 200) {
            broke.push(`${who.role}/${scope}/${label} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
          }
        }
      }
    }
    expect(broke, broke.join('\n')).toEqual([]);
  }, 180_000);
});
