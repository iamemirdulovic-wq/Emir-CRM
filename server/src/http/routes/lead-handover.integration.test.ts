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
 * Who has had this lead — the owner's "two dates", as the endpoint sends them.
 *
 * Emir, 14 Nov 2026, hours after the single "Given out" date shipped:
 *
 * > "Exact date when leads coming from admin and owner, always need to show
 * > date, and if we have another agents like transfer leads date it's need to
 * > also showing like on the leads page, this leads transfer from this agent
 * > with the date, mean 2 dates."
 *
 * `opportunities.assigned_at` only ever holds the current holder's date, so
 * the second date can only come out of the history. **`lead_assignments` is
 * the chain** — one row per hand-out since migration 0013, with
 * `assigned_by_user_id` naming the giver and NULL when the CRM did it by
 * itself. `lead_transfers` is a table of *requests*, most of which were never
 * accepted, so it is read here for one thing only: the reason the sending
 * agent gave. These tests hold four things:
 *
 *   1. a lead handed out once reads as one line, naming the giver;
 *   2. a lead moved twice reads as three lines, oldest first;
 *   3. a lead the CRM placed names no person;
 *   4. an agent cannot read the history of a lead they cannot see, and the
 *      same hand-over never appears twice.
 *
 * No migration was needed for any of it.
 */
let server: Server;
let base = '';

describeWithDb('who has had this lead', () => {
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

  /** MySQL's own `DATETIME(3)` spelling of an instant. */
  const sql = (at: Date) => at.toISOString().slice(0, 23).replace('T', ' ');

  async function firstStage(): Promise<{ id: string; pipeline_id: string; key: string }> {
    const row = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    return row!;
  }

  interface Lead { id: string; contactId: string }

  async function aLead(owner: string | null, assignedAt: Date | null = new Date()): Promise<Lead> {
    const stage = await firstStage();
    const contactId = newId();
    await execute(
      `INSERT INTO contacts (id, full_name, phone_e164, email, language, owner_user_id)
       VALUES (?, 'Marco Bellini', ?, ?, 'en', ?)`,
      [
        contactId,
        `+3933312${Math.floor(Math.random() * 90000) + 10000}`,
        `lead-${contactId.slice(0, 8)}@example.com`,
        owner,
      ],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title, source,
          project_name, assigned_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 'Marco Bellini', 'referral', 'The Archive', ?)`,
      [
        id, contactId, stage.pipeline_id, stage.id, stage.key, owner,
        assignedAt === null ? null : sql(assignedAt),
      ],
    );
    return { id, contactId };
  }

  /** One row of `lead_assignments`, exactly as the real paths write them. */
  async function handedTo(
    lead: Lead,
    agentUserId: string,
    by: string | null,
    at: Date,
    outcome: 'working' | 'reassigned' | 'bounced' | 'closed' = 'working',
  ): Promise<string> {
    const id = newId();
    await execute(
      `INSERT INTO lead_assignments
         (id, opportunity_id, contact_id, agent_user_id, assigned_by_user_id, assigned_at, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, lead.id, lead.contactId, agentUserId, by, sql(at), outcome],
    );
    return id;
  }

  interface Step {
    id: string;
    at: string;
    toName: string | null;
    fromName: string | null;
    by: 'person' | 'crm' | 'unknown';
    byName: string | null;
    reason: string | null;
    note: string | null;
  }

  async function chain(leadId: string, cookie: string): Promise<Step[]> {
    const res = await fetch(`${base}/api/my-leads/${leadId}/handover`, { headers: { cookie } });
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { items: Step[] }).items;
  }

  /* ── 1. one hand-out ──────────────────────────────────────────────── */

  it('a lead handed out once shows one line, naming who handed it out', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir Dulovic' });
    const agent = await createTestUser({ role: 'agent', name: 'Talha Khan' });
    const givenAt = new Date(Date.UTC(2026, 10, 12, 6, 5, 0));
    const lead = await aLead(agent.id, givenAt);
    await handedTo(lead, agent.id, boss.id, givenAt);

    const steps = await chain(lead.id, await signIn(base, boss));
    expect(steps).toHaveLength(1);
    const only = steps[0]!;
    expect(only.toName).toBe('Talha Khan');
    expect(only.fromName, 'the first hand-out came from nobody').toBeNull();
    expect(only.by).toBe('person');
    expect(only.byName).toBe('Emir Dulovic');
    expect(Math.abs(new Date(only.at).getTime() - givenAt.getTime())).toBeLessThan(1_000);
  });

  /* ── 2. two moves, three lines, oldest first ──────────────────────── */

  it('a lead transferred twice shows three lines, oldest first', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir Dulovic' });
    const talha = await createTestUser({ role: 'agent', name: 'Talha Khan' });
    const raj = await createTestUser({ role: 'agent', name: 'Raj Mehta' });
    const sara = await createTestUser({ role: 'agent', name: 'Sara Ali' });

    const first = new Date(Date.UTC(2026, 10, 10, 6, 0, 0));
    const second = new Date(Date.UTC(2026, 10, 12, 7, 15, 0));
    const third = new Date(Date.UTC(2026, 10, 13, 12, 30, 0));

    const lead = await aLead(sara.id, third);
    await handedTo(lead, talha.id, boss.id, first, 'reassigned');
    await handedTo(lead, raj.id, talha.id, second, 'reassigned');
    await handedTo(lead, sara.id, raj.id, third);

    const steps = await chain(lead.id, await signIn(base, boss));
    expect(steps).toHaveLength(3);
    expect(steps.map((one) => one.toName)).toEqual(['Talha Khan', 'Raj Mehta', 'Sara Ali']);
    /* Each move says where it came from, which is what the owner asked for in
       so many words: "this leads transfer from this agent with the date". */
    expect(steps.map((one) => one.fromName)).toEqual([null, 'Talha Khan', 'Raj Mehta']);
    /* Oldest first, and every line carries its own instant. */
    const times = steps.map((one) => new Date(one.at).getTime());
    expect(times[1]).toBeGreaterThan(times[0]!);
    expect(times[2]).toBeGreaterThan(times[1]!);
  });

  it('adds the reason from the transfer that produced the move, once', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir Dulovic' });
    const talha = await createTestUser({ role: 'agent', name: 'Talha Khan' });
    const raj = await createTestUser({ role: 'agent', name: 'Raj Mehta' });
    const first = new Date(Date.UTC(2026, 10, 10, 6, 0, 0));
    const moved = new Date(Date.UTC(2026, 10, 12, 7, 15, 0));

    const lead = await aLead(raj.id, moved);
    await handedTo(lead, talha.id, boss.id, first, 'reassigned');
    await handedTo(lead, raj.id, talha.id, moved);
    /* The accepted request, written by `v2/transfers.ts` in the same
       transaction as the assignment row above. */
    await execute(
      `INSERT INTO lead_transfers
         (id, opportunity_id, from_user_id, to_user_id, reason, note, status, decided_at, requested_at)
       VALUES (?, ?, ?, ?, 'knows_project', 'He sold three there.', 'accepted', ?, ?)`,
      [newId(), lead.id, talha.id, raj.id, sql(moved), sql(first)],
    );

    const steps = await chain(lead.id, await signIn(base, boss));
    expect(steps).toHaveLength(3 - 1);
    expect(steps[0]!.reason, 'the first hand-out was not a transfer').toBeNull();
    expect(steps[1]!.reason).toBe('knows_project');
    expect(steps[1]!.note).toBe('He sold three there.');
  });

  it('never shows a hand-over twice, and ignores a refused request', async () => {
    /*
     * `lead_assignments` and `lead_transfers` can both describe the same move.
     * The chain is the assignments; a transfer only annotates one of them. So
     * a refused request — which is not a hand-over at all — must leave no
     * line and no reason behind it.
     */
    const boss = await createTestUser({ role: 'owner', name: 'Emir Dulovic' });
    const talha = await createTestUser({ role: 'agent', name: 'Talha Khan' });
    const raj = await createTestUser({ role: 'agent', name: 'Raj Mehta' });
    const at = new Date(Date.UTC(2026, 10, 10, 6, 0, 0));

    const lead = await aLead(talha.id, at);
    await handedTo(lead, talha.id, boss.id, at);
    for (const status of ['pending', 'refused', 'cancelled', 'expired'] as const) {
      await execute(
        `INSERT INTO lead_transfers
           (id, opportunity_id, from_user_id, to_user_id, reason, status, decided_at, requested_at)
         VALUES (?, ?, ?, ?, 'too_many', ?, ?, ?)`,
        [newId(), lead.id, talha.id, raj.id, status, sql(at), sql(at)],
      );
    }

    const steps = await chain(lead.id, await signIn(base, boss));
    expect(steps, 'one hand-out, four requests, one line').toHaveLength(1);
    expect(steps[0]!.reason).toBeNull();
  });

  /* ── 3. the CRM is not a person ───────────────────────────────────── */

  it('names no person for a lead the CRM assigned by itself', async () => {
    /*
     * `assigned_by_user_id` is NULL on every assignment Workflow A made,
     * which is the normal case. Picking a name there would be an invention.
     */
    const boss = await createTestUser({ role: 'owner', name: 'Emir Dulovic' });
    const agent = await createTestUser({ role: 'agent', name: 'Talha Khan' });
    const at = new Date(Date.UTC(2026, 10, 14, 5, 30, 0));
    const lead = await aLead(agent.id, at);
    await handedTo(lead, agent.id, null, at);

    const steps = await chain(lead.id, await signIn(base, boss));
    expect(steps).toHaveLength(1);
    expect(steps[0]!.by).toBe('crm');
    expect(steps[0]!.byName).toBeNull();
  });

  it('gives the date and no name for a hand-out this CRM never recorded', async () => {
    /*
     * The bulk-assign screen, "share equally", a claim from the shared pool
     * and a straight move all change the owner without writing a
     * `lead_assignments` row. Rather than a blank block on a lead that
     * plainly has an agent, the current holder comes from the lead's own
     * `assigned_at` — as `unknown`, so no screen can name a giver.
     */
    const boss = await createTestUser({ role: 'owner', name: 'Emir Dulovic' });
    const agent = await createTestUser({ role: 'agent', name: 'Talha Khan' });
    const at = new Date(Date.UTC(2026, 10, 13, 9, 0, 0));
    const lead = await aLead(agent.id, at);

    const steps = await chain(lead.id, await signIn(base, boss));
    expect(steps).toHaveLength(1);
    expect(steps[0]!.by).toBe('unknown');
    expect(steps[0]!.byName).toBeNull();
    expect(steps[0]!.toName).toBe('Talha Khan');
    expect(Math.abs(new Date(steps[0]!.at).getTime() - at.getTime())).toBeLessThan(1_000);
  });

  it('sends nothing at all for a lead nobody has been given', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const lead = await aLead(null, null);

    const steps = await chain(lead.id, await signIn(base, boss));
    /* Empty, not a borrowed `created_at`. The screen says "Not given out yet"
       from this; a confident wrong date would be worse than a blank. */
    expect(steps).toEqual([]);
  });

  /* ── 4. the real paths, end to end ────────────────────────────────── */

  it('reads a real owner hand-out and a real transfer as two lines', async () => {
    /*
     * Not hand-written rows: the owner assigns through `/api/incoming/assign`
     * and the two agents transfer through `/api/v2/transfers`, which is the
     * only way to know that `lead_assignments` and `lead_transfers` really do
     * line up the way `leads/handovers.ts` assumes.
     */
    const boss = await createTestUser({ role: 'owner', name: 'Emir Dulovic' });
    const talha = await createTestUser({ role: 'agent', name: 'Talha Khan' });
    const raj = await createTestUser({ role: 'agent', name: 'Raj Mehta' });
    const lead = await aLead(null, null);

    const bossCookie = await signIn(base, boss);
    const post = (path: string, cookie: string, body: unknown) => fetch(`${base}${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const gave = await post('/api/incoming/assign', bossCookie, {
      opportunityIds: [lead.id], agentUserId: talha.id,
    });
    expect(gave.status, await gave.clone().text()).toBe(200);

    const talhaCookie = await signIn(base, talha);
    const asked = await post('/api/v2/transfers', talhaCookie, {
      opportunityId: lead.id, toUserId: raj.id, reason: 'knows_project', note: 'He sold three there.',
    });
    expect(asked.status, await asked.clone().text()).toBe(201);
    const request = (await asked.json()) as { id: string };

    const took = await post(`/api/v2/transfers/${request.id}/answer`, await signIn(base, raj), {
      accept: true,
    });
    expect(took.status, await took.clone().text()).toBe(200);

    const steps = await chain(lead.id, bossCookie);
    expect(steps).toHaveLength(2);

    expect(steps[0]!.toName).toBe('Talha Khan');
    expect(steps[0]!.fromName).toBeNull();
    expect(steps[0]!.by, 'the owner handed it out, and is named').toBe('person');
    expect(steps[0]!.byName).toBe('Emir Dulovic');
    expect(steps[0]!.reason, 'a hand-out is not a transfer').toBeNull();

    expect(steps[1]!.toName).toBe('Raj Mehta');
    expect(steps[1]!.fromName, 'the move says where it came from').toBe('Talha Khan');
    expect(steps[1]!.reason).toBe('knows_project');
    expect(steps[1]!.note).toBe('He sold three there.');
    /* Oldest first, and the move is after the hand-out. */
    expect(new Date(steps[1]!.at).getTime())
      .toBeGreaterThanOrEqual(new Date(steps[0]!.at).getTime());
  });

  /* ── 5. the fence ─────────────────────────────────────────────────── */

  it('an agent cannot read the history of a lead they cannot see', async () => {
    const mine = await createTestUser({ role: 'agent', name: 'Talha Khan' });
    const theirs = await createTestUser({ role: 'agent', name: 'Raj Mehta' });
    const boss = await createTestUser({ role: 'owner', name: 'Emir Dulovic' });
    const at = new Date(Date.UTC(2026, 10, 12, 6, 0, 0));
    const lead = await aLead(theirs.id, at);
    await handedTo(lead, theirs.id, boss.id, at);

    const cookie = await signIn(base, mine);
    const res = await fetch(`${base}/api/my-leads/${lead.id}/handover`, { headers: { cookie } });
    expect(res.status, 'the same fence the rest of the screen uses').toBe(400);
    const said = await res.text();
    expect(said).toContain('not yours to work');
    /* And nothing about the other agent leaks out with the refusal. */
    expect(said).not.toContain('Raj Mehta');
    expect(said).not.toContain('Emir Dulovic');

    /* The agent who holds it can read it. */
    expect(await chain(lead.id, await signIn(base, theirs))).toHaveLength(1);
  });

  it('refuses a signed-out reader', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const res = await fetch(`${base}/api/my-leads/${lead.id}/handover`);
    expect(res.status).toBe(401);
  });

  it('writes nothing to audit_log — it only reads', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir Dulovic' });
    const agent = await createTestUser({ role: 'agent', name: 'Talha Khan' });
    const at = new Date(Date.UTC(2026, 10, 12, 6, 0, 0));
    const lead = await aLead(agent.id, at);
    await handedTo(lead, agent.id, boss.id, at);
    const cookie = await signIn(base, boss);

    const before = await queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ? AND action <> 'auth.login'",
      [lead.id],
    );
    await chain(lead.id, cookie);
    const after = await queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ? AND action <> 'auth.login'",
      [lead.id],
    );
    expect(Number(after?.n)).toBe(Number(before?.n));
  });
});
