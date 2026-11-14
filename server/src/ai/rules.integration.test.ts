import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { setEnvForTesting } from '../config/env.js';
import { visibleUserIds } from '../auth/scope.js';
import { leadTabCounts } from '../leads/counts.js';
import {
  goldenHourNow, heatFor, loadAgentFacts, loadLeadFacts, risksNow, whatNow,
  type Viewer,
} from './rules.js';
import { TUNING } from './rules.js';

/**
 * Homes AI against a real database.
 *
 * Two things are proved here and they are the two that cannot be proved with
 * a pure test:
 *
 *  1. **The fence.** An agent asking Homes AI anything gets their own leads
 *     and nobody else's, a manager gets their team, the owner gets the book.
 *     The fence is `ownerPredicate` in the SQL, so the only way to know it
 *     holds is to ask the database.
 *  2. **One source for every number.** The buckets this file counts in
 *     JavaScript are `leads/tabs.ts`'s definitions, and the only way to know
 *     they have not drifted is to count both and compare. If this fails, a
 *     threshold in `TUNING` has moved away from the tab it belongs to, and
 *     the answer is to put it back — not to change the number here.
 *
 * It also makes the statements actually run, which is not a formality: the
 * VIP, link-open and meeting figures are correlated subqueries, and a live
 * MariaDB has refused things MySQL accepted twice already.
 */
let stageRow: { id: string; pipeline_id: string; key: string };

describeWithDb('Homes AI rules', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
  });
  afterAll(async () => {
    setEnvForTesting(null);
    await closeTestDatabase();
  });
  beforeEach(async () => {
    await resetTables();
    stageRow = (await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    ))!;
  });

  const DAY = 86_400_000;
  const HOUR = 3_600_000;

  /**
   * Today at 10:00 Dubai, as an instant.
   *
   * The rules hold back a client it is the middle of the night for, which is
   * exactly what they should do and exactly what makes a test that uses the
   * real clock pass all day and fail at nine in the evening. So every test
   * that cares which list a lead lands in fixes the hour and passes it in,
   * and builds its fixtures from the same instant.
   */
  function dubaiMorning(): Date {
    const shifted = new Date(Date.now() + 4 * HOUR);
    shifted.setUTCHours(0, 0, 0, 0);
    return new Date(shifted.getTime() + 10 * HOUR - 4 * HOUR);
  }

  interface LeadOver {
    name?: string;
    phone?: string;
    stage?: string;
    status?: 'open' | 'won' | 'lost';
    score?: number;
    band?: 'hot' | 'warm' | 'cold';
    scoreReason?: string;
    vip?: boolean;
    createdAt?: Date;
    assignedAt?: Date;
    lastContactAt?: Date | null;
    lastInboundAt?: Date | null;
    nextStepAt?: Date | null;
    noAnswerCount?: number;
    dnc?: boolean;
    importId?: string | null;
    deleted?: boolean;
  }

  /** One lead, owned by somebody, with whatever facts the test is about. */
  async function aLead(owner: string | null, over: LeadOver = {}): Promise<string> {
    const contactId = newId();
    await execute(
      `INSERT INTO contacts (id, full_name, phone_e164, dnc, last_inbound_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        contactId,
        over.name ?? 'Someone',
        over.phone ?? `+9715${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`,
        over.dnc ? 1 : 0,
        over.lastInboundAt ?? null,
      ],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title, source,
          lead_score, score_band, score_reason, is_vip, created_at, assigned_at,
          last_contact_at, next_step_at, next_step_type, no_answer_count, import_id, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Interest', 'manual', ?, ?, ?, ?, ?, ?, ?, ?, 'call', ?, ?, ?)`,
      [
        id, contactId, stageRow.pipeline_id, stageRow.id, over.stage ?? stageRow.key, owner,
        over.status ?? 'open',
        over.score ?? 40,
        over.band ?? 'warm',
        over.scoreReason ?? 'Budget AED 2.5M · ready now',
        over.vip ? 1 : 0,
        over.createdAt ?? new Date(Date.now() - 30 * DAY),
        over.assignedAt ?? new Date(Date.now() - 30 * DAY),
        over.lastContactAt === undefined ? new Date(Date.now() - DAY) : over.lastContactAt,
        over.nextStepAt === undefined ? new Date(Date.now() + 2 * DAY) : over.nextStepAt,
        over.noAnswerCount ?? 0,
        over.importId ?? null,
        over.deleted ? new Date() : null,
      ],
    );
    return id;
  }

  const asViewer = (user: { id: string; role: string }): Viewer =>
    ({ id: user.id, role: user.role as Viewer['role'] });

  /* ── the fence ───────────────────────────────────────────────────────── */

  it('gives an agent their own leads and nobody else s', async () => {
    const now = dubaiMorning();
    const mine = await createTestUser({ role: 'agent', name: 'Mine' });
    const theirs = await createTestUser({ role: 'agent', name: 'Theirs' });

    const a = await aLead(mine.id, { nextStepAt: new Date(now.getTime() - DAY) });
    await aLead(theirs.id, { nextStepAt: new Date(now.getTime() - 2 * DAY) });
    await aLead(null, { nextStepAt: new Date(now.getTime() - 3 * DAY) });

    const list = await whatNow(asViewer(mine), { now });
    expect(list.now.map((r) => r.leadId)).toEqual([a]);
    expect(list.counts.overdue).toBe(1);
  });

  it('refuses to hand over another agent s lead however it is asked for', async () => {
    const mine = await createTestUser({ role: 'agent' });
    const theirs = await createTestUser({ role: 'agent' });
    const hidden = await aLead(theirs.id);

    expect(await heatFor(asViewer(mine), hidden)).toBeNull();
    expect(await loadLeadFacts(asViewer(mine), { leadIds: [hidden] })).toEqual([]);
  });

  it('gives a manager their team and the owner everything', async () => {
    const manager = await createTestUser({ role: 'manager', name: 'Manager' });
    const theirs = await createTestUser({ role: 'agent', managerId: manager.id });
    const other = await createTestUser({ role: 'agent' });
    const owner = await createTestUser({ role: 'owner' });

    const now = dubaiMorning();
    await aLead(manager.id, { nextStepAt: new Date(now.getTime() - DAY) });
    await aLead(theirs.id, { nextStepAt: new Date(now.getTime() - DAY) });
    await aLead(other.id, { nextStepAt: new Date(now.getTime() - DAY) });

    expect((await whatNow(asViewer(manager), { now })).now).toHaveLength(2);
    expect((await whatNow(asViewer(owner), { now })).now).toHaveLength(3);
  });

  it('counts only your own clients in golden hour', async () => {
    const mine = await createTestUser({ role: 'agent' });
    const theirs = await createTestUser({ role: 'agent' });
    await aLead(mine.id, { phone: '+971501110001' });
    await aLead(theirs.id, { phone: '+971501110002' });
    await aLead(theirs.id, { phone: '+971501110003' });

    const hour = await goldenHourNow(asViewer(mine));
    const total = hour.countries.reduce((n, c) => n + c.leads, 0) + hour.unknown
      + hour.asleep.reduce((n, c) => n + c.leads, 0);
    expect(total).toBe(1);
  });

  it('tells an agent about their own risks and nobody else s', async () => {
    const mine = await createTestUser({ role: 'agent', name: 'Mine' });
    const theirs = await createTestUser({ role: 'agent', name: 'Theirs' });

    await aLead(mine.id, { name: 'My lead', nextStepAt: null });
    await aLead(theirs.id, { name: 'Their lead', nextStepAt: null });

    const risks = await risksNow(asViewer(mine));
    expect(risks.leads.map((r) => r.text)).toEqual(['My lead has nothing planned']);
    expect(risks.agents.every((r) => r.userId === mine.id)).toBe(true);

    const everything = await risksNow(asViewer(await createTestUser({ role: 'owner' })));
    expect(everything.leads).toHaveLength(2);
  });

  /* ── one source for every number ─────────────────────────────────────── */

  it('counts each bucket exactly as the lead tabs count it', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    const now = Date.now();

    /* One of each shape the tabs have a name for, plus the awkward ones. */
    await aLead(agent.id, { nextStepAt: new Date(now - 2 * DAY) });              // overdue
    await aLead(agent.id, { nextStepAt: new Date(now - HOUR) });                 // overdue
    await aLead(agent.id, { nextStepAt: new Date(now + 30 * 60_000) });          // due today
    await aLead(agent.id, { band: 'hot', score: 88 });                           // hot
    await aLead(agent.id, { lastContactAt: null, nextStepAt: null });            // untouched, cold
    await aLead(agent.id, {
      nextStepAt: null, lastContactAt: new Date(now - 20 * DAY),
    });                                                                          // going cold
    await aLead(agent.id, { nextStepAt: null });                                 // no next step
    await aLead(agent.id, { status: 'won', nextStepAt: new Date(now - DAY) });    // not work
    await aLead(agent.id, { deleted: true, nextStepAt: new Date(now - DAY) });    // gone
    await aLead(agent.id, { dnc: true, nextStepAt: new Date(now - DAY) });        // overdue, DNC

    const viewer = asViewer(owner);
    const list = await whatNow(viewer);
    const tabs = await leadTabCounts(await visibleUserIds(viewer));

    expect(list.counts.overdue).toBe(tabs.overdue);
    /* The "today" tab is everything promised up to midnight, missed ones too. */
    expect(list.counts.overdue + list.counts.due_today).toBe(tabs.today);
    expect(list.counts.hot).toBe(tabs.hot);
    expect(list.counts.going_cold).toBe(tabs.cold);
    expect(list.counts.new_not_called).toBe(
      Number((await queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM opportunities
          WHERE status = 'open' AND deleted_at IS NULL AND last_contact_at IS NULL`,
      ))?.n ?? -1),
    );

    /* And the lists leave nothing out silently. */
    const listed = list.now.length + list.asleep.length;
    expect(listed + list.skipped.dnc + list.skipped.nothingOwed).toBe(
      (await loadLeadFacts(viewer)).length,
    );
    expect(list.skipped.dnc).toBe(1);
  });

  it('says when it has read only part of the book', async () => {
    const now = dubaiMorning();
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id, { nextStepAt: new Date(now.getTime() - DAY) });
    await aLead(agent.id, { nextStepAt: new Date(now.getTime() - 2 * DAY) });

    expect((await whatNow(asViewer(owner), { now, limit: 1 })).truncated).toBe(true);
    expect((await whatNow(asViewer(owner), { now })).truncated).toBe(false);
    expect((await risksNow(asViewer(owner), { now, limit: 1 })).truncated).toBe(true);
  });

  /* ── the figures that need a join ────────────────────────────────────── */

  it('reads the VIP clock, the link opens and the meeting off the database', async () => {
    const now = dubaiMorning();
    const agent = await createTestUser({ role: 'agent' });
    const owner = await createTestUser({ role: 'owner' });
    const leadId = await aLead(agent.id, {
      name: 'Warm One', vip: true, score: 30, nextStepAt: null,
      lastContactAt: new Date(now.getTime() - HOUR),
    });
    const contactId = String((await queryOne<{ contact_id: string }>(
      'SELECT contact_id FROM opportunities WHERE id = ?', [leadId],
    ))!.contact_id);

    /* The owner's clock on it, not yet answered. */
    await execute(
      `INSERT INTO vip_handoffs (id, opportunity_id, given_by, given_to, call_within_minutes,
                                 deadline_at)
       VALUES (?, ?, ?, ?, 30, ?)`,
      [newId(), leadId, owner.id, agent.id, new Date(now.getTime() + 5 * 60_000)],
    );
    /* A brochure they opened last night. */
    const linkId = newId();
    await execute(
      `INSERT INTO tracking_links (id, code, opportunity_id, contact_id, user_id, kind, target_url)
       VALUES (?, ?, ?, ?, ?, 'brochure', 'https://example.test/b')`,
      [linkId, `c${newId().slice(0, 8)}`, leadId, contactId, agent.id],
    );
    await execute(
      'INSERT INTO link_opens (id, link_id, opened_at) VALUES (?, ?, ?)',
      [newId(), linkId, new Date(now.getTime() - 12 * HOUR)],
    );
    /* And a meeting on Thursday. */
    await execute(
      `INSERT INTO meetings (id, opportunity_id, contact_id, user_id, starts_at, ends_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), leadId, contactId, agent.id,
        new Date(now.getTime() + 3 * DAY), new Date(now.getTime() + 3 * DAY + HOUR)],
    );

    const [facts] = await loadLeadFacts(asViewer(agent), { leadIds: [leadId] });
    expect(facts?.vipDeadlineAt).toBeInstanceOf(Date);
    expect(facts?.vipFirstCallAt).toBeNull();
    expect(facts?.lastLinkOpenAt).toBeInstanceOf(Date);
    expect(facts?.nextMeetingAt).toBeInstanceOf(Date);

    const heat = await heatFor(asViewer(agent), leadId, { now });
    const keys = heat?.reasons.map((r) => r.key) ?? [];
    expect(keys).toContain('vip');
    expect(keys).toContain('link_open');
    expect(keys).toContain('meeting_booked');
    expect(heat?.score).toBe(
      30 + TUNING.heat.vipPoints + TUNING.heat.linkOpenPoints + TUNING.heat.meetingBookedPoints,
    );

    /* And the VIP clock puts it at the top of the list. */
    const list = await whatNow(asViewer(agent), { now });
    expect(list.now[0]?.leadId).toBe(leadId);
    expect(list.now[0]?.bucket).toBe('vip_countdown');

    /* The take-back warning reads the same clock. */
    const risks = await risksNow(asViewer(agent), { now });
    expect(risks.leads.map((r) => r.key)).toContain('back_to_incoming');
  });

  it('ignores a meeting that has already happened and a VIP hand-over sent back', async () => {
    const now = dubaiMorning();
    const agent = await createTestUser({ role: 'agent' });
    const owner = await createTestUser({ role: 'owner' });
    const leadId = await aLead(agent.id, { vip: true, score: 0, scoreReason: '' });
    const contactId = String((await queryOne<{ contact_id: string }>(
      'SELECT contact_id FROM opportunities WHERE id = ?', [leadId],
    ))!.contact_id);

    await execute(
      `INSERT INTO vip_handoffs (id, opportunity_id, given_by, given_to, deadline_at, refused_at,
                                 returned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId(), leadId, owner.id, agent.id, new Date(now.getTime() + 60_000),
        new Date(), new Date()],
    );
    await execute(
      `INSERT INTO meetings (id, opportunity_id, contact_id, user_id, starts_at, ends_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), leadId, contactId, agent.id,
        new Date(now.getTime() - 3 * DAY), new Date(now.getTime() - 3 * DAY + HOUR)],
    );

    const [facts] = await loadLeadFacts(asViewer(agent), { leadIds: [leadId] });
    expect(facts?.vipDeadlineAt).toBeNull();
    expect(facts?.nextMeetingAt).toBeNull();
  });

  /* ── agents ──────────────────────────────────────────────────────────── */

  it('reads an agent s open leads, desk maximum, attendance and last click', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent', name: 'Rania' });
    await aLead(agent.id, { nextStepAt: new Date(Date.now() - DAY) });
    await aLead(agent.id);

    const deskId = newId();
    await execute(
      'INSERT INTO desks (id, name, max_open_leads) VALUES (?, ?, ?)',
      [deskId, 'Arabic desk', 1],
    );
    await execute('INSERT INTO desk_members (desk_id, user_id) VALUES (?, ?)', [deskId, agent.id]);
    await execute(
      'INSERT INTO attendance (id, user_id, on_date, kind) VALUES (?, ?, CURDATE(), ?)',
      [newId(), agent.id, 'office'],
    );

    const contactId = String((await queryOne<{ id: string }>(
      'SELECT id FROM contacts ORDER BY created_at DESC LIMIT 1',
    ))!.id);
    await execute(
      'INSERT INTO call_logs (id, contact_id, user_id, started_at) VALUES (?, ?, ?, NOW(3))',
      [newId(), contactId, agent.id],
    );

    const [facts] = await loadAgentFacts(asViewer(owner));
    expect(facts?.name).toBe('Rania');
    expect(facts?.openLeads).toBe(2);
    expect(facts?.overdue).toBe(1);
    expect(facts?.deskName).toBe('Arabic desk');
    expect(facts?.deskMax).toBe(1);
    expect(facts?.markedIn).toBe(true);
    expect(facts?.onLeave).toBe(false);
    expect(facts?.lastClickAt).toBeInstanceOf(Date);

    /* Over a desk maximum of one, so the owner is told. */
    const risks = await risksNow(asViewer(owner));
    expect(risks.agents.map((r) => r.text)).toContain('Rania has 2 leads · maximum is 1');
  });

  it('leaves the owner out of the floor s own figures', async () => {
    const owner = await createTestUser({ role: 'owner', name: 'Emir' });
    await createTestUser({ role: 'agent', name: 'Agent' });
    await createTestUser({ role: 'manager', name: 'Manager' });

    expect((await loadAgentFacts(asViewer(owner))).map((a) => a.name))
      .toEqual(['Agent', 'Manager']);
  });

  it('knows an agent is on leave today', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    await execute(
      `INSERT INTO leave_requests (id, user_id, kind, from_date, to_date, status)
       VALUES (?, ?, 'annual', CURDATE(), CURDATE(), 'approved')`,
      [newId(), agent.id],
    );

    const [facts] = await loadAgentFacts(asViewer(owner));
    expect(facts?.onLeave).toBe(true);
  });
});
