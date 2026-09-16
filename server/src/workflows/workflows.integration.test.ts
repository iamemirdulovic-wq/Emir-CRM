import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  closeTestDatabase,
  createTestUser,
  describeWithDb,
  execute,
  prepareTestDatabase,
  query,
  resetTables,
} from '../testing/db.js';
import { queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { ingestLead } from '../ingestion/ingest.js';
import { normalizeLead } from '../ingestion/normalize.js';
import { handleInboundMessage } from '../ingestion/whatsapp-inbound.js';
import { parseWhatsAppWebhook } from '../ingestion/sources/whatsapp.js';
import { runWorkflowA, runSlaCheck } from './workflow-a.js';
import { runWorkflowBStep, shouldContinue } from './workflow-b.js';
import { runWorkflowC } from './workflow-c.js';
import { setWhatsAppAdapterForTesting } from '../messaging/whatsapp/index.js';
import { LogAdapter } from '../messaging/whatsapp/log.js';

/** Approve every template so the guards let the welcome through. */
async function approveTemplates(): Promise<void> {
  await execute(
    `INSERT INTO wa_templates (id, name, language, category, status, components)
     VALUES (?, 'lead_welcome_en', 'en', 'MARKETING', 'APPROVED', '[]'),
            (?, 'lead_welcome_ar', 'ar', 'MARKETING', 'APPROVED', '[]'),
            (?, 'followup_2h_en', 'en', 'MARKETING', 'APPROVED', '[]'),
            (?, 'followup_24h_en', 'en', 'MARKETING', 'APPROVED', '[]'),
            (?, 'followup_3d_en', 'en', 'MARKETING', 'APPROVED', '[]')
     ON DUPLICATE KEY UPDATE status = 'APPROVED'`,
    [newId(), newId(), newId(), newId(), newId()],
  );
}

async function seedVerifiedProject(): Promise<string> {
  const id = newId();
  await execute(
    `INSERT INTO projects (id, slug, name, developer, emirate, area, starting_price_aed, payment_plan,
                           handover_date, golden_visa_eligible, brochure_url, location_lat, location_lng,
                           location_label, is_active, verified_at)
     VALUES (?, 'emaar-beachfront', 'Emaar Beachfront', 'Emaar', 'dubai', 'Dubai Harbour', 1850000,
             '80/20 until handover', 'Q4 2027', 1, 'https://cdn.example.ae/emaar-beachfront.pdf',
             25.0940000, 55.1440000, 'Dubai Harbour, Dubai', 1, NOW(3))`,
    [id],
  );
  return id;
}

/** A lead that consented on WhatsApp, so the guards allow automated sends. */
async function arriveLead(over: { phone?: string; project?: string | null; language?: string } = {}) {
  const lead = normalizeLead({
    source: 'meta_lead_ads',
    externalId: `wf-${newId()}`,
    mapped: {
      full_name: 'Sara Al Mansoori',
      phone: over.phone ?? '+971501234567',
      email: 'sara@example.com',
      ...(over.project === null ? {} : { project: over.project ?? 'Emaar Beachfront' }),
      ...(over.language ? { language: over.language } : {}),
    },
    consent: { whatsapp: true, email: true, sms: false, text: 'Lead form consent' },
  });
  return ingestLead(lead);
}

describeWithDb('workflows (integration)', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
  });
  beforeEach(async () => {
    await resetTables();
    await approveTemplates();
    setWhatsAppAdapterForTesting(new LogAdapter());
  });
  afterEach(() => {
    vi.useRealTimers();
    setWhatsAppAdapterForTesting(null);
  });
  afterAll(async () => {
    await closeTestDatabase();
  });

  // -------------------------------------------------------------------------
  // Workflow A
  // -------------------------------------------------------------------------

  it('assigns the lead, sends the welcome and arms the SLA timer', async () => {
    // No declared languages or projects, so this exercises plain round-robin.
    const agent = await createTestUser({ role: 'agent', name: 'Layla Hassan', languages: [] });
    const ingested = await arriveLead();

    const result = await runWorkflowA({ opportunityId: ingested.opportunityId, contactId: ingested.contactId });

    expect(result.assignedUserId).toBe(agent.id);
    expect(result.assignmentReason).toBe('round_robin');
    expect(result.welcomeSent).toBe(true);
    expect(result.welcomeChannel).toBe('whatsapp');

    const opportunity = await queryOne<{ owner_user_id: string; assigned_at: Date | null }>(
      'SELECT owner_user_id, assigned_at FROM opportunities WHERE id = ?',
      [ingested.opportunityId],
    );
    expect(opportunity?.owner_user_id).toBe(agent.id);
    expect(opportunity?.assigned_at).toBeInstanceOf(Date);

    // The sticky owner is recorded on the contact for next time.
    const contact = await queryOne<{ owner_user_id: string }>('SELECT owner_user_id FROM contacts WHERE id = ?', [
      ingested.contactId,
    ]);
    expect(contact?.owner_user_id).toBe(agent.id);

    const message = await queryOne<{ template_name: string; is_automated: number; status: string; direction: string }>(
      `SELECT template_name, is_automated, status, direction FROM messages WHERE contact_id = ? AND direction = 'outbound'`,
      [ingested.contactId],
    );
    expect(message?.template_name).toBe('lead_welcome_en');
    expect(message?.is_automated).toBe(1);
    expect(message?.status).toBe('sent');

    const jobs = await query<{ type: string }>('SELECT type FROM jobs ORDER BY type');
    const types = jobs.map((j) => j.type);
    expect(types).toContain('workflow.a.sla_check');
    expect(types).toContain('workflow.b.step');
    expect(types).toContain('lead.score');
    expect(types).toContain('capi.send_event');
  });

  it('prefers an Arabic-speaking agent who covers the project', async () => {
    await createTestUser({ role: 'agent', name: 'Generalist', languages: ['en'] });
    const specialist = await createTestUser({
      role: 'agent',
      name: 'Nour',
      languages: ['ar', 'en'],
      projects: ['Emaar Beachfront'],
    });

    const ingested = await arriveLead({ language: 'ar' });
    const result = await runWorkflowA({ opportunityId: ingested.opportunityId, contactId: ingested.contactId });

    expect(result.assignedUserId).toBe(specialist.id);
    expect(result.assignmentReason).toBe('language_and_project');

    const message = await queryOne<{ template_name: string }>(
      `SELECT template_name FROM messages WHERE contact_id = ? AND direction = 'outbound'`,
      [ingested.contactId],
    );
    expect(message?.template_name).toBe('lead_welcome_ar');
  });

  it('keeps a returning lead with their existing agent', async () => {
    await createTestUser({ role: 'agent', name: 'First Agent' });
    await createTestUser({ role: 'agent', name: 'Second Agent' });

    const first = await arriveLead();
    // Whichever agent round-robin picks is the one the lead must come back to.
    const firstRun = await runWorkflowA({ opportunityId: first.opportunityId, contactId: first.contactId });
    expect(firstRun.assignedUserId).not.toBeNull();
    await execute(`UPDATE opportunities SET status = 'won' WHERE id = ?`, [first.opportunityId]);

    const second = await arriveLead({ project: 'Damac Lagoons' });
    const result = await runWorkflowA({ opportunityId: second.opportunityId, contactId: second.contactId });

    expect(second.contactId).toBe(first.contactId);
    expect(second.opportunityId).not.toBe(first.opportunityId);
    expect(result.assignedUserId).toBe(firstRun.assignedUserId);
    expect(result.assignmentReason).toBe('sticky_owner');
  });

  it('queues the lead and alerts managers when nobody is available', async () => {
    await createTestUser({ role: 'agent', availability: 'off' });
    const ingested = await arriveLead();

    const result = await runWorkflowA({ opportunityId: ingested.opportunityId, contactId: ingested.contactId });

    expect(result.assignedUserId).toBeNull();
    expect(result.assignmentReason).toBe('no_agent_available');

    const queued = await queryOne<{ reason: string; resolved_at: Date | null }>(
      'SELECT reason, resolved_at FROM unassigned_queue WHERE opportunity_id = ?',
      [ingested.opportunityId],
    );
    expect(queued?.reason).toBe('no_agent_available');
    expect(queued?.resolved_at).toBeNull();

    const alert = await query<{ type: string }>(`SELECT type FROM jobs WHERE type = 'push.send'`);
    expect(alert.length).toBeGreaterThan(0);
  });

  it('never sends an automated welcome without WhatsApp consent', async () => {
    await createTestUser({ role: 'agent' });
    const lead = normalizeLead({
      source: 'csv_import',
      externalId: `no-consent-${newId()}`,
      mapped: { full_name: 'No Consent', phone: '+971502223333' },
      consent: { whatsapp: false, email: false, sms: false, text: null },
    });
    const ingested = await ingestLead(lead);

    const result = await runWorkflowA({ opportunityId: ingested.opportunityId, contactId: ingested.contactId });

    expect(result.welcomeSent).toBe(false);
    expect(result.welcomeChannel).toBe('none');
    const sent = await query(`SELECT id FROM messages WHERE contact_id = ? AND direction = 'outbound' AND status = 'sent'`, [
      ingested.contactId,
    ]);
    expect(sent).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // The 5-minute SLA
  // -------------------------------------------------------------------------

  it('reassigns and tags the card when the agent has not touched the lead', async () => {
    const first = await createTestUser({ role: 'agent', name: 'Slow Agent' });
    const second = await createTestUser({ role: 'agent', name: 'Backup Agent' });

    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ?, assigned_at = NOW(3) WHERE id = ?', [
      first.id,
      ingested.opportunityId,
    ]);

    const result = await runSlaCheck({
      opportunityId: ingested.opportunityId,
      contactId: ingested.contactId,
      assignedUserId: first.id,
    });

    expect(result.breached).toBe(true);
    expect(result.reassignedTo).toBe(second.id);

    const opportunity = await queryOne<{ sla_breached: number; owner_user_id: string }>(
      'SELECT sla_breached, owner_user_id FROM opportunities WHERE id = ?',
      [ingested.opportunityId],
    );
    expect(opportunity?.sla_breached).toBe(1);
    expect(opportunity?.owner_user_id).toBe(second.id);

    const tags = await query<{ value: string }>(
      `SELECT t.value FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
        WHERE ct.contact_id = ? AND t.namespace = 'ops'`,
      [ingested.contactId],
    );
    expect(tags.map((t) => t.value)).toContain('sla-breach');
  });

  it('does not breach the SLA when the agent has already acted', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);
    await execute(
      `INSERT INTO activities (id, contact_id, opportunity_id, user_id, type, title)
       VALUES (?, ?, ?, ?, 'message.outbound', 'Agent replied')`,
      [newId(), ingested.contactId, ingested.opportunityId, agent.id],
    );

    const result = await runSlaCheck({
      opportunityId: ingested.opportunityId,
      contactId: ingested.contactId,
      assignedUserId: agent.id,
    });
    expect(result.breached).toBe(false);
  });

  it('does not breach the SLA when the lead has already replied', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);
    await execute(
      `INSERT INTO messages (id, conversation_id, contact_id, channel, direction, status)
       VALUES (?, ?, ?, 'whatsapp', 'inbound', 'received')`,
      [newId(), ingested.conversationId, ingested.contactId],
    );

    expect(
      (await runSlaCheck({ opportunityId: ingested.opportunityId, contactId: ingested.contactId, assignedUserId: agent.id }))
        .breached,
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Workflow B
  // -------------------------------------------------------------------------

  it('sends the 2-hour follow-up, creates a call task and moves the card to Attempted Contact', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);

    const result = await runWorkflowBStep({
      contactId: ingested.contactId,
      opportunityId: ingested.opportunityId,
      step: 'followup_2h',
    });
    expect(result.action).toBe('sent');

    const message = await queryOne<{ template_name: string }>(
      `SELECT template_name FROM messages WHERE contact_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
      [ingested.contactId],
    );
    expect(message?.template_name).toBe('followup_2h_en');

    const task = await queryOne<{ type: string; priority: string }>(
      'SELECT type, priority FROM tasks WHERE contact_id = ?',
      [ingested.contactId],
    );
    expect(task?.type).toBe('call');

    const opportunity = await queryOne<{ stage_key: string }>('SELECT stage_key FROM opportunities WHERE id = ?', [
      ingested.opportunityId,
    ]);
    expect(opportunity?.stage_key).toBe('attempted_contact');

    // The next step is scheduled.
    const next = await query<{ dedupe_key: string }>(
      `SELECT dedupe_key FROM jobs WHERE type = 'workflow.b.step' AND status = 'pending'`,
    );
    expect(next.some((j) => j.dedupe_key.endsWith('followup_24h'))).toBe(true);
  });

  it('quotes the verified starting price at 24 hours, and never invents one', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await seedVerifiedProject();
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);

    await runWorkflowBStep({ contactId: ingested.contactId, opportunityId: ingested.opportunityId, step: 'followup_24h' });

    const message = await queryOne<{ template_name: string; body: string }>(
      `SELECT template_name, body FROM messages
        WHERE contact_id = ? AND direction = 'outbound' AND channel = 'whatsapp'
        ORDER BY created_at DESC LIMIT 1`,
      [ingested.contactId],
    );
    expect(message?.template_name).toBe('followup_24h_en');
    expect(message?.body).toContain('1,850,000');
  });

  it('falls back to the generic follow-up when the project has no verified price', async () => {
    const agent = await createTestUser({ role: 'agent' });
    // No project row seeded: nothing is verified.
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);

    await runWorkflowBStep({ contactId: ingested.contactId, opportunityId: ingested.opportunityId, step: 'followup_24h' });

    const message = await queryOne<{ template_name: string; body: string }>(
      `SELECT template_name, body FROM messages
        WHERE contact_id = ? AND direction = 'outbound' AND channel = 'whatsapp'
        ORDER BY created_at DESC LIMIT 1`,
      [ingested.contactId],
    );
    expect(message?.template_name).toBe('followup_2h_en');
    expect(message?.body ?? '').not.toMatch(/AED\s[\d,]+/);
  });

  it('closes the lead as unresponsive at 96 hours and moves it to nurture', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);

    const result = await runWorkflowBStep({
      contactId: ingested.contactId,
      opportunityId: ingested.opportunityId,
      step: 'close_unresponsive',
    });
    expect(result.action).toBe('closed');

    const opportunity = await queryOne<{ stage_key: string; status: string; lost_reason: string }>(
      'SELECT stage_key, status, lost_reason FROM opportunities WHERE id = ?',
      [ingested.opportunityId],
    );
    expect(opportunity?.stage_key).toBe('lost');
    expect(opportunity?.status).toBe('lost');
    expect(opportunity?.lost_reason).toBe('unresponsive');

    const tags = await query<{ value: string }>(
      `SELECT t.value FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = ? AND t.namespace = 'ops'`,
      [ingested.contactId],
    );
    expect(tags.map((t) => t.value)).toContain('nurture');
  });

  it('stops the sequence once the lead replies', async () => {
    const ingested = await arriveLead();
    expect((await shouldContinue(ingested.contactId, ingested.opportunityId)).ok).toBe(true);

    await execute('UPDATE contacts SET last_inbound_at = NOW(3) WHERE id = ?', [ingested.contactId]);
    const check = await shouldContinue(ingested.contactId, ingested.opportunityId);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('lead_replied');

    const result = await runWorkflowBStep({
      contactId: ingested.contactId,
      opportunityId: ingested.opportunityId,
      step: 'followup_2h',
    });
    expect(result.action).toBe('skipped');
  });

  it('stops the sequence once the stage moves past Attempted Contact', async () => {
    const ingested = await arriveLead();
    await execute(`UPDATE opportunities SET stage_key = 'engaged_qualified' WHERE id = ?`, [ingested.opportunityId]);
    const check = await shouldContinue(ingested.contactId, ingested.opportunityId);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('stage_moved_past_attempted_contact');
  });

  it('stops the sequence once the opportunity closes or the lead opts out', async () => {
    const closed = await arriveLead({ phone: '+971501111111' });
    await execute(`UPDATE opportunities SET status = 'won' WHERE id = ?`, [closed.opportunityId]);
    expect((await shouldContinue(closed.contactId, closed.opportunityId)).reason).toBe('opportunity_closed');

    const optedOut = await arriveLead({ phone: '+971502222222' });
    await execute('UPDATE contacts SET dnc = 1 WHERE id = ?', [optedOut.contactId]);
    expect((await shouldContinue(optedOut.contactId, optedOut.opportunityId)).reason).toBe('opted_out');
  });

  // -------------------------------------------------------------------------
  // Workflow C
  // -------------------------------------------------------------------------

  async function inbound(contactId: string, conversationId: string, opportunityId: string, over: { text?: string | null; buttonPayload?: string | null } = {}) {
    const messageId = newId();
    await execute(
      `INSERT INTO messages (id, conversation_id, contact_id, channel, direction, provider, provider_message_id, body, status)
       VALUES (?, ?, ?, 'whatsapp', 'inbound', 'whatsapp_cloud', ?, ?, 'received')`,
      [messageId, conversationId, contactId, `wamid.${messageId}`, over.text ?? null],
    );
    // An inbound message opens the WhatsApp window.
    await execute('UPDATE conversations SET wa_window_expires_at = DATE_ADD(NOW(3), INTERVAL 24 HOUR) WHERE id = ?', [
      conversationId,
    ]);
    await execute('UPDATE contacts SET last_inbound_at = NOW(3) WHERE id = ?', [contactId]);

    return runWorkflowC({
      contactId,
      conversationId,
      messageId,
      opportunityId,
      text: over.text ?? null,
      buttonPayload: over.buttonPayload ?? null,
    });
  }

  it('cancels the follow-up sequence and moves the card to Engaged', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ?, stage_key = ? WHERE id = ?', [
      agent.id,
      'attempted_contact',
      ingested.opportunityId,
    ]);
    await execute(
      `INSERT INTO jobs (id, type, payload, status, contact_id, dedupe_key)
       VALUES (?, 'workflow.b.step', '{}', 'pending', ?, ?)`,
      [newId(), ingested.contactId, `wf-b:${ingested.opportunityId}:followup_24h`],
    );

    await inbound(ingested.contactId, ingested.conversationId, ingested.opportunityId, { text: 'Hello there' });

    const opportunity = await queryOne<{ stage_key: string; sub_status: string }>(
      'SELECT stage_key, sub_status FROM opportunities WHERE id = ?',
      [ingested.opportunityId],
    );
    expect(opportunity?.stage_key).toBe('engaged_qualified');
    expect(opportunity?.sub_status).toBe('engaged');

    const cancelled = await queryOne<{ status: string }>(
      `SELECT status FROM jobs WHERE type = 'workflow.b.step' AND contact_id = ?`,
      [ingested.contactId],
    );
    expect(cancelled?.status).toBe('cancelled');
  });

  it('answers PRICING from the verified project row', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await seedVerifiedProject();
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);

    const result = await inbound(ingested.contactId, ingested.conversationId, ingested.opportunityId, {
      buttonPayload: 'PRICING',
    });

    expect(result.intent).toBe('PRICING');
    expect(result.intentSource).toBe('button');
    expect(result.action).toBe('sent_verified_pricing');

    const message = await queryOne<{ body: string }>(
      `SELECT body FROM messages WHERE contact_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
      [ingested.contactId],
    );
    expect(message?.body).toContain('AED 1,850,000');
    expect(message?.body).toContain('80/20 until handover');
  });

  it('escalates to a human rather than inventing a price', async () => {
    const agent = await createTestUser({ role: 'agent' });
    // No verified project on file.
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);

    const result = await inbound(ingested.contactId, ingested.conversationId, ingested.opportunityId, {
      text: 'what is the price?',
    });

    expect(result.intent).toBe('PRICING');
    expect(result.action).toBe('escalated_no_verified_pricing');

    const message = await queryOne<{ body: string }>(
      `SELECT body FROM messages WHERE contact_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
      [ingested.contactId],
    );
    expect(message?.body ?? '').not.toMatch(/AED\s?[\d,]+/);
    expect(message?.body).toContain('advisor');

    const escalation = await query<{ type: string }>(
      `SELECT type FROM activities WHERE contact_id = ? AND type = 'conversation.needs_human'`,
      [ingested.contactId],
    );
    expect(escalation.length).toBeGreaterThan(0);
  });

  it('sends a WhatsApp location for LOCATION', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await seedVerifiedProject();
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);

    const result = await inbound(ingested.contactId, ingested.conversationId, ingested.opportunityId, {
      text: 'where is the project located?',
    });
    expect(result.intent).toBe('LOCATION');
    expect(result.action).toBe('sent_location');

    const message = await queryOne<{ payload: unknown; body: string }>(
      `SELECT payload, body FROM messages WHERE contact_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
      [ingested.contactId],
    );
    expect(String(message?.body)).toContain('location');
  });

  it('sends the branded brochure for BROCHURE', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await seedVerifiedProject();
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);

    const result = await inbound(ingested.contactId, ingested.conversationId, ingested.opportunityId, {
      text: 'please send the brochure',
    });
    expect(result.action).toBe('sent_brochure');
  });

  it('creates an urgent task and tags the lead hot for CALL_ME', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);

    const result = await inbound(ingested.contactId, ingested.conversationId, ingested.opportunityId, {
      buttonPayload: 'CALL_ME',
    });
    expect(result.action).toBe('call_requested');

    const task = await queryOne<{ priority: string; assigned_user_id: string }>(
      `SELECT priority, assigned_user_id FROM tasks WHERE contact_id = ? ORDER BY created_at DESC LIMIT 1`,
      [ingested.contactId],
    );
    expect(task?.priority).toBe('urgent');
    expect(task?.assigned_user_id).toBe(agent.id);

    const tags = await query<{ value: string }>(
      `SELECT t.value FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
        WHERE ct.contact_id = ? AND t.namespace = 'intent'`,
      [ingested.contactId],
    );
    expect(tags.map((t) => t.value)).toContain('hot');
  });

  it('adds the contact to DNC and confirms for STOP', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);

    const result = await inbound(ingested.contactId, ingested.conversationId, ingested.opportunityId, { text: 'STOP' });
    expect(result.intent).toBe('STOP');
    expect(result.action).toBe('dnc_added_and_confirmed');

    const contact = await queryOne<{ dnc: number; dnc_reason: string }>(
      'SELECT dnc, dnc_reason FROM contacts WHERE id = ?',
      [ingested.contactId],
    );
    expect(contact?.dnc).toBe(1);

    // The number is suppressed independently, so a merge cannot resurrect it.
    const suppression = await queryOne<{ kind: string }>('SELECT kind FROM suppressions WHERE value = ?', [
      '+971501234567',
    ]);
    expect(suppression?.kind).toBe('phone');

    const confirmation = await queryOne<{ body: string }>(
      `SELECT body FROM messages WHERE contact_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
      [ingested.contactId],
    );
    expect(confirmation?.body).toContain('unsubscribed');
  });

  it('never messages a contact again after they opt out', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);
    await inbound(ingested.contactId, ingested.conversationId, ingested.opportunityId, { text: 'STOP' });

    const before = await query('SELECT id FROM messages WHERE contact_id = ?', [ingested.contactId]);
    await runWorkflowBStep({ contactId: ingested.contactId, opportunityId: ingested.opportunityId, step: 'followup_2h' });
    const after = await query('SELECT id FROM messages WHERE contact_id = ?', [ingested.contactId]);

    expect(after.length).toBe(before.length);
  });

  it('leaves an unrecognised message for a human', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);

    const result = await inbound(ingested.contactId, ingested.conversationId, ingested.opportunityId, {
      text: 'my cousin visited Dubai last summer and loved it',
    });
    expect(result.intent).toBe('UNKNOWN');
    expect(['left_for_human', 'after_hours_acknowledged']).toContain(result.action);

    const escalation = await query(
      `SELECT id FROM activities WHERE contact_id = ? AND type = 'conversation.needs_human'`,
      [ingested.contactId],
    );
    expect(escalation.length).toBeGreaterThan(0);
  });

  it('routes a real inbound WhatsApp webhook end to end', async () => {
    await createTestUser({ role: 'agent' });
    const parsed = parseWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '556677889900112' },
                contacts: [{ profile: { name: 'Walk-in Lead' }, wa_id: '971504445555' }],
                messages: [
                  {
                    from: '971504445555',
                    id: 'wamid.E2E',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'Hi, what is the price?' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const stored = await handleInboundMessage(parsed.messages[0]!);
    expect(stored.isNewContact).toBe(true);

    // The webhook enqueues Workflow C; run it as the worker would.
    const job = await queryOne<{ payload: unknown }>(
      `SELECT payload FROM jobs WHERE type = 'workflow.c.route_inbound' AND contact_id = ?`,
      [stored.contactId],
    );
    expect(job).not.toBeNull();

    const result = await runWorkflowC({
      contactId: stored.contactId,
      conversationId: stored.conversationId,
      messageId: stored.messageId,
      opportunityId: null,
      text: 'Hi, what is the price?',
      buttonPayload: null,
    });
    expect(result.intent).toBe('PRICING');
  });
});

describeWithDb('workflow idempotency (integration)', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
  });
  beforeEach(async () => {
    await resetTables();
    await approveTemplates();
    setWhatsAppAdapterForTesting(new LogAdapter());
  });
  afterEach(() => setWhatsAppAdapterForTesting(null));
  afterAll(async () => {
    await closeTestDatabase();
  });

  it('never sends a second welcome when Workflow A runs twice', async () => {
    await createTestUser({ role: 'agent' });
    const ingested = await arriveLead();

    const first = await runWorkflowA({ opportunityId: ingested.opportunityId, contactId: ingested.contactId });
    const second = await runWorkflowA({ opportunityId: ingested.opportunityId, contactId: ingested.contactId });

    expect(first.welcomeSent).toBe(true);
    expect(second.welcomeSent).toBe(false);
    expect(second.assignmentReason).toBe('already_run');
    // The agent keeps the lead; the second call just reports it.
    expect(second.assignedUserId).toBe(first.assignedUserId);

    const sent = await query(
      `SELECT id FROM messages WHERE contact_id = ? AND direction = 'outbound'`,
      [ingested.contactId],
    );
    expect(sent).toHaveLength(1);
  });

  it('handles an inbound message once, however many times Workflow C is retried', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const ingested = await arriveLead();
    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [agent.id, ingested.opportunityId]);

    const messageId = newId();
    await execute(
      `INSERT INTO messages (id, conversation_id, contact_id, channel, direction, provider, provider_message_id, body, status)
       VALUES (?, ?, ?, 'whatsapp', 'inbound', 'whatsapp_cloud', ?, 'Call me please', 'received')`,
      [messageId, ingested.conversationId, ingested.contactId, `wamid.${messageId}`],
    );
    await execute('UPDATE conversations SET wa_window_expires_at = DATE_ADD(NOW(3), INTERVAL 24 HOUR) WHERE id = ?', [
      ingested.conversationId,
    ]);

    const run = () =>
      runWorkflowC({
        contactId: ingested.contactId,
        conversationId: ingested.conversationId,
        messageId,
        opportunityId: ingested.opportunityId,
        text: 'Call me please',
        buttonPayload: null,
      });

    const results = await Promise.all([run(), run(), run(), run(), run()]);

    expect(results.filter((r) => r.action === 'call_requested')).toHaveLength(1);
    expect(results.filter((r) => r.action === 'already_handled')).toHaveLength(4);

    // One reply to the lead, one call-back task — not five of each.
    const replies = await query(
      `SELECT id FROM messages WHERE contact_id = ? AND direction = 'outbound' AND is_automated = 1`,
      [ingested.contactId],
    );
    expect(replies).toHaveLength(1);

    const tasks = await query('SELECT id FROM tasks WHERE contact_id = ?', [ingested.contactId]);
    expect(tasks).toHaveLength(1);
  });

  it('sends exactly one welcome when ten retries race each other', async () => {
    await createTestUser({ role: 'agent' });
    const ingested = await arriveLead();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        runWorkflowA({ opportunityId: ingested.opportunityId, contactId: ingested.contactId }),
      ),
    );

    // Exactly one caller wins the claim; the rest report what it did.
    expect(results.filter((r) => r.welcomeSent)).toHaveLength(1);
    expect(results.filter((r) => r.assignmentReason === 'already_run')).toHaveLength(9);

    const sent = await query(
      `SELECT id FROM messages WHERE contact_id = ? AND direction = 'outbound'`,
      [ingested.contactId],
    );
    expect(sent).toHaveLength(1);

    const runs = await query(
      `SELECT id FROM workflow_runs WHERE workflow_key = 'A_instant_capture' AND opportunity_id = ?`,
      [ingested.opportunityId],
    );
    expect(runs).toHaveLength(1);
  });
});
