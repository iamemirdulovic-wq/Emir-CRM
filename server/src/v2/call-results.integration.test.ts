import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
  type TestUser,
} from '../testing/db.js';
import { execute, query, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { clearSecretCache } from '../config/secrets.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';
import type { SessionUser } from '../auth/sessions.js';
import type { AuditActor } from '../audit/audit.js';
import { saveCallResult, dubaiClock } from './call-results.js';
import { WORK_END_MINUTE, WORK_START_MINUTE } from '../leads/next-step.js';
import { dubaiMinuteOfDay } from '../routing/hours.js';
import { CALL_FROM, CALL_UNTIL, hourIn } from '../leads/countries.js';

/**
 * The no-answer rule against a real database.
 *
 * Two kinds of test here on purpose. The ones that go over HTTP check what the
 * screens will actually get — the shape of the answer, and the fences around
 * it. The ones that call `saveCallResult` directly pass their own `now`, which
 * is the only way to assert that try 3 lands next morning without the answer
 * depending on what time of day the suite happens to run.
 */
let server: Server;
let base = '';

describeWithDb('call results and the no-answer ladder', () => {
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
  beforeEach(async () => { await resetTables(); resetRateLimits(); clearSecretCache(); });
  afterEach(() => { resetRateLimits(); clearSecretCache(); });

  /** A Dubai wall-clock instant. Dubai is UTC+4 all year. */
  const dubai = (day: number, hour: number, minute = 0) =>
    new Date(Date.UTC(2026, 10, day, hour - 4, minute, 0, 0));

  async function aLead(owner: string, over: { phone?: string; project?: string } = {}) {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164, language) VALUES (?, ?, ?, ?)',
      [
        contactId, 'Marco Bellini',
        over.phone ?? `+9715${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`,
        'en',
      ],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title,
          source, project_name)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 'x', 'manual', ?)`,
      [id, contactId, stage!.pipeline_id, stage!.id, stage!.key, owner, over.project ?? 'Sei Saadiyat'],
    );
    return id;
  }

  const send = (method: string, path: string, cookie: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** The session object the engine needs when it is called without HTTP. */
  const asUser = (user: TestUser): SessionUser => ({
    id: user.id,
    name: 'Test User',
    email: user.email,
    role: user.role as SessionUser['role'],
    isActive: true,
    mustChangePassword: false,
    managerId: null,
    locale: 'en',
    availability: 'available',
  } as SessionUser);

  const actorFor = (user: TestUser): AuditActor => ({ userId: user.id, role: user.role as AuditActor['role'] });

  interface State {
    tries: number;
    maxTries: number;
    lastTryAt: string | null;
    nextTryAt: string | null;
    exhausted: boolean;
    whatsapp: { lang: string; langName: string; text: string } | null;
    line: string | null;
    undoUntil: string | null;
  }

  /** The rung each save took, which only the audit knows. */
  async function steps(leadId: string): Promise<Array<string | null>> {
    const rows = await query<{ after_json: unknown }>(
      `SELECT after_json FROM audit_log
        WHERE entity_type = 'opportunity' AND entity_id = ? AND action = 'lead.call_result'
        ORDER BY created_at ASC, id ASC`,
      [leadId],
    );
    return rows.map((row) => {
      const after = typeof row.after_json === 'string'
        ? JSON.parse(row.after_json) as { step?: string | null }
        : row.after_json as { step?: string | null };
      return after?.step ?? null;
    });
  }

  /* ── one tap, no typing (A.1) ───────────────────────────────────────── */

  it('saves a try, with its time, from one tap and nothing else', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const res = await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' });
    expect(res.status, await res.clone().text()).toBe(200);
    const state = await res.json() as State;

    expect(state.tries).toBe(1);
    expect(state.maxTries).toBe(5);
    expect(state.lastTryAt).not.toBeNull();
    expect(state.nextTryAt).not.toBeNull();
    expect(state.exhausted).toBe(false);
    /* The agent reads words, never a column value. */
    expect(state.line).toContain('Try 1 of 5');
    expect(state.line).not.toContain('no_answer');

    /* And the try is on the record as a call, with its outcome. */
    const call = await queryOne<{ outcome: string; outcome_at: Date | null; user_id: string }>(
      'SELECT outcome, outcome_at, user_id FROM call_logs WHERE opportunity_id = ?',
      [lead],
    );
    expect(call?.outcome).toBe('no_answer');
    expect(call?.outcome_at).not.toBeNull();
    expect(call?.user_id).toBe(agent.id);
  });

  it('hands back the "I tried to call you" message and sends nothing', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id, { project: 'Sei Saadiyat' });
    const cookie = await signIn(base, agent);

    const state = await (await send(
      'POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' },
    )).json() as State;

    expect(state.whatsapp).not.toBeNull();
    expect(state.whatsapp?.lang).toBe('en');
    expect(state.whatsapp?.langName).toBe('English');
    expect(state.whatsapp?.text).toContain('Sei Saadiyat');

    /* Nothing was sent, and nothing was recorded as sent: the agent presses
       send himself in WhatsApp. */
    const taps = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM message_taps', []);
    expect(Number(taps?.n ?? 0)).toBe(0);
  });

  /* ── the ladder (A.2) ───────────────────────────────────────────────── */

  it('walks 2 hours, next morning, next evening, two days', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const user = asUser(agent);
    const actor = actorFor(agent);

    const one = await saveCallResult(actor, user, lead, { result: 'no_answer' }, dubai(16, 10, 0));
    expect(one.tries).toBe(1);
    expect(dubaiClock(new Date(one.nextTryAt as string))).toBe('12:00');

    const two = await saveCallResult(actor, user, lead, { result: 'no_answer' }, dubai(16, 12, 0));
    expect(two.tries).toBe(2);
    expect(new Date(two.nextTryAt as string).toISOString()).toBe(dubai(17, 11, 0).toISOString());

    const three = await saveCallResult(actor, user, lead, { result: 'no_answer' }, dubai(17, 11, 0));
    expect(three.tries).toBe(3);
    expect(new Date(three.nextTryAt as string).toISOString()).toBe(dubai(17, 17, 0).toISOString());

    const four = await saveCallResult(actor, user, lead, { result: 'no_answer' }, dubai(17, 17, 0));
    expect(four.tries).toBe(4);
    expect(new Date(four.nextTryAt as string).toISOString()).toBe(dubai(19, 11, 0).toISOString());

    expect(await steps(lead)).toEqual(['2h', 'next_morning', 'next_evening', '2d']);
  });

  it('a busy line is half an hour and does not move the lead up the ladder', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const user = asUser(agent);
    const actor = actorFor(agent);

    const busy = await saveCallResult(actor, user, lead, { result: 'busy' }, dubai(16, 10, 0));
    /* It counts as a try -- we did not speak to them -- and its own wait is
       thirty minutes rather than the first rung's two hours. */
    expect(busy.tries).toBe(1);
    expect(dubaiClock(new Date(busy.nextTryAt as string))).toBe('10:30');
    expect(busy.line).toContain('Try 1 of 5');

    const again = await saveCallResult(actor, user, lead, { result: 'busy' }, dubai(16, 10, 30));
    expect(again.tries).toBe(2);
    expect(dubaiClock(new Date(again.nextTryAt as string))).toBe('11:00');

    /* No rung was taken by either of them. */
    expect(await steps(lead)).toEqual([null, null]);
  });

  it('never promises a try while the client is asleep or the office is shut', async () => {
    const agent = await createTestUser({ role: 'agent' });
    /* A London number, rung at 07:00 Dubai -- before we open, and 03:00 there. */
    const lead = await aLead(agent.id, { phone: '+447700900123' });

    const state = await saveCallResult(
      actorFor(agent), asUser(agent), lead, { result: 'no_answer' }, dubai(16, 7, 0),
    );
    const at = new Date(state.nextTryAt as string);

    const minute = dubaiMinuteOfDay(at);
    expect(minute >= WORK_START_MINUTE, `our hours, got ${dubaiClock(at)}`).toBe(true);
    expect(minute < WORK_END_MINUTE, `our hours, got ${dubaiClock(at)}`).toBe(true);
    const theirs = hourIn('Europe/London', at) as number;
    expect(theirs >= CALL_FROM && theirs < CALL_UNTIL, `their hours, got ${theirs}`).toBe(true);
  });

  /* ── after the last try, nothing happens on its own (A.5) ───────────── */

  it('stops after the fifth try and leaves the decision to a person', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const user = asUser(agent);
    const actor = actorFor(agent);

    let state = await saveCallResult(actor, user, lead, { result: 'no_answer' }, dubai(16, 10, 0));
    for (const hour of [12, 14, 16, 18]) {
      state = await saveCallResult(actor, user, lead, { result: 'no_answer' }, dubai(16, hour, 0));
    }

    expect(state.tries).toBe(5);
    expect(state.exhausted).toBe(true);
    expect(state.nextTryAt).toBeNull();
    expect(state.line).toContain('no more tries');

    /* And no promise was left on the lead, so it shows up in No next step
       rather than sitting under a follow-up nobody made. */
    const lead5 = await queryOne<{ next_step_at: Date | null; status: string }>(
      'SELECT next_step_at, status FROM opportunities WHERE id = ?', [lead],
    );
    expect(lead5?.next_step_at).toBeNull();
    /* Nothing was closed and nothing was marked Lost without a tap. */
    expect(lead5?.status).toBe('open');
  });

  /* ── the four that end the run (contract §1) ────────────────────────── */

  for (const result of ['answered', 'wrong_number', 'not_interested'] as const) {
    it(`"${result}" ends the run and puts the count back to nothing`, async () => {
      const agent = await createTestUser({ role: 'agent' });
      const lead = await aLead(agent.id);
      const cookie = await signIn(base, agent);

      await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' });
      await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' });

      const res = await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result });
      expect(res.status, await res.clone().text()).toBe(200);
      const state = await res.json() as State;

      expect(state.tries).toBe(0);
      expect(state.nextTryAt).toBeNull();
      expect(state.exhausted).toBe(false);
      expect(state.whatsapp).toBeNull();
      expect(state.line).toBeNull();

      const row = await queryOne<{ no_answer_count: number }>(
        'SELECT no_answer_count FROM opportunities WHERE id = ?', [lead],
      );
      expect(Number(row?.no_answer_count)).toBe(0);
    });
  }

  it('a call back ends the run and keeps the time the client asked for', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);
    await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' });

    const when = dubai(20, 11, 0).toISOString();
    const state = await (await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, {
      result: 'call_back', callBackAt: when,
    })).json() as State;

    expect(state.tries).toBe(0);
    /* The run is over, so there is no next TRY -- but the promise the client
       made is kept on the lead. */
    expect(state.nextTryAt).toBeNull();
    const row = await queryOne<{ next_step_at: Date | null }>(
      'SELECT next_step_at FROM opportunities WHERE id = ?', [lead],
    );
    expect(row?.next_step_at?.toISOString()).toBe(when);
  });

  it('asks for the time rather than guessing one', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const res = await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'call_back' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { message: string } }).error.message).toContain('when');
  });

  it('keeps every try in the timeline after the client answers (A.6)', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' });
    await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'busy' });
    await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'answered' });

    const rows = await query<{ type: string; title: string }>(
      'SELECT type, title FROM activities WHERE opportunity_id = ? ORDER BY created_at ASC', [lead],
    );
    expect(rows.filter((row) => row.type === 'no_answer')).toHaveLength(2);
    expect(rows.some((row) => row.title === 'No answer')).toBe(true);
  });

  /* ── the tab and the row field (contract §3, §4) ────────────────────── */

  it('puts the lead in the No answer tab, and on the row', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);
    await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' });

    const list = await (await send('GET', '/api/my-leads?tab=no_answer', cookie)).json() as {
      total: number;
      items: Array<{ id: string; noAnswer: { tries: number; lastTryAt: string | null; nextTryAt: string | null } | null }>;
    };
    expect(list.total).toBe(1);
    expect(list.items[0]?.id).toBe(lead);
    expect(list.items[0]?.noAnswer?.tries).toBe(1);
    expect(list.items[0]?.noAnswer?.lastTryAt).not.toBeNull();
    expect(list.items[0]?.noAnswer?.nextTryAt).not.toBeNull();

    const counts = await (await send('GET', '/api/my-leads/counts', cookie)).json() as Record<string, number>;
    expect(counts.no_answer).toBe(1);

    /* And it leaves the tab the moment somebody gets through. */
    await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'answered' });
    const after = await (await send('GET', '/api/my-leads?tab=no_answer', cookie)).json() as {
      total: number; items: Array<{ noAnswer: unknown }>;
    };
    expect(after.total).toBe(0);

    const all = await (await send('GET', '/api/my-leads?tab=all', cookie)).json() as {
      items: Array<{ id: string; noAnswer: unknown }>;
    };
    expect(all.items.find((one) => one.id === lead)?.noAnswer).toBeNull();
  });

  /* ── the fence ──────────────────────────────────────────────────────── */

  it('will not let an agent save a result on somebody else’s lead', async () => {
    const mine = await createTestUser({ role: 'agent' });
    const theirs = await createTestUser({ role: 'agent' });
    const lead = await aLead(theirs.id);
    const cookie = await signIn(base, mine);

    const res = await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' });
    expect(res.status).toBe(404);

    const row = await queryOne<{ no_answer_count: number }>(
      'SELECT no_answer_count FROM opportunities WHERE id = ?', [lead],
    );
    expect(Number(row?.no_answer_count)).toBe(0);
  });

  it('writes every save to the audit log, with who and what' , async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);
    await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' });

    const row = await queryOne<{ actor_user_id: string; after_json: unknown }>(
      `SELECT actor_user_id, after_json FROM audit_log
        WHERE entity_type = 'opportunity' AND entity_id = ? AND action = 'lead.call_result'`,
      [lead],
    );
    expect(row?.actor_user_id).toBe(agent.id);
    const after = typeof row?.after_json === 'string'
      ? JSON.parse(row.after_json) as { said?: string } : row?.after_json as { said?: string };
    expect(after?.said).toBe('No answer');
  });

  /* ── the settings (contract §5) ─────────────────────────────────────── */

  it('lets the owner change the numbers, and then behaves differently', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const ownerCookie = await signIn(base, owner);

    const before = await (await send('GET', '/api/v2/call-tries', ownerCookie)).json() as {
      max: number; steps: string[]; busyMinutes: number; choices: Array<{ step: string; label: string }>;
    };
    expect(before.max).toBe(5);
    expect(before.steps).toEqual(['2h', 'next_morning', 'next_evening', '2d']);
    /* Every rung the screen offers comes with its words, so no screen writes
       "next_morning" at a person. */
    expect(before.choices.find((one) => one.step === 'next_morning')?.label).toBe('Next morning');

    const saved = await send('PATCH', '/api/v2/call-tries', ownerCookie, {
      max: 2, steps: ['30m'], busyMinutes: 10,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await saved.json()).toMatchObject({ max: 2, steps: ['30m'], busyMinutes: 10 });

    clearSecretCache();
    const agentCookie = await signIn(base, agent);
    const one = await (await send(
      'POST', `/api/v2/leads/${lead}/call-result`, agentCookie, { result: 'no_answer' },
    )).json() as State;
    expect(one.maxTries).toBe(2);
    expect(one.line).toContain('Try 1 of 2');

    const two = await (await send(
      'POST', `/api/v2/leads/${lead}/call-result`, agentCookie, { result: 'no_answer' },
    )).json() as State;
    expect(two.tries).toBe(2);
    expect(two.exhausted).toBe(true);
    expect(two.nextTryAt).toBeNull();
  });

  it('keeps the settings to the owner', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    expect((await send('GET', '/api/v2/call-tries', cookie)).status).toBe(403);
    expect((await send('PATCH', '/api/v2/call-tries', cookie, { max: 1 })).status).toBe(403);
  });

  /* ── taking one back (contract §1b) ─────────────────────────────────── */

  it('takes the last result back and puts the lead where it was', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const first = await (await send(
      'POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' },
    )).json() as State;
    const second = await (await send(
      'POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' },
    )).json() as State;
    expect(second.tries).toBe(2);
    expect(second.undoUntil).not.toBeNull();

    const undone = await send('DELETE', `/api/v2/leads/${lead}/call-result`, cookie);
    expect(undone.status, await undone.clone().text()).toBe(200);
    const state = await undone.json() as State;

    expect(state.tries).toBe(1);
    expect(state.nextTryAt).toBe(first.nextTryAt);

    /* Nothing is erased: the timeline keeps the try and says it was taken
       back, and the figures stop counting it. */
    const rows = await query<{ title: string }>(
      `SELECT title FROM activities
        WHERE opportunity_id = ? AND type = 'no_answer' ORDER BY created_at ASC`,
      [lead],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]?.title).toContain('taken back');

    const audit = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM audit_log
        WHERE entity_type = 'opportunity' AND entity_id = ? AND action = 'lead.call_result_undone'`,
      [lead],
    );
    expect(Number(audit?.n)).toBe(1);
  });

  it('takes the first try back to nothing promised at all', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' });
    const state = await (await send('DELETE', `/api/v2/leads/${lead}/call-result`, cookie)).json() as State;

    expect(state.tries).toBe(0);
    expect(state.nextTryAt).toBeNull();
    expect(state.line).toBeNull();

    const row = await queryOne<{ next_step_at: Date | null; stage_key: string }>(
      'SELECT next_step_at, stage_key FROM opportunities WHERE id = ?', [lead],
    );
    expect(row?.next_step_at).toBeNull();
    /* The stage the try moved it to goes back as well. */
    expect(row?.stage_key).toBe('new_lead');
  });

  it('brings a lead back from Lost when Not interested was the wrong button', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'not_interested' });
    const lost = await queryOne<{ status: string }>('SELECT status FROM opportunities WHERE id = ?', [lead]);
    expect(lost?.status).toBe('lost');

    const res = await send('DELETE', `/api/v2/leads/${lead}/call-result`, cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    const back = await queryOne<{ status: string; stage_key: string }>(
      'SELECT status, stage_key FROM opportunities WHERE id = ?', [lead],
    );
    expect(back?.status).toBe('open');
    expect(back?.stage_key).toBe('new_lead');
  });

  it('refuses a second undo, because there is nothing left to take back', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);
    await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' });
    await send('DELETE', `/api/v2/leads/${lead}/call-result`, cookie);

    const res = await send('DELETE', `/api/v2/leads/${lead}/call-result`, cookie);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { message: string } }).error.message).toContain('nothing to take back');
  });

  it('refuses an undo once the toast has long gone, and says so', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    await saveCallResult(actorFor(agent), asUser(agent), lead, { result: 'no_answer' }, dubai(16, 10, 0));

    /* The audit row is the journal the undo reads, so ageing it is what ages
       the result. Eleven minutes: the window is ten. */
    await execute(
      `UPDATE audit_log SET created_at = DATE_SUB(NOW(3), INTERVAL 11 MINUTE)
        WHERE entity_type = 'opportunity' AND entity_id = ? AND action = 'lead.call_result'`,
      [lead],
    );

    const cookie = await signIn(base, agent);
    const res = await send('DELETE', `/api/v2/leads/${lead}/call-result`, cookie);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { message: string } }).error.message).toContain('10 minutes');

    /* And the try stands. */
    const row = await queryOne<{ no_answer_count: number }>(
      'SELECT no_answer_count FROM opportunities WHERE id = ?', [lead],
    );
    expect(Number(row?.no_answer_count)).toBe(1);
  });

  it('lets only the agent who saved it, or an owner, take it back', async () => {
    const manager = await createTestUser({ role: 'manager' });
    const agent = await createTestUser({ role: 'agent', managerId: manager.id });
    const owner = await createTestUser({ role: 'owner' });
    const lead = await aLead(agent.id);

    await saveCallResult(actorFor(agent), asUser(agent), lead, { result: 'no_answer' }, dubai(16, 10, 0));

    /* The manager can see the lead and still may not rewrite the call. */
    const managerCookie = await signIn(base, manager);
    const refused = await send('DELETE', `/api/v2/leads/${lead}/call-result`, managerCookie);
    expect(refused.status).toBe(403);

    const ownerCookie = await signIn(base, owner);
    const allowed = await send('DELETE', `/api/v2/leads/${lead}/call-result`, ownerCookie);
    expect(allowed.status, await allowed.clone().text()).toBe(200);
    expect((await allowed.json() as State).tries).toBe(0);
  });

  /* ── the owner's numbers (H.1) ──────────────────────────────────────── */

  it('counts no-answer tries per agent, and drops the ones taken back', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const one = await createTestUser({ role: 'agent', name: 'Layla' });
    const two = await createTestUser({ role: 'agent', name: 'Omar' });
    const leadOne = await aLead(one.id);
    const leadTwo = await aLead(two.id);

    const cookieOne = await signIn(base, one);
    await send('POST', `/api/v2/leads/${leadOne}/call-result`, cookieOne, { result: 'no_answer' });
    await send('POST', `/api/v2/leads/${leadOne}/call-result`, cookieOne, { result: 'busy' });

    const cookieTwo = await signIn(base, two);
    await send('POST', `/api/v2/leads/${leadTwo}/call-result`, cookieTwo, { result: 'no_answer' });

    const ownerCookie = await signIn(base, owner);
    const report = await (await send('GET', '/api/v2/call-tries/report?period=today', ownerCookie)).json() as {
      label: string; total: number; agents: Array<{ userId: string; tries: number; leads: number }>;
    };
    expect(report.label).toBe('Today');
    expect(report.total).toBe(3);
    expect(report.agents.find((a) => a.userId === one.id)?.tries).toBe(2);
    expect(report.agents.find((a) => a.userId === one.id)?.leads).toBe(1);
    expect(report.agents.find((a) => a.userId === two.id)?.tries).toBe(1);

    /* A try taken back is not a try anybody made. */
    await send('DELETE', `/api/v2/leads/${leadOne}/call-result`, cookieOne);
    const after = await (await send('GET', '/api/v2/call-tries/report?period=today', ownerCookie)).json() as {
      total: number;
    };
    expect(after.total).toBe(2);

    /* An agent sees their own line and nobody else's. */
    const seen = await (await send('GET', '/api/v2/call-tries/report?period=week', cookieTwo)).json() as {
      label: string; agents: Array<{ userId: string }>;
    };
    expect(seen.label).toBe('Last 7 days');
    expect(seen.agents.map((a) => a.userId)).toEqual([two.id]);
  });

  /* ── reading it back ────────────────────────────────────────────────── */

  it('answers the same state without changing anything', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);
    const saved = await (await send(
      'POST', `/api/v2/leads/${lead}/call-result`, cookie, { result: 'no_answer' },
    )).json() as State;

    const read = await (await send('GET', `/api/v2/leads/${lead}/call-result`, cookie)).json() as State;
    expect(read.tries).toBe(saved.tries);
    expect(read.nextTryAt).toBe(saved.nextTryAt);
    expect(read.lastTryAt).toBe(saved.lastTryAt);
    /* The message is offered when a try is saved, not every time a card is
       drawn -- a screen asks for it by saving, never by looking. */
    expect(read.whatsapp).toBeNull();
  });

  it('writes the outcome onto the dialler’s own call row when it has one', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const started = await (await send('POST', '/api/v2/calls', cookie, {
      opportunityId: lead, source: 'dialler',
    })).json() as { id: string };

    await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, {
      result: 'no_answer', callId: started.id,
    });

    /* One call, one row -- never a second record of the same call. */
    const rows = await query<{ id: string; outcome: string | null }>(
      'SELECT id, outcome FROM call_logs WHERE opportunity_id = ?', [lead],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(started.id);
    expect(rows[0]?.outcome).toBe('no_answer');
  });

  it('will not write an outcome onto a call to a different lead', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const other = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const started = await (await send('POST', '/api/v2/calls', cookie, {
      opportunityId: other,
    })).json() as { id: string };

    const res = await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, {
      result: 'no_answer', callId: started.id,
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { message: string } }).error.message)
      .toContain('a different lead');
  });

  it('will not write an outcome onto somebody else’s call', async () => {
    const mine = await createTestUser({ role: 'agent' });
    const theirs = await createTestUser({ role: 'agent' });
    const lead = await aLead(mine.id);
    const otherLead = await aLead(theirs.id);

    const theirCookie = await signIn(base, theirs);
    const started = await (await send('POST', '/api/v2/calls', theirCookie, {
      opportunityId: otherLead,
    })).json() as { id: string };

    const cookie = await signIn(base, mine);
    const res = await send('POST', `/api/v2/leads/${lead}/call-result`, cookie, {
      result: 'no_answer', callId: started.id,
    });
    expect(res.status).toBe(403);
  });
});
