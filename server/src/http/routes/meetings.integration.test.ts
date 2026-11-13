import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { execute, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { setEnvForTesting } from '../../config/env.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';

/**
 * The calendar's plans, end to end.
 *
 * Eight faults the owner found by hand, and the four of them that live on the
 * server are here: a plan could be saved in the past, a plan could not be
 * changed or deleted at all, a lead-less meeting could be planned, and the
 * meeting result threw everything but one word away -- "Moved it" moved
 * nothing and "They booked" left the lead where it was.
 */
let server: Server;
let base = '';

describeWithDb('plans in the diary', () => {
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
  afterEach(() => resetRateLimits());

  async function aLead(owner: string): Promise<{ id: string; contactId: string }> {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [contactId, 'Omar Khalil', '+971502223344'],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title, source, project_name)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 'Omar', 'manual', 'Valia by Emaar')`,
      [id, contactId, stage!.pipeline_id, stage!.id, stage!.key, owner],
    );
    return { id, contactId };
  }

  const send = (method: string, path: string, cookie: string, body?: unknown) => fetch(
    `${base}${path}`,
    {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );

  /** Tomorrow at a fixed hour, so nothing here depends on the hour it runs. */
  function tomorrow(hour: number, minutes = 0): Date {
    const at = new Date(Date.now() + 86_400_000);
    at.setUTCHours(hour, minutes, 0, 0);
    return at;
  }

  async function aPlan(cookie: string, over: Record<string, unknown> = {}): Promise<string> {
    const starts = tomorrow(8);
    const res = await send('POST', '/api/v2/meetings', cookie, {
      kind: 'team',
      title: 'Weekly sales meeting',
      startsAt: starts.toISOString(),
      endsAt: new Date(starts.getTime() + 3_600_000).toISOString(),
      ...over,
    });
    const text = await res.text();
    expect(res.status, text).toBe(201);
    return (JSON.parse(text) as { id: string }).id;
  }

  /* ── 1. the past ─────────────────────────────────────────────────────── */

  it('refuses a plan in the past, and says which field is wrong', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const yesterday = new Date(Date.now() - 86_400_000);

    const res = await send('POST', '/api/v2/meetings', cookie, {
      kind: 'team',
      title: 'Yesterday',
      startsAt: yesterday.toISOString(),
      endsAt: new Date(yesterday.getTime() + 3_600_000).toISOString(),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: { message: string; details: { field: string } } };
    expect(body.error.message).toBe('This day is in the past. Pick today or later.');
    expect(body.error.details.field, 'the refusal has to name the day').toBe('day');
  });

  it('refuses an hour that has already gone today, and blames the time', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    /* Ten minutes ago: the day is right, the hour is not. */
    const gone = new Date(Date.now() - 10 * 60_000);

    const res = await send('POST', '/api/v2/meetings', cookie, {
      kind: 'team',
      title: 'Ten minutes ago',
      startsAt: gone.toISOString(),
      endsAt: new Date(gone.getTime() + 3_600_000).toISOString(),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: { message: string; details: { field: string } } };
    expect(body.error.details.field).toBe('time');
    expect(body.error.message).toMatch(/^This time has passed\. It is \d\d:\d\d now\.$/);
  });

  /* ── 2. changing and deleting ────────────────────────────────────────── */

  it('changes the day and time of a plan', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const id = await aPlan(cookie);

    const moved = tomorrow(16, 30);
    const res = await send('PATCH', `/api/v2/meetings/${id}`, cookie, {
      startsAt: moved.toISOString(),
      endsAt: new Date(moved.getTime() + 3_600_000).toISOString(),
    });
    expect(res.status, await res.text()).toBe(200);

    const row = await queryOne<{ starts_at: Date }>('SELECT starts_at FROM meetings WHERE id = ?', [id]);
    expect(new Date(row!.starts_at).getTime()).toBe(moved.getTime());
  });

  it('will not change a plan into the past', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const id = await aPlan(cookie);

    const back = new Date(Date.now() - 2 * 86_400_000);
    const res = await send('PATCH', `/api/v2/meetings/${id}`, cookie, {
      startsAt: back.toISOString(),
      endsAt: new Date(back.getTime() + 3_600_000).toISOString(),
    });
    expect(res.status).toBe(400);
  });

  it('deletes a plan softly, and stops showing it in the calendar', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const id = await aPlan(cookie);

    const res = await send('DELETE', `/api/v2/meetings/${id}`, cookie);
    expect(res.status, await res.text()).toBe(200);

    const row = await queryOne<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM meetings WHERE id = ?', [id],
    );
    expect(row!.deleted_at, 'the row stays, so the lead keeps its history').not.toBeNull();

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const seen = await send('GET', `/api/v2/calendar?from=${from}&to=${to}`, cookie);
    const body = await seen.json() as { meetings: Array<{ id: string }> };
    expect(body.meetings.map((m) => m.id)).not.toContain(id);
  });

  it('does not let an agent change or delete somebody else’s plan', async () => {
    const mine = await createTestUser({ role: 'agent' });
    const theirs = await createTestUser({ role: 'agent' });
    const id = await aPlan(await signIn(base, theirs));
    const cookie = await signIn(base, mine);

    const at = tomorrow(11);
    const patched = await send('PATCH', `/api/v2/meetings/${id}`, cookie, {
      startsAt: at.toISOString(),
      endsAt: new Date(at.getTime() + 3_600_000).toISOString(),
    });
    expect(patched.status).toBe(403);
    expect((await send('DELETE', `/api/v2/meetings/${id}`, cookie)).status).toBe(403);
  });

  /* ── 5. a meeting belongs to a lead ─────────────────────────────────── */

  it('refuses a meeting, a site visit or a call with no lead', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const at = tomorrow(9);

    for (const kind of ['meeting', 'site_visit', 'call']) {
      const res = await send('POST', '/api/v2/meetings', cookie, {
        kind,
        title: 'No lead',
        startsAt: at.toISOString(),
        endsAt: new Date(at.getTime() + 3_600_000).toISOString(),
      });
      expect(res.status, `${kind} must need a lead`).toBe(400);
      const body = await res.json() as { error: { message: string; details: { field: string } } };
      expect(body.error.message).toBe('Choose a lead from the list.');
      expect(body.error.details.field).toBe('lead');
    }
  });

  it('takes a team plan with no lead', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    await expect(aPlan(await Promise.resolve(cookie))).resolves.toBeTruthy();
  });

  /* ── 7. several days ─────────────────────────────────────────────────── */

  it('keeps a plan that runs over several days on every day it covers', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const start = new Date(Date.now() + 2 * 86_400_000);
    start.setUTCHours(0, 0, 0, 0);
    const id = await aPlan(cookie, {
      title: 'Cityscape Global expo',
      allDay: true,
      startsAt: start.toISOString(),
      /* The midnight after the third day: the exclusive end. */
      endsAt: new Date(start.getTime() + 3 * 86_400_000).toISOString(),
    });

    /* A window covering only the middle day must still return it. */
    const middle = new Date(start.getTime() + 86_400_000);
    const seen = await send(
      'GET',
      `/api/v2/calendar?from=${middle.toISOString()}&to=${new Date(middle.getTime() + 86_400_000).toISOString()}`,
      cookie,
    );
    const body = await seen.json() as { meetings: Array<{ id: string; allDay: boolean }> };
    const found = body.meetings.find((m) => m.id === id);
    expect(found, 'day two of a three-day plan is still that plan').toBeTruthy();
    expect(found!.allDay).toBe(true);
  });

  it('takes a several-day plan that starts today, midnight and all', async () => {
    /*
     * It starts at midnight, and midnight has gone. Judging a plan with no
     * hour by the clock would refuse every expo on the morning it opens.
     */
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    /* Midnight in Dubai, which is where the office is and where the server
       judges a day from. Midnight UTC is yesterday there after 20:00. */
    const shifted = new Date(Date.now() + 4 * 3_600_000);
    shifted.setUTCHours(0, 0, 0, 0);
    const midnight = new Date(shifted.getTime() - 4 * 3_600_000);

    const res = await send('POST', '/api/v2/meetings', cookie, {
      kind: 'team',
      title: 'Cityscape, day one',
      allDay: true,
      startsAt: midnight.toISOString(),
      endsAt: new Date(midnight.getTime() + 3 * 86_400_000).toISOString(),
    });
    expect(res.status, await res.text()).toBe(201);
  });

  it('refuses a plan longer than five days', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const start = new Date(Date.now() + 2 * 86_400_000);
    start.setUTCHours(0, 0, 0, 0);

    const res = await send('POST', '/api/v2/meetings', cookie, {
      kind: 'team',
      title: 'Too long',
      allDay: true,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 9 * 86_400_000).toISOString(),
    });
    expect(res.status).toBe(400);
  });

  /* ── 8. how it went ─────────────────────────────────────────────────── */

  it('will not record "they came" without the interest and the next step', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id);
    const id = await aPlan(cookie, { kind: 'meeting', opportunityId: lead.id, contactId: lead.contactId });

    const bare = await send('PATCH', `/api/v2/meetings/${id}/result`, cookie, { result: 'showed' });
    expect(bare.status).toBe(400);
    expect((await bare.json() as { error: { details: { field: string } } }).error.details.field)
      .toBe('interest');

    const half = await send('PATCH', `/api/v2/meetings/${id}/result`, cookie, {
      result: 'showed', interest: 'hot',
    });
    expect(half.status).toBe(400);
    expect((await half.json() as { error: { details: { field: string } } }).error.details.field)
      .toBe('next');
  });

  it('puts the next step in the diary when they came', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id);
    const id = await aPlan(cookie, { kind: 'meeting', opportunityId: lead.id, contactId: lead.contactId });

    const next = tomorrow(15);
    const res = await send('PATCH', `/api/v2/meetings/${id}/result`, cookie, {
      result: 'showed',
      interest: 'hot',
      note: 'Wants the sea view.',
      next: {
        kind: 'site_visit',
        title: 'Site visit with Omar Khalil',
        startsAt: next.toISOString(),
        endsAt: new Date(next.getTime() + 3_600_000).toISOString(),
        place: 'Sales centre',
      },
    });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const body = JSON.parse(text) as { nextPlanId: string | null };
    expect(body.nextPlanId, 'the next step is a plan, not a sentence').toBeTruthy();

    const made = await queryOne<{ kind: string; opportunity_id: string; starts_at: Date }>(
      'SELECT kind, opportunity_id, starts_at FROM meetings WHERE id = ?', [body.nextPlanId],
    );
    expect(made!.kind).toBe('site_visit');
    expect(made!.opportunity_id, 'it stays on the same lead').toBe(lead.id);

    const saved = await queryOne<{ result: string; interest: string; result_note: string }>(
      'SELECT result, interest, result_note FROM meetings WHERE id = ?', [id],
    );
    expect(saved).toMatchObject({ result: 'showed', interest: 'hot', result_note: 'Wants the sea view.' });
  });

  it('moves the plan when it was moved, and keeps it open', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id);
    const id = await aPlan(cookie, { kind: 'meeting', opportunityId: lead.id, contactId: lead.contactId });

    const bare = await send('PATCH', `/api/v2/meetings/${id}/result`, cookie, { result: 'rescheduled' });
    expect(bare.status, 'a move with nowhere to move to is not a move').toBe(400);

    const to = tomorrow(17, 15);
    const res = await send('PATCH', `/api/v2/meetings/${id}/result`, cookie, {
      result: 'rescheduled',
      by: 'client',
      movedTo: {
        startsAt: to.toISOString(),
        endsAt: new Date(to.getTime() + 3_600_000).toISOString(),
      },
    });
    expect(res.status, await res.text()).toBe(200);

    const row = await queryOne<{ starts_at: Date; result: string | null; result_by: string }>(
      'SELECT starts_at, result, result_by FROM meetings WHERE id = ?', [id],
    );
    expect(new Date(row!.starts_at).getTime(), 'saving "Moved it" has to move it').toBe(to.getTime());
    expect(row!.result, 'a moved meeting still has to happen').toBeNull();
    expect(row!.result_by).toBe('client');
  });

  it('records who cancelled, and does not refuse it as a no-show', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id);
    const id = await aPlan(cookie, { kind: 'meeting', opportunityId: lead.id, contactId: lead.contactId });

    const bare = await send('PATCH', `/api/v2/meetings/${id}/result`, cookie, { result: 'cancelled' });
    expect(bare.status).toBe(400);

    const res = await send('PATCH', `/api/v2/meetings/${id}/result`, cookie, {
      result: 'cancelled', by: 'developer', note: 'The developer closed the sales centre.',
    });
    expect(res.status, await res.text()).toBe(200);

    const row = await queryOne<{ result: string; result_by: string }>(
      'SELECT result, result_by FROM meetings WHERE id = ?', [id],
    );
    expect(row).toMatchObject({ result: 'cancelled', result_by: 'developer' });
  });

  it('will not record a booking without the unit, the price and the receipt', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id);
    const id = await aPlan(cookie, { kind: 'meeting', opportunityId: lead.id, contactId: lead.contactId });

    const noUnit = await send('PATCH', `/api/v2/meetings/${id}/result`, cookie, { result: 'booked' });
    expect(noUnit.status).toBe(400);
    expect((await noUnit.json() as { error: { details: { field: string } } }).error.details.field)
      .toBe('unit');

    const overpaid = await send('PATCH', `/api/v2/meetings/${id}/result`, cookie, {
      result: 'booked', booked: { unit: '1204', priceAed: 1_400_000, paidAed: 2_000_000 },
    });
    expect(overpaid.status).toBe(400);
    expect((await overpaid.json() as { error: { message: string } }).error.message)
      .toBe('Paid now cannot be more than the price.');

    const noReceipt = await send('PATCH', `/api/v2/meetings/${id}/result`, cookie, {
      result: 'booked', booked: { unit: '1204', priceAed: 1_400_000, paidAed: 140_000 },
    });
    expect(noReceipt.status, 'the owner checks that file before the deal counts').toBe(400);
    expect((await noReceipt.json() as { error: { details: { field: string } } }).error.details.field)
      .toBe('receipt');
  });

  it('moves the lead to Won once the booking form is on file', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id);
    const id = await aPlan(cookie, { kind: 'meeting', opportunityId: lead.id, contactId: lead.contactId });

    const upload = await fetch(`${base}/api/v2/meetings/${id}/receipt`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'image/png', 'x-filename': 'booking-form.png' },
      /* An eight-byte PNG signature is enough: nothing here reads the pixels. */
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    expect(upload.status, await upload.text()).toBe(201);

    const res = await send('PATCH', `/api/v2/meetings/${id}/result`, cookie, {
      result: 'booked', booked: { unit: '2BR · 1204', priceAed: 1_400_000, paidAed: 140_000 },
    });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const body = JSON.parse(text) as { leadMoved: boolean; leadNote: string | null };
    expect(body.leadMoved, body.leadNote ?? 'the lead has to move to Won').toBe(true);

    const opportunity = await queryOne<{ stage_key: string; status: string }>(
      'SELECT stage_key, status FROM opportunities WHERE id = ?', [lead.id],
    );
    expect(opportunity).toMatchObject({ stage_key: 'won', status: 'won' });

    const saved = await queryOne<{ booked_unit: string; booked_price_aed: number; receipt_name: string }>(
      'SELECT booked_unit, booked_price_aed, receipt_name FROM meetings WHERE id = ?', [id],
    );
    expect(saved).toMatchObject({ booked_unit: '2BR · 1204', receipt_name: 'booking-form.png' });
    expect(Number(saved!.booked_price_aed)).toBe(1_400_000);
  });

  it('gives the booking form back only to someone who may see the plan', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const stranger = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id);
    const id = await aPlan(cookie, { kind: 'meeting', opportunityId: lead.id, contactId: lead.contactId });

    await fetch(`${base}/api/v2/meetings/${id}/receipt`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/pdf', 'x-filename': 'form.pdf' },
      body: Buffer.from('%PDF-1.4'),
    });

    const theirs = await send('GET', `/api/v2/meetings/${id}/receipt`, cookie);
    expect(theirs.status).toBe(200);
    expect(theirs.headers.get('content-disposition')).toContain('form.pdf');

    const nosy = await send('GET', `/api/v2/meetings/${id}/receipt`, await signIn(base, stranger));
    expect(nosy.status).toBe(403);
  });
});
