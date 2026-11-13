import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { execute, query, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { setEnvForTesting } from '../../config/env.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';

/**
 * The nine faults the owner found by hand on the leads screens, 13 Nov 2026.
 *
 * Each `it` below is one of them. They are written against the real HTTP
 * endpoints rather than the services underneath, because several of the
 * faults were not in the logic at all — the column existed, the service
 * handled it, and the route simply never selected it or never offered it.
 */
let server: Server;
let base = '';

describeWithDb('the leads screens', () => {
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

  async function stage(): Promise<{ id: string; pipeline_id: string; key: string }> {
    const row = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    return row!;
  }

  interface LeadOver {
    name?: string;
    phone?: string;
    project?: string | null;
    lastContactAt?: string | null;
    nextStepAt?: string | null;
    createdAt?: string | null;
    telegram?: string | null;
    whatsapp?: string | null;
    nationality?: string | null;
  }

  async function aLead(owner: string, over: LeadOver = {}): Promise<{ id: string; contactId: string }> {
    const first = await stage();
    const contactId = newId();
    await execute(
      `INSERT INTO contacts (id, full_name, phone_e164, email, language, telegram, whatsapp_number, nationality)
       VALUES (?, ?, ?, ?, 'en', ?, ?, ?)`,
      [
        contactId,
        over.name ?? 'Marco Bellini',
        over.phone ?? `+3933312${Math.floor(Math.random() * 90000) + 10000}`,
        `marco-${contactId.slice(0, 8)}@example.com`,
        over.telegram ?? null,
        over.whatsapp ?? null,
        over.nationality ?? null,
      ],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title, source,
          project_name, unit_type, budget_band, last_contact_at, next_step_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 'Marco', 'referral', ?, '2BR', 'AED 2M', ?, ?,
               COALESCE(?, NOW(3)))`,
      [
        id, contactId, first.pipeline_id, first.id, first.key, owner,
        over.project === undefined ? 'The Archive' : over.project,
        over.lastContactAt ?? null,
        over.nextStepAt ?? null,
        over.createdAt ?? null,
      ],
    );
    return { id, contactId };
  }

  const get = (path: string, cookie: string) => fetch(`${base}${path}`, { headers: { cookie } });
  const send = (method: string, path: string, cookie: string, body: unknown) => fetch(
    `${base}${path}`,
    { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );

  /* ── 1. the owner's own screen ─────────────────────────────────────────── */

  /*
   * The owner lands on All leads, which is the tab their screen is built
   * around, and the tab beside it is "Going cold" — the one an owner opens
   * the screen to look at. There was no such tab and no such count.
   */
  it('counts the leads that are going cold, for the owner’s own screen', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    /* Spoken to nine days ago and nothing planned: going cold. */
    await aLead(agent.id, {
      name: 'Mariam Saleh',
      lastContactAt: new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 19).replace('T', ' '),
    });
    /* Spoken to nine days ago but with a follow-up booked: not going cold,
       because somebody is coming back to it on a day they chose. */
    await aLead(agent.id, {
      name: 'Has A Plan',
      lastContactAt: new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 19).replace('T', ' '),
      nextStepAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 19).replace('T', ' '),
    });
    /* Spoken to this morning: not going cold. */
    await aLead(agent.id, { name: 'Fresh Today', lastContactAt: new Date().toISOString().slice(0, 19).replace('T', ' ') });

    const cookie = await signIn(base, boss);
    const counts = await (await get('/api/my-leads/counts', cookie)).json() as Record<string, number>;
    expect(counts.cold, 'only the lead with no plan and no contact for a week').toBe(1);

    const list = await (await get('/api/my-leads?tab=cold', cookie)).json() as
      { items: Array<{ full_name: string }>; total: number };
    expect(list.total).toBe(1);
    expect(list.items[0]?.full_name).toBe('Mariam Saleh');
  });

  /* ── 2. moving several leads at once, and undoing it ──────────────────── */

  /*
   * The tick boxes and the "Move N leads" panel were in the phone branch
   * only, and the move itself was one HTTP request per lead from the browser
   * with no way back. One request now carries the batch and answers with
   * where each lead came from, which is what makes the design's Undo work.
   */
  it('moves a batch in one request and says where each lead came from', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const from = await createTestUser({ role: 'agent', name: 'Shan' });
    const to = await createTestUser({ role: 'agent', name: 'Rocky' });
    const one = await aLead(from.id, { name: 'Lead One' });
    const two = await aLead(from.id, { name: 'Lead Two' });
    const cookie = await signIn(base, boss);

    const res = await send('POST', '/api/my-leads/move', cookie, {
      moves: [one, two].map((lead) => ({ id: lead.id, toUserId: to.id })),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as {
      moved: Array<{ id: string; fromUserId: string | null; fromName: string | null }>;
      said: string;
    };
    expect(body.moved).toHaveLength(2);
    expect(body.moved.every((row) => row.fromUserId === from.id)).toBe(true);
    expect(body.said).toContain('2 leads moved');
    expect(body.said, 'the design’s own words').toContain('notes and history went with them');

    const after = await query<{ owner_user_id: string }>(
      'SELECT owner_user_id FROM opportunities WHERE id IN (?, ?)',
      [one.id, two.id],
    );
    expect(after.every((row) => row.owner_user_id === to.id)).toBe(true);

    /* One notification for the batch, not one per lead. */
    const told = await query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?',
      [to.id],
    );
    expect(Number(told[0]?.n)).toBe(1);

    /* Undo: the same endpoint with the list inverted. */
    const undo = await send('POST', '/api/my-leads/move', cookie, {
      moves: body.moved.map((row) => ({ id: row.id, toUserId: row.fromUserId })),
    });
    expect(undo.status, await undo.clone().text()).toBe(200);
    const back = await query<{ owner_user_id: string }>(
      'SELECT owner_user_id FROM opportunities WHERE id IN (?, ?)',
      [one.id, two.id],
    );
    expect(back.every((row) => row.owner_user_id === from.id)).toBe(true);
  });

  it('puts a lead in Incoming when it is moved to nobody', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    const { id } = await aLead(agent.id);

    const res = await send('POST', '/api/my-leads/move', await signIn(base, boss), {
      moves: [{ id, toUserId: null }],
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const saved = await queryOne<{ owner_user_id: string | null; assigned_at: Date | null }>(
      'SELECT owner_user_id, assigned_at FROM opportunities WHERE id = ?',
      [id],
    );
    expect(saved?.owner_user_id).toBeNull();
    expect(saved?.assigned_at).toBeNull();
    /* And it is in the free-leads queue, or Incoming would not show it. */
    const queued = await queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM unassigned_queue WHERE opportunity_id = ? AND resolved_at IS NULL',
      [id],
    );
    expect(Number(queued?.n)).toBe(1);
  });

  it('does not let an agent move leads from this screen', async () => {
    const mine = await createTestUser({ role: 'agent' });
    const other = await createTestUser({ role: 'agent' });
    const { id } = await aLead(mine.id);

    const res = await send('POST', '/api/my-leads/move', await signIn(base, mine), {
      moves: [{ id, toUserId: other.id }],
    });
    expect(res.status, 'an agent asks for a transfer instead').toBe(400);
    const saved = await queryOne<{ owner_user_id: string }>(
      'SELECT owner_user_id FROM opportunities WHERE id = ?',
      [id],
    );
    expect(saved?.owner_user_id).toBe(mine.id);
  });

  it('skips a lead the mover may not see rather than failing the batch', async () => {
    const manager = await createTestUser({ role: 'manager', name: 'Manager' });
    const mine = await createTestUser({ role: 'agent', managerId: manager.id });
    const elsewhere = await createTestUser({ role: 'agent' });
    const ours = await aLead(mine.id, { name: 'Ours' });
    const theirs = await aLead(elsewhere.id, { name: 'Not ours' });

    const res = await send('POST', '/api/my-leads/move', await signIn(base, manager), {
      moves: [
        { id: ours.id, toUserId: manager.id },
        { id: theirs.id, toUserId: mine.id },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { moved: unknown[]; skipped: number };
    expect(body.moved, 'the manager’s own team’s lead moves').toHaveLength(1);
    expect(body.skipped, 'the other team’s lead is left where it is').toBe(1);

    const untouched = await queryOne<{ owner_user_id: string }>(
      'SELECT owner_user_id FROM opportunities WHERE id = ?',
      [theirs.id],
    );
    expect(untouched?.owner_user_id).toBe(elsewhere.id);
  });

  it('hands back the ids behind the filters, for “Select all”', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id, { name: 'In Valia', project: 'Valia' });
    await aLead(agent.id, { name: 'Also Valia', project: 'Valia' });
    await aLead(agent.id, { name: 'Elsewhere', project: 'The Archive' });

    const body = await (await get('/api/my-leads/ids?tab=all&project=valia', await signIn(base, boss)))
      .json() as { ids: string[]; limit: number };
    expect(body.ids, 'the filter applies to the ids as well as to the page').toHaveLength(2);
    expect(body.limit).toBeGreaterThan(0);
  });

  /* ── 4. the project filter ─────────────────────────────────────────────── */

  /*
   * The dropdown was filled from the project library, which has no unique key
   * on `name` — so a library row entered twice showed the project twice — and
   * then matched `o.project_name = ?` exactly against free text, so an option
   * could return nothing at all. Both halves are fixed here: the list is the
   * projects the leads are really on, and the match ignores case and spacing.
   */
  it('offers one option per project the leads are really on', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id, { name: 'One', project: 'Sei Saadiyat' });
    /* The same project, typed differently. One option, two leads. */
    await aLead(agent.id, { name: 'Two', project: 'sei  saadiyat' });
    await aLead(agent.id, { name: 'Three', project: 'Valia' });
    await aLead(agent.id, { name: 'Four', project: null });
    /* A library project nobody has enquired about: not an option. */
    await execute(
      `INSERT INTO projects (id, slug, name, developer, emirate, is_active)
       VALUES (?, 'ghost-tower', 'Ghost Tower', 'Nobody', 'dubai', 1)`,
      [newId()],
    );

    const cookie = await signIn(base, boss);
    const body = await (await get('/api/my-leads/projects', cookie)).json() as
      { items: Array<{ name: string; leads: number }> };

    const names = body.items.map((one) => one.name);
    expect(names, 'one row per project, and only projects a lead carries').toHaveLength(2);
    expect(names).toContain('Valia');
    expect(names.some((one) => /saadiyat/i.test(one))).toBe(true);
    expect(names).not.toContain('Ghost Tower');

    const saadiyat = body.items.find((one) => /saadiyat/i.test(one.name));
    expect(saadiyat?.leads, 'both spellings counted as the one project').toBe(2);
  });

  it('finds the leads however the project was typed', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id, { name: 'One', project: 'Sei Saadiyat' });
    await aLead(agent.id, { name: 'Two', project: 'sei  saadiyat' });
    await aLead(agent.id, { name: 'Three', project: 'Valia' });
    const cookie = await signIn(base, boss);

    for (const asked of ['Sei Saadiyat', 'sei saadiyat', 'sei-saadiyat', 'SEISAADIYAT']) {
      // eslint-disable-next-line no-await-in-loop -- four reads, in order, on purpose.
      const body = await (await get(`/api/my-leads?tab=all&project=${encodeURIComponent(asked)}`, cookie))
        .json() as { total: number };
      expect(body.total, `"${asked}" must still find both leads`).toBe(2);
    }

    const other = await (await get('/api/my-leads?tab=all&project=valia', cookie)).json() as { total: number };
    expect(other.total, 'and must not drag in the rest').toBe(1);
  });

  /* ── 6. what the client wants ──────────────────────────────────────────── */

  it('sends purpose, timeline and payment with the lead', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { id } = await aLead(agent.id);
    await execute(
      "UPDATE opportunities SET purpose = 'investment', timeline = '1_3_months', payment_method = 'mortgage' WHERE id = ?",
      [id],
    );

    const body = await (await get(`/api/my-leads/${id}`, await signIn(base, agent))).json() as
      { lead: Record<string, unknown> };
    expect(body.lead.purpose).toBe('investment');
    expect(body.lead.timeline).toBe('1_3_months');
    expect(body.lead.payment_method).toBe('mortgage');
    expect(body.lead.budget_band).toBe('AED 2M');
  });

  it('saves an edited line, and writes it onto the timeline and the history', async () => {
    const agent = await createTestUser({ role: 'agent', name: 'Rocky' });
    const { id } = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const res = await send('PATCH', `/api/my-leads/${id}/wants`, cookie, {
      budget: '1.5M - 2M',
      purpose: 'investment',
      timeline: '1_3_months',
      payment: 'payment_plan',
      unit: '3BR',
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const saved = await queryOne<Record<string, unknown>>(
      `SELECT purpose, timeline, payment_method, unit_type, budget_band, budget_min_aed, budget_max_aed
         FROM opportunities WHERE id = ?`,
      [id],
    );
    expect(saved?.purpose).toBe('investment');
    expect(saved?.timeline).toBe('1_3_months');
    expect(saved?.payment_method).toBe('payment_plan');
    expect(saved?.unit_type).toBe('3BR');
    /* The figures come out of what the agent typed, never invented. */
    expect(Number(saved?.budget_min_aed)).toBe(1_500_000);
    expect(Number(saved?.budget_max_aed)).toBe(2_000_000);

    const timeline = await query<{ type: string; title: string }>(
      'SELECT type, title FROM activities WHERE opportunity_id = ? AND type = ?',
      [id, 'field_edit'],
    );
    expect(timeline.length, 'an edit is a line on the timeline').toBe(1);

    const history = await (await get(`/api/my-leads/${id}/history`, cookie)).json() as
      { items: Array<{ what: string; detail: string | null }> };
    expect(
      history.items.some((one) => /Rocky changed Budget/.test(one.what)),
      'and a row in the change history',
    ).toBe(true);
    expect(history.items.some((one) => one.what === 'Lead created')).toBe(true);
  });

  /*
   * The three menu lines read their choices from here rather than carrying
   * their own copy, so a choice on the page is always one the ENUM holds.
   * It is also a route-order check: `/:id` matches anything, and declared
   * above this it would swallow it for ever, silently.
   */
  it('tells the screen which choices the three menu lines may have', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const res = await get('/api/my-leads/wants/choices', await signIn(base, agent));
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as Record<string, Array<{ value: string; label: string }>>;
    expect(body.purpose?.map((one) => one.value)).toEqual(['investment', 'end_use', 'unknown']);
    expect(body.timeline?.length).toBe(6);
    expect(body.payment?.map((one) => one.value))
      .toEqual(['cash', 'mortgage', 'payment_plan', 'unknown']);
    expect(body.purpose?.[0]?.label, 'in plain English, not the column’s word').toBe('Investment');
  });

  it('refuses a purpose the column cannot hold', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { id } = await aLead(agent.id);
    const res = await send('PATCH', `/api/my-leads/${id}/wants`, await signIn(base, agent), {
      purpose: 'Q1 2027',
    });
    expect(res.status, 'a free-text purpose would make MySQL throw').toBe(400);
  });

  /* ── 7. the Info tab and the Files tab ────────────────────────────────── */

  it('sends the second WhatsApp number, Telegram and the nationality', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { id } = await aLead(agent.id, {
      telegram: '@marco.bellini',
      whatsapp: '+393478801122',
      nationality: 'Italian',
    });

    const body = await (await get(`/api/my-leads/${id}`, await signIn(base, agent))).json() as
      { contact: Record<string, unknown> };
    expect(body.contact.telegram).toBe('@marco.bellini');
    expect(body.contact.whatsapp_number).toBe('+393478801122');
    expect(body.contact.nationality).toBe('Italian');
  });

  it('lists the lead’s files in folders, and says which are private', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { id, contactId } = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const made = await send('POST', `/api/my-leads/${id}/files/note`, cookie, {
      folder: 'id', filename: 'passport.pdf',
    });
    expect(made.status, await made.clone().text()).toBe(201);
    const { noteId } = await made.json() as { noteId: string };

    const up = await fetch(`${base}/api/notes/item/${noteId}/files`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'image/png',
        'x-filename': 'passport.png',
        'x-folder': 'id',
      },
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
    });
    expect(up.status, await up.clone().text()).toBe(201);
    const file = await up.json() as { id: string; folder: string };
    expect(file.folder, 'the folder the agent chose, not Other').toBe('id');

    const listed = await (await get(`/api/my-leads/${id}/files`, cookie)).json() as {
      items: Array<{ id: string; folder: string; private: boolean; view_count: number }>;
      folders: Array<{ key: string; label: string; count: number }>;
    };
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.folder).toBe('id');
    expect(listed.items[0]?.private, 'only the agent and the owners see a passport').toBe(true);
    expect(listed.folders.find((one) => one.key === 'id')?.count).toBe(1);
    expect(listed.folders.find((one) => one.key === 'id')?.label).toBe('Passport & ID');

    /* "Every view is logged." */
    const opened = await get(`/api/notes/files/${file.id}`, cookie);
    expect(opened.status).toBe(200);
    await opened.arrayBuffer();
    const again = await (await get(`/api/my-leads/${id}/files`, cookie)).json() as
      { items: Array<{ view_count: number }> };
    expect(again.items[0]?.view_count).toBe(1);

    const logged = await query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'note.file_opened' AND entity_id = ?",
      [contactId],
    );
    expect(Number(logged[0]?.n), 'and written to the audit log, not only counted').toBe(1);
  });

  /* ── 8. the money on a Won deal ───────────────────────────────────────── */

  it('records the price, what was paid and what was signed', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { id } = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const res = await send('POST', `/api/my-leads/${id}/action`, cookie, {
      action: 'won',
      wonUnit: 'The Archive · 2BR · unit 1204',
      wonPriceAed: 2_000_000,
      wonPaidAed: 200_000,
      wonSigned: 'booking_form',
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const saved = await queryOne<Record<string, unknown>>(
      'SELECT status, deal_value_aed, won_paid_aed, won_signed, won_unit FROM opportunities WHERE id = ?',
      [id],
    );
    expect(saved?.status).toBe('won');
    expect(Number(saved?.deal_value_aed)).toBe(2_000_000);
    expect(Number(saved?.won_paid_aed)).toBe(200_000);
    expect(saved?.won_signed).toBe('booking_form');
    expect(saved?.won_unit).toBe('The Archive · 2BR · unit 1204');
  });

  it('refuses a deposit larger than the price', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { id } = await aLead(agent.id);
    const res = await send('POST', `/api/my-leads/${id}/action`, await signIn(base, agent), {
      action: 'won', wonPriceAed: 2_000_000, wonPaidAed: 3_000_000,
    });
    expect(res.status).toBe(400);

    const saved = await queryOne<{ status: string }>('SELECT status FROM opportunities WHERE id = ?', [id]);
    expect(saved?.status, 'and leaves the lead open rather than half-won').toBe('open');
  });

  /* ── 9. the reasons a lead is lost ────────────────────────────────────── */

  /*
   * Every one of the design's six, stored and read back. Five of the six used
   * to throw: `opportunities.lost_reason` is an ENUM of five other words and
   * MySQL runs with STRICT_TRANS_TABLES, so the UPDATE raised 1265 and the
   * whole Lost rolled back. Migration 0038 adds `lost_reason_v2` for the
   * agent's own answer and the old column keeps its nearest value.
   */
  it('records every one of the six reasons a lead is lost', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const reasons = [
      'bought_elsewhere', 'budget_too_low', 'just_browsing',
      'not_into_offplan', 'is_broker', 'other',
    ];

    for (const reason of reasons) {
      /* eslint-disable no-await-in-loop -- one lead per reason, in order. */
      const { id } = await aLead(agent.id);
      const res = await send('POST', `/api/my-leads/${id}/action`, cookie, {
        action: 'lost', reason, note: 'He told me on the phone.',
      });
      expect(res.status, `${reason}: ${await res.clone().text()}`).toBe(200);

      const saved = await queryOne<{ status: string; lost_reason_v2: string; lost_reason: string }>(
        'SELECT status, lost_reason_v2, lost_reason FROM opportunities WHERE id = ?',
        [id],
      );
      expect(saved?.status, reason).toBe('lost');
      expect(saved?.lost_reason_v2, 'the agent’s own answer, kept as they chose it').toBe(reason);
      expect(saved?.lost_reason, 'and the old column still filled, for the report').not.toBeNull();
      /* eslint-enable no-await-in-loop */
    }
  });

  /* ── 5. who could take the lead ───────────────────────────────────────── */

  it('offers agents by the languages they speak, not by the CRM’s own', async () => {
    const me = await createTestUser({ role: 'agent', name: 'Rocky' });
    const olga = await createTestUser({ role: 'agent', name: 'Olga', languages: ['English', 'Russian'] });
    const tej = await createTestUser({ role: 'agent', name: 'Tej' });
    /* The profile page writes `agent_profiles.languages`; the Users screen
       writes `users.languages`. Both have to count. */
    await execute(
      `INSERT INTO agent_profiles (user_id, slug, languages) VALUES (?, ?, ?)`,
      [tej.id, `tej-${tej.id.slice(0, 6)}`, JSON.stringify(['English', 'Hindi', 'Punjabi'])],
    );
    /* A won deal this month, and a lead answered a minute after it arrived. */
    const { id } = await aLead(olga.id);
    await execute(
      `UPDATE opportunities
          SET status = 'won', closed_at = NOW(3), assigned_at = DATE_SUB(NOW(3), INTERVAL 10 DAY),
              first_touch_at = DATE_SUB(DATE_SUB(NOW(3), INTERVAL 10 DAY), INTERVAL -60 SECOND)
        WHERE id = ?`,
      [id],
    );

    const body = await (await get('/api/v2/transfers/who', await signIn(base, me))).json() as {
      items: Array<{
        name: string; languages: string[]; dealsThisMonth: number; replySeconds: number | null;
        markedToday: string | null; openLeads: number;
      }>;
    };

    const byName = new Map(body.items.map((one) => [one.name, one]));
    expect(byName.has('Rocky'), 'never myself').toBe(false);
    expect(byName.get('Olga')?.languages).toEqual(['English', 'Russian']);
    expect(byName.get('Tej')?.languages).toEqual(['English', 'Hindi', 'Punjabi']);
    expect(byName.get('Olga')?.dealsThisMonth).toBe(1);
    expect(byName.get('Olga')?.replySeconds).toBe(60);
    /* Nothing invented where there is nothing to say. */
    expect(byName.get('Tej')?.languages).not.toContain('en');
    expect(byName.get('Tej')?.replySeconds).toBeNull();
  });
});
