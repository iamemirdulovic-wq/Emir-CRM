import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, query, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';

/**
 * Calling, and what a call does to the lead.
 *
 * The point of these: an outcome logged from the dialler must do exactly what
 * the same outcome logged from the lead page does. Two screens writing the
 * stage two different ways is how a pipeline stops meaning anything, and it
 * would not show up anywhere until a report disagreed with a board.
 */
let server: Server;
let base = '';

describeWithDb('calling', () => {
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

  async function aLead(owner: string, over: { vip?: boolean; dueInHours?: number } = {}) {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [contactId, 'Marco Bellini', `+9715${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title,
          source, project_name, is_vip, next_step_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 'x', 'manual', 'Valia', ?, ?)`,
      [
        id, contactId, stage!.pipeline_id, stage!.id, stage!.key, owner,
        over.vip ? 1 : 0,
        new Date(Date.now() + (over.dueInHours ?? -1) * 3_600_000),
      ],
    );
    return id;
  }

  const send = (method: string, path: string, cookie: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('puts the VIP lead at the front of the queue', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id, { dueInHours: -5 });
    const vip = await aLead(agent.id, { vip: true, dueInHours: -1 });
    await aLead(agent.id, { dueInHours: -3 });
    const cookie = await signIn(base, agent);

    const res = await send('GET', '/api/v2/queue', cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    const { items } = await res.json() as { items: Array<{ id: string; isVip: boolean }> };

    expect(items).toHaveLength(3);
    expect(items[0]?.id, 'the VIP lead is first even though it is the least overdue').toBe(vip);
    /* After the VIP one, the oldest promise. */
    expect(items[1]?.isVip).toBe(false);
  });

  /*
   * These two used to assert two hours for a no-answer and one for a busy,
   * which is what this file's own `RETRY_MINUTES` table said until 14
   * November. That table was a second answer to a question the no-answer rule
   * now answers — the ladder the owner sets in Automations, moved into the
   * client's waking hours and ours — so the dialler was giving a different
   * follow-up time from the lead page for the same tap, and the owner's
   * settings changed one of them and not the other.
   *
   * `finishCall` now hands the outcome to `saveCallResult`, so what is
   * checked here is that the dialler goes through that one path and gets its
   * answer back. The arithmetic itself — try 2 in two hours, try 3 next
   * morning, a busy line in thirty minutes — belongs to `call-results.test.ts`
   * and `call-results.integration.test.ts`, which can fix the clock and
   * therefore say exactly. Asserting "about two hours from now" here would be
   * wrong half the time anyway: ring somebody at 18:00 and the next try is
   * tomorrow morning, because we do not phone clients at 20:00.
   */
  it('a no-answer moves the lead and promises the next try, counted', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const started = await send('POST', '/api/v2/calls', cookie, { opportunityId: lead });
    expect(started.status, await started.clone().text()).toBe(200);
    const { id } = await started.json() as { id: string };

    const done = await send('PATCH', `/api/v2/calls/${id}`, cookie, { outcome: 'no_answer' });
    expect(done.status, await done.clone().text()).toBe(200);
    const result = await done.json() as {
      stageKey: string; nextStepAt: string | null; said: string;
      noAnswer: { tries: number; maxTries: number; nextTryAt: string | null };
    };

    expect(result.stageKey, 'an attempt is progress').toBe('attempted_contact');
    expect(result.nextStepAt).not.toBeNull();

    /* The try is counted, and the dialler is handed the line to show. */
    expect(result.noAnswer.tries).toBe(1);
    expect(result.noAnswer.maxTries).toBe(5);
    expect(result.noAnswer.nextTryAt).toBe(new Date(String(result.nextStepAt)).toISOString());
    expect(result.said).toContain('No answer');
    expect(result.said).toContain('try 1 of 5');
    /* Words, never a column value, and no emoji. */
    expect(result.said).not.toContain('no_answer');
    expect(/\p{Extended_Pictographic}/u.test(result.said)).toBe(false);

    /* And it is one call with an outcome on it, not a second record beside
       the one the dialler started. */
    const rows = await query<{ id: string; outcome: string; outcome_at: Date | null }>(
      'SELECT id, outcome, outcome_at FROM call_logs WHERE opportunity_id = ?', [lead],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
    expect(rows[0]?.outcome).toBe('no_answer');
    expect(rows[0]?.outcome_at).not.toBeNull();
  });

  it('busy counts as a try and takes no rung of the ladder', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const { id } = await (await send('POST', '/api/v2/calls', cookie, { opportunityId: lead })).json() as { id: string };
    const done = await send('PATCH', `/api/v2/calls/${id}`, cookie, { outcome: 'busy' });
    const result = await done.json() as {
      nextStepAt: string | null; said: string; noAnswer: { tries: number };
    };

    /* We did not speak to them, so it is a try -- and its wait is the busy
       one, which never moves the lead up the 2h / next-morning ladder. */
    expect(result.noAnswer.tries).toBe(1);
    expect(result.nextStepAt).not.toBeNull();
    expect(result.said).toContain('Busy');

    const audit = await queryOne<{ after_json: unknown }>(
      `SELECT after_json FROM audit_log
        WHERE entity_type = 'opportunity' AND entity_id = ? AND action = 'lead.call_result'`,
      [lead],
    );
    const after = typeof audit?.after_json === 'string'
      ? JSON.parse(audit.after_json) as { step: string | null }
      : audit?.after_json as { step: string | null };
    expect(after?.step, 'a busy line takes no rung').toBeNull();
  });

  it('keeps the agent’s own reason when the dialler asks for one', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const { id } = await (await send('POST', '/api/v2/calls', cookie, { opportunityId: lead })).json() as { id: string };
    const done = await send('PATCH', `/api/v2/calls/${id}`, cookie, {
      outcome: 'not_interested', reason: 'bought_elsewhere',
    });
    expect(done.status, await done.clone().text()).toBe(200);
    expect((await done.json() as { status: string }).status).toBe('lost');

    /* The whole value of the lost-reasons report is that it is the agent's
       answer and not a word the server chose. */
    const row = await queryOne<{ lost_reason_v2: string | null }>(
      'SELECT lost_reason_v2 FROM opportunities WHERE id = ?', [lead],
    );
    expect(row?.lost_reason_v2).toBe('bought_elsewhere');
  });

  it('interested moves the lead on and does not reschedule it behind the agent', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const before = await queryOne<{ next_step_at: Date }>(
      'SELECT next_step_at FROM opportunities WHERE id = ?', [lead],
    );

    const { id } = await (await send('POST', '/api/v2/calls', cookie, { opportunityId: lead })).json() as { id: string };
    const result = await (await send('PATCH', `/api/v2/calls/${id}`, cookie, {
      outcome: 'interested', note: 'Wants the payment plan',
    })).json() as { stageKey: string; nextStepAt: string | null };

    expect(result.stageKey).toBe('engaged_qualified');
    /*
     * No-answer and busy carry their own retry; "interested" does not. What
     * happens next is the agent's to choose on the next screen, and the
     * dialler must not quietly move a promise they already made.
     */
    const moved = Math.abs(new Date(String(result.nextStepAt)).getTime()
      - new Date(String(before?.next_step_at)).getTime());
    /* To the second: the column keeps milliseconds and the two reads round
       them differently, which is not the thing being tested. */
    expect(moved).toBeLessThan(1000);
  });

  it('records a call made without checking in, and says so in the audit', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const { id } = await (await send('POST', '/api/v2/calls', cookie, {
      opportunityId: lead, notCheckedIn: true,
    })).json() as { id: string };

    const row = await queryOne<{ not_checked_in: number }>(
      'SELECT not_checked_in FROM call_logs WHERE id = ?', [id],
    );
    expect(row?.not_checked_in).toBe(1);

    const audit = await queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'call.not_checked_in'",
    );
    expect(Number(audit?.n), 'the owner can see it even if no outcome ever arrives').toBe(1);
  });

  it('refuses to start a call on somebody else’s lead', async () => {
    const mine = await createTestUser({ role: 'agent', name: 'Mine' });
    const theirs = await createTestUser({ role: 'agent', name: 'Theirs' });
    const lead = await aLead(theirs.id);

    const res = await send('POST', '/api/v2/calls', await signIn(base, mine), { opportunityId: lead });
    expect(res.status).not.toBe(200);
  });

  it('refuses to put an outcome on somebody else’s call', async () => {
    const one = await createTestUser({ role: 'agent', name: 'One' });
    const two = await createTestUser({ role: 'agent', name: 'Two' });
    const lead = await aLead(one.id);

    const { id } = await (await send('POST', '/api/v2/calls', await signIn(base, one), {
      opportunityId: lead,
    })).json() as { id: string };

    const res = await send('PATCH', `/api/v2/calls/${id}`, await signIn(base, two), {
      outcome: 'interested',
    });
    expect(res.status).not.toBe(200);
  });

  it('logs a WhatsApp tap and never calls it sent', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const { id } = await (await send('POST', '/api/v2/taps', cookie, {
      opportunityId: lead, app: 'whatsapp',
    })).json() as { id: string };

    const row = await queryOne<{ result: string | null; answered_at: Date | null }>(
      'SELECT result, answered_at FROM message_taps WHERE id = ?', [id],
    );
    expect(row?.result, 'a tap has no result until the agent says what happened').toBeNull();
    expect(row?.answered_at).toBeNull();

    const answered = await send('PATCH', `/api/v2/taps/${id}`, cookie, { result: 'replied' });
    expect(answered.status, await answered.clone().text()).toBe(200);
    expect(await answered.json()).toMatchObject({ moved: true });

    const after = await queryOne<{ result: string }>(
      'SELECT result FROM message_taps WHERE id = ?', [id],
    );
    expect(after?.result).toBe('replied');
  });

  it('a tap the agent says they did not send moves nothing', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const { id } = await (await send('POST', '/api/v2/taps', cookie, {
      opportunityId: lead, app: 'telegram',
    })).json() as { id: string };

    const answered = await send('PATCH', `/api/v2/taps/${id}`, cookie, { result: 'not_sent' });
    expect(await answered.json()).toMatchObject({ moved: false });

    const lead_ = await queryOne<{ stage_key: string }>(
      'SELECT stage_key FROM opportunities WHERE id = ?', [lead],
    );
    expect(lead_?.stage_key, 'nothing reached the client, so nothing moved').toBe('new_lead');
  });
});
