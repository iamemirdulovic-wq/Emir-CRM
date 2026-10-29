import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, execute, prepareTestDatabase, query, resetTables,
} from '../testing/db.js';
import { newId } from '../lib/ids.js';
import { SYSTEM_ACTOR } from '../audit/audit.js';
import { buildMembers, campaignStats, logOutcome, nextForAgent, releaseMember } from './run.js';

const actor = (userId: string) => ({ ...SYSTEM_ACTOR, userId, role: 'agent' as const });

async function createContact(
  name: string,
  options: { consent?: boolean; dnc?: boolean; waId?: boolean } = {},
): Promise<{ contactId: string; opportunityId: string }> {
  const contactId = newId();
  const opportunityId = newId();
  const phone = `+9715${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`;

  await execute(
    `INSERT INTO contacts (id, full_name, phone_e164, wa_id, language, first_source, dnc)
     VALUES (?, ?, ?, ?, 'en', 'csv_import', ?)`,
    [contactId, name, phone, options.waId === false ? null : phone.replace('+', ''), options.dnc ? 1 : 0],
  );
  if (options.consent) {
    await execute(
      `INSERT INTO consents (id, contact_id, channel, granted, source, consent_text)
       VALUES (?, ?, 'whatsapp', 1, 'import', 'Agreed to be contacted')`,
      [newId(), contactId],
    );
  }

  const stage = await query<{ id: string; pipeline_id: string }>(
    "SELECT s.id, s.pipeline_id FROM pipeline_stages s WHERE s.`key` = 'new_lead' LIMIT 1",
  );
  await execute(
    `INSERT INTO opportunities (id, contact_id, pipeline_id, stage_id, stage_key, status, title, source, created_at, stage_changed_at)
     VALUES (?, ?, ?, ?, 'new_lead', 'open', ?, 'csv_import', NOW(3), NOW(3))`,
    [opportunityId, contactId, stage[0]?.pipeline_id, stage[0]?.id, name],
  );
  return { contactId, opportunityId };
}

async function createListWith(contactIds: string[]): Promise<string> {
  const listId = newId();
  await execute("INSERT INTO lists (id, name, kind) VALUES (?, ?, 'static')", [listId, `List ${listId.slice(0, 6)}`]);
  for (const contactId of contactIds) {
    const opportunity = await query<{ id: string }>(
      'SELECT id FROM opportunities WHERE contact_id = ? LIMIT 1',
      [contactId],
    );
    await execute('INSERT INTO list_members (list_id, contact_id, opportunity_id) VALUES (?, ?, ?)', [
      listId, contactId, opportunity[0]?.id ?? null,
    ]);
  }
  return listId;
}

async function createCampaign(listId: string, kind: 'call' | 'whatsapp'): Promise<string> {
  const id = newId();
  await execute(
    `INSERT INTO campaigns (id, name, kind, list_id, template_name, template_language)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, `Campaign ${id.slice(0, 6)}`, kind, listId, kind === 'whatsapp' ? 'lead_welcome' : null, kind === 'whatsapp' ? 'en' : null],
  );
  return id;
}

describeWithDb('campaigns (integration)', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetTables();
  });

  /**
   * The rule the owner signed off on: a bulk WhatsApp send never reaches
   * someone who has not opted in. Getting this wrong gets the number banned.
   */
  it('excludes contacts with no WhatsApp consent from a WhatsApp campaign', async () => {
    const consenting = await createContact('Consented', { consent: true });
    const silent = await createContact('Never Opted In');
    const blocked = await createContact('Do Not Contact', { consent: true, dnc: true });

    const listId = await createListWith([consenting.contactId, silent.contactId, blocked.contactId]);
    const campaignId = await createCampaign(listId, 'whatsapp');

    const result = await buildMembers(SYSTEM_ACTOR, campaignId);

    expect(result.eligible).toBe(1);
    expect(result.skipped).toBe(2);
    // The count the owner confirms is the count the campaign acts on.
    expect(result.warning).toContain('2 will be skipped');

    const pending = await query<{ contact_id: string }>(
      "SELECT contact_id FROM campaign_members WHERE campaign_id = ? AND status = 'pending'",
      [campaignId],
    );
    expect(pending.map((row) => row.contact_id)).toEqual([consenting.contactId]);
  });

  it('skips a consenting contact with no WhatsApp number', async () => {
    const noWhatsApp = await createContact('Landline Only', { consent: true, waId: false });
    const listId = await createListWith([noWhatsApp.contactId]);
    const campaignId = await createCampaign(listId, 'whatsapp');

    expect((await buildMembers(SYSTEM_ACTOR, campaignId)).eligible).toBe(0);
  });

  it('only requires the do-not-contact check for a call campaign', async () => {
    // WhatsApp consent is not consent to be phoned, and vice versa.
    const noConsent = await createContact('No WhatsApp Consent');
    const blocked = await createContact('Do Not Contact', { dnc: true });

    const listId = await createListWith([noConsent.contactId, blocked.contactId]);
    const campaignId = await createCampaign(listId, 'call');

    const result = await buildMembers(SYSTEM_ACTOR, campaignId);
    expect(result.eligible).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('records the skipped count on the campaign itself', async () => {
    const consenting = await createContact('Yes', { consent: true });
    const silent = await createContact('No');
    const listId = await createListWith([consenting.contactId, silent.contactId]);
    const campaignId = await createCampaign(listId, 'whatsapp');

    await buildMembers(SYSTEM_ACTOR, campaignId);
    const campaign = await query<{ total_members: number; skipped_no_consent: number }>(
      'SELECT total_members, skipped_no_consent FROM campaigns WHERE id = ?',
      [campaignId],
    );
    expect(Number(campaign[0]?.total_members)).toBe(1);
    expect(Number(campaign[0]?.skipped_no_consent)).toBe(1);
  });

  /**
   * A smart list stores no members — it is a filter evaluated on read. Reading
   * list_members directly would build a campaign of nobody, and the first
   * anybody would know is an agent opening the dialler to an empty queue.
   */
  it('builds a campaign from a smart list, which has no stored members', async () => {
    await createContact('Matches The Filter', { consent: true });
    await createContact('Also Matches', { consent: true });

    const listId = newId();
    await execute(
      `INSERT INTO lists (id, name, kind, filters) VALUES (?, 'Smart', 'smart', ?)`,
      [listId, JSON.stringify({ stages: ['new_lead'], excludeDnc: true })],
    );
    const campaignId = await createCampaign(listId, 'call');

    const result = await buildMembers(SYSTEM_ACTOR, campaignId);
    expect(result.eligible).toBe(2);

    const members = await query('SELECT id FROM campaign_members WHERE campaign_id = ?', [campaignId]);
    expect(members).toHaveLength(2);
  });

  it('applies the consent rules to a smart list too', async () => {
    await createContact('Consented', { consent: true });
    await createContact('Never Opted In');

    const listId = newId();
    await execute(
      `INSERT INTO lists (id, name, kind, filters) VALUES (?, 'Smart WA', 'smart', ?)`,
      [listId, JSON.stringify({ stages: ['new_lead'] })],
    );
    const campaignId = await createCampaign(listId, 'whatsapp');

    const result = await buildMembers(SYSTEM_ACTOR, campaignId);
    expect(result.eligible).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

describeWithDb('the power dialler', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetTables();
  });

  it('hands the agent a lead with everything they need to make the call', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await createContact('Sara Ahmed');
    const listId = await createListWith([lead.contactId]);
    const campaignId = await createCampaign(listId, 'call');
    await buildMembers(SYSTEM_ACTOR, campaignId);

    const card = await nextForAgent(campaignId, agent.id);
    expect(card?.fullName).toBe('Sara Ahmed');
    expect(card?.phone).toMatch(/^\+971/);
    expect(card?.progress.total).toBe(1);
  });

  /**
   * Two agents working one campaign must never be handed the same person. It
   * is the whole point of a dialler, and the fastest way to annoy a lead.
   */
  it('never gives the same lead to two agents', async () => {
    const agents = await Promise.all(
      Array.from({ length: 4 }, (_unused, i) => createTestUser({ role: 'agent', name: `Agent ${i}` })),
    );
    const leads = [];
    for (let i = 0; i < 4; i++) leads.push(await createContact(`Lead ${i}`));

    const listId = await createListWith(leads.map((lead) => lead.contactId));
    const campaignId = await createCampaign(listId, 'call');
    await buildMembers(SYSTEM_ACTOR, campaignId);
    // Unassign so every agent competes for the same queue.
    await execute('UPDATE campaign_members SET assigned_user_id = NULL WHERE campaign_id = ?', [campaignId]);

    const cards = await Promise.all(agents.map((agent) => nextForAgent(campaignId, agent.id)));
    const memberIds = cards.map((card) => card?.memberId).filter(Boolean);

    expect(memberIds).toHaveLength(4);
    expect(new Set(memberIds).size).toBe(4);
  });

  it('never hands an agent a colleague\u2019s lead', async () => {
    const mine = await createTestUser({ role: 'agent', name: 'Mine' });
    const theirs = await createTestUser({ role: 'agent', name: 'Theirs' });
    const lead = await createContact('Belongs To Someone Else');
    await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ?', [theirs.id, lead.contactId]);

    const listId = await createListWith([lead.contactId]);
    const campaignId = await createCampaign(listId, 'call');
    await buildMembers(SYSTEM_ACTOR, campaignId);

    expect(await nextForAgent(campaignId, mine.id)).toBeNull();
    expect((await nextForAgent(campaignId, theirs.id))?.contactId).toBe(lead.contactId);
  });

  it('lets a manager work any row, because they run the campaign', async () => {
    // Otherwise a desk of leads belonging to an agent who is off today stalls
    // the whole campaign.
    const agent = await createTestUser({ role: 'agent', name: 'Away Today' });
    const manager = await createTestUser({ role: 'manager', name: 'Manager' });
    const lead = await createContact('Assigned To The Absent Agent');
    await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ?', [agent.id, lead.contactId]);

    const listId = await createListWith([lead.contactId]);
    const campaignId = await createCampaign(listId, 'call');
    await buildMembers(SYSTEM_ACTOR, campaignId);

    expect(await nextForAgent(campaignId, manager.id)).toBeNull();
    expect((await nextForAgent(campaignId, manager.id, { includeOthers: true }))?.contactId).toBe(lead.contactId);
  });

  it('runs out rather than repeating itself', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await createContact('Only One');
    const listId = await createListWith([lead.contactId]);
    const campaignId = await createCampaign(listId, 'call');
    await buildMembers(SYSTEM_ACTOR, campaignId);

    const first = await nextForAgent(campaignId, agent.id);
    expect(first).not.toBeNull();
    expect(await nextForAgent(campaignId, agent.id)).toBeNull();
  });

  it('moves an interested lead into the main pipeline', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await createContact('Keen Buyer');
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, lead.opportunityId]);

    const listId = await createListWith([lead.contactId]);
    const campaignId = await createCampaign(listId, 'call');
    await buildMembers(SYSTEM_ACTOR, campaignId);

    const card = await nextForAgent(campaignId, agent.id);
    await logOutcome(actor(agent.id), card!.memberId, 'interested', 'Wants a viewing on Saturday');

    const opportunity = await query<{ stage_key: string }>('SELECT stage_key FROM opportunities WHERE id = ?', [
      lead.opportunityId,
    ]);
    expect(opportunity[0]?.stage_key).toBe('engaged_qualified');
  });

  it('records every outcome as an activity on the contact', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await createContact('Not Keen');
    const listId = await createListWith([lead.contactId]);
    const campaignId = await createCampaign(listId, 'call');
    await buildMembers(SYSTEM_ACTOR, campaignId);

    const card = await nextForAgent(campaignId, agent.id);
    await logOutcome(actor(agent.id), card!.memberId, 'no_answer', null);

    const activities = await query<{ title: string }>(
      "SELECT title FROM activities WHERE contact_id = ? AND type = 'call.logged'",
      [lead.contactId],
    );
    expect(activities[0]?.title).toContain('no answer');
  });

  it('keeps the outcome even when the stage cannot move', async () => {
    // A lead already at Won cannot go back to Engaged, and that is no reason
    // to lose the call we just logged.
    const agent = await createTestUser({ role: 'agent' });
    const lead = await createContact('Already Won');
    await execute("UPDATE opportunities SET stage_key = 'won', status = 'won' WHERE id = ?", [lead.opportunityId]);

    const listId = await createListWith([lead.contactId]);
    const campaignId = await createCampaign(listId, 'call');
    await buildMembers(SYSTEM_ACTOR, campaignId);

    const card = await nextForAgent(campaignId, agent.id);
    await expect(logOutcome(actor(agent.id), card!.memberId, 'interested', null)).resolves.toBeUndefined();

    const member = await query<{ outcome: string; status: string }>(
      'SELECT outcome, status FROM campaign_members WHERE id = ?',
      [card!.memberId],
    );
    expect(member[0]?.outcome).toBe('interested');
    expect(member[0]?.status).toBe('done');
  });

  it('reports progress the way the dialler shows it', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const leads = [];
    for (let i = 0; i < 3; i++) leads.push(await createContact(`Lead ${i}`));

    const listId = await createListWith(leads.map((lead) => lead.contactId));
    const campaignId = await createCampaign(listId, 'call');
    await buildMembers(SYSTEM_ACTOR, campaignId);

    const first = await nextForAgent(campaignId, agent.id);
    await logOutcome(actor(agent.id), first!.memberId, 'answered', null);
    const second = await nextForAgent(campaignId, agent.id);
    await logOutcome(actor(agent.id), second!.memberId, 'interested', null);

    const stats = await campaignStats(campaignId);
    expect(stats.total).toBe(3);
    expect(stats.done).toBe(2);
    expect(stats.pending).toBe(1);
    expect(stats.interested).toBe(1);
    expect(stats.reachedPct).toBe(100);
    expect(stats.byAgent[0]?.done).toBe(2);
  });
  it('will not let an agent log an outcome on a colleague\u2019s card', async () => {
    const mine = await createTestUser({ role: 'agent', name: 'Mine' });
    const theirs = await createTestUser({ role: 'agent', name: 'Theirs' });
    const lead = await createContact('Belongs To Someone Else');
    await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ?', [theirs.id, lead.contactId]);

    const listId = await createListWith([lead.contactId]);
    const campaignId = await createCampaign(listId, 'call');
    await buildMembers(SYSTEM_ACTOR, campaignId);
    const card = await nextForAgent(campaignId, theirs.id);

    await expect(
      logOutcome(actor(mine.id), card!.memberId, 'not_interested', null, {
        userId: mine.id,
        canWorkOthers: false,
      }),
    ).rejects.toThrow(/not yours/i);
  });

  it('will not let an agent release a colleague\u2019s open card', async () => {
    // Releasing puts the card back in the queue, so one agent could otherwise
    // pull a live call out from under another.
    const mine = await createTestUser({ role: 'agent', name: 'Mine' });
    const theirs = await createTestUser({ role: 'agent', name: 'Theirs' });
    const lead = await createContact('Belongs To Someone Else');
    await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ?', [theirs.id, lead.contactId]);

    const listId = await createListWith([lead.contactId]);
    const campaignId = await createCampaign(listId, 'call');
    await buildMembers(SYSTEM_ACTOR, campaignId);
    const card = await nextForAgent(campaignId, theirs.id);

    await releaseMember(card!.memberId, { campaignId, userId: mine.id, canWorkOthers: false });
    const held = await query<{ status: string }>('SELECT status FROM campaign_members WHERE id = ?', [
      card!.memberId,
    ]);
    expect(held[0]?.status).toBe('in_progress');

    // The agent whose card it is can hand it back.
    await releaseMember(card!.memberId, { campaignId, userId: theirs.id, canWorkOthers: false });
    const released = await query<{ status: string }>('SELECT status FROM campaign_members WHERE id = ?', [
      card!.memberId,
    ]);
    expect(released[0]?.status).toBe('pending');
  });
});
