import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase,
  createTestUser,
  describeWithDb,
  execute,
  prepareTestDatabase,
  query,
  resetTables,
} from '../testing/db.js';
import { ingestLead } from './ingest.js';
import { normalizeLead } from './normalize.js';
import { emptyLead, type LeadDTO } from './dto.js';
import { normalizeMetaLead, metaLeadDetailSchema, extractLeadgenNotifications, fieldDataToRecord } from './sources/meta.js';
import { normalizeWebsiteLead, websiteFormSchema } from './sources/website.js';
import { googleLeadSchema, normalizeGoogleLead } from './sources/google.js';
import { parseWhatsAppWebhook, normalizeWhatsAppLead } from './sources/whatsapp.js';
import { handleInboundMessage, handleStatusUpdate } from './whatsapp-inbound.js';
import { recordInboundEvent } from './events.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures');
const fixture = async (name: string): Promise<unknown> => JSON.parse(await readFile(join(FIXTURES, name), 'utf8'));

const leadWith = (over: Partial<LeadDTO['person']>, rest: Partial<LeadDTO> = {}): LeadDTO => {
  const lead = emptyLead('website', `ext-${Math.random().toString(36).slice(2)}`);
  lead.person = { ...lead.person, ...over };
  return { ...lead, ...rest };
};

describeWithDb('ingestion (integration)', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
  });
  beforeEach(async () => {
    await resetTables();
  });
  afterAll(async () => {
    await closeTestDatabase();
  });

  it('creates one contact, one opportunity and one conversation for a new lead', async () => {
    const result = await ingestLead(leadWith({ fullName: 'Sara', phoneE164: '+971501234567', waId: '971501234567' }));

    expect(result.isNewContact).toBe(true);
    expect(result.isNewOpportunity).toBe(true);
    expect(await count('contacts')).toBe(1);
    expect(await count('opportunities')).toBe(1);
    expect(await count('conversations')).toBe(1);

    const opp = await one<{ stage_key: string; sub_status: string; status: string }>(
      'SELECT stage_key, sub_status, status FROM opportunities WHERE id = ?',
      [result.opportunityId],
    );
    expect(opp?.stage_key).toBe('new_lead');
    expect(opp?.sub_status).toBe('raw');
    expect(opp?.status).toBe('open');
  });

  it('matches a returning lead on phone and keeps their agent', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const first = await ingestLead(leadWith({ fullName: 'Sara', phoneE164: '+971501234567', waId: '971501234567' }));
    await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ?', [agent.id, first.contactId]);
    await execute('UPDATE opportunities SET status = ? WHERE id = ?', ['won', first.opportunityId]);

    const second = await ingestLead(
      leadWith({ fullName: 'Sara A.', phoneE164: '+971501234567' }, { source: 'meta_lead_ads' }),
    );

    expect(second.contactId).toBe(first.contactId);
    expect(second.isNewContact).toBe(false);
    expect(second.matchedBy).toBe('phone');
    expect(await count('contacts')).toBe(1);

    const opp = await one<{ owner_user_id: string }>('SELECT owner_user_id FROM opportunities WHERE id = ?', [
      second.opportunityId,
    ]);
    expect(opp?.owner_user_id).toBe(agent.id);
  });

  it('matches on wa_id when the phone column is empty', async () => {
    const first = await ingestLead(leadWith({ phoneE164: null, waId: '971509998888' }));
    const second = await ingestLead(leadWith({ phoneE164: null, waId: '971509998888' }));
    expect(second.contactId).toBe(first.contactId);
    expect(second.matchedBy).toBe('wa_id');
    expect(await count('contacts')).toBe(1);
  });

  it('keeps the first-touch source and fills only empty fields', async () => {
    const first = await ingestLead(
      leadWith({ fullName: 'Sara', phoneE164: '+971501234567' }, { source: 'meta_lead_ads' }),
    );
    await ingestLead(
      leadWith({ fullName: 'Someone Else', phoneE164: '+971501234567', email: 'sara@example.com', city: 'Dubai' }, { source: 'website' }),
    );

    const contact = await one<{ full_name: string; email: string; city: string; first_source: string; last_source: string }>(
      'SELECT full_name, email, city, first_source, last_source FROM contacts WHERE id = ?',
      [first.contactId],
    );
    expect(contact?.full_name).toBe('Sara');           // not overwritten
    expect(contact?.email).toBe('sara@example.com');   // was empty, so filled
    expect(contact?.city).toBe('Dubai');
    expect(contact?.first_source).toBe('meta_lead_ads');
    expect(contact?.last_source).toBe('website');
  });

  it('never overwrites a field an agent has edited', async () => {
    const first = await ingestLead(leadWith({ phoneE164: '+971501234567' }));
    await execute('UPDATE contacts SET full_name = NULL, locked_fields = ? WHERE id = ?', [
      JSON.stringify(['full_name']),
      first.contactId,
    ]);

    await ingestLead(leadWith({ fullName: 'Autofilled', phoneE164: '+971501234567' }));
    const contact = await one<{ full_name: string | null }>('SELECT full_name FROM contacts WHERE id = ?', [first.contactId]);
    expect(contact?.full_name).toBeNull();
  });

  it('adds an activity instead of an opportunity for a re-inquiry on the same project', async () => {
    const project = { projectName: 'Emaar Beachfront' };
    const first = await ingestLead({
      ...leadWith({ phoneE164: '+971501234567' }),
      realEstate: { ...emptyLead('website', 'x').realEstate, ...project },
    });
    const second = await ingestLead({
      ...leadWith({ phoneE164: '+971501234567' }),
      realEstate: { ...emptyLead('website', 'y').realEstate, ...project },
    });

    expect(second.opportunityId).toBe(first.opportunityId);
    expect(second.isNewOpportunity).toBe(false);
    expect(second.attachedReason).toBe('reinquiry_same_project');
    expect(await count('opportunities')).toBe(1);

    const activities = await query<{ type: string }>('SELECT type FROM activities WHERE opportunity_id = ?', [
      first.opportunityId,
    ]);
    expect(activities.map((a) => a.type)).toContain('lead.reinquiry');
  });

  it('opens a second opportunity for a different project', async () => {
    await ingestLead({
      ...leadWith({ phoneE164: '+971501234567' }),
      realEstate: { ...emptyLead('website', 'x').realEstate, projectName: 'Emaar Beachfront' },
    });
    await ingestLead({
      ...leadWith({ phoneE164: '+971501234567' }),
      realEstate: { ...emptyLead('website', 'y').realEstate, projectName: 'Damac Lagoons' },
    });
    expect(await count('contacts')).toBe(1);
    expect(await count('opportunities')).toBe(2);
  });

  it('keeps two people who share an email but not a phone as separate contacts', async () => {
    const first = await ingestLead(leadWith({ fullName: 'Sara', phoneE164: '+971501111111', email: 'family@example.com' }));
    const second = await ingestLead(leadWith({ fullName: 'Omar', phoneE164: '+971502222222', email: 'family@example.com' }));

    expect(second.contactId).not.toBe(first.contactId);
    expect(second.isNewContact).toBe(true);
    expect(second.possibleDuplicate).toBe(true);
    expect(await count('contacts')).toBe(2);

    // Both phone numbers survive — losing one would lose a lead.
    const phones = await query<{ phone_e164: string }>('SELECT phone_e164 FROM contacts ORDER BY phone_e164');
    expect(phones.map((p) => p.phone_e164)).toEqual(['+971501111111', '+971502222222']);

    // The new record points at the one it might duplicate, for the merge tool.
    const flagged = await one<{ possible_duplicate_of: string | null }>(
      'SELECT possible_duplicate_of FROM contacts WHERE id = ?',
      [second.contactId],
    );
    expect(flagged?.possible_duplicate_of).toBe(first.contactId);

    const tags = await query<{ value: string }>(
      `SELECT t.value FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
        WHERE ct.contact_id = ? AND t.namespace = 'ops'`,
      [second.contactId],
    );
    expect(tags.map((t) => t.value)).toContain('possible_duplicate');
  });

  it('merges on email when the incoming lead has no phone to disagree with', async () => {
    const first = await ingestLead(leadWith({ fullName: 'Sara', phoneE164: '+971501111111', email: 'sara@example.com' }));
    const second = await ingestLead(leadWith({ phoneE164: null, email: 'sara@example.com', city: 'Dubai' }));

    expect(second.contactId).toBe(first.contactId);
    expect(second.matchedBy).toBe('email');
    expect(second.possibleDuplicate).toBe(false);
    expect(await count('contacts')).toBe(1);
  });

  it('enqueues Workflow A exactly once per new opportunity', async () => {
    const result = await ingestLead(leadWith({ phoneE164: '+971501234567' }));
    const jobs = await query<{ type: string; dedupe_key: string }>('SELECT type, dedupe_key FROM jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.type).toBe('workflow.a.instant_capture');
    expect(jobs[0]?.dedupe_key).toBe(`wf-a:${result.opportunityId}`);
  });

  it('tags the contact with source, language and project', async () => {
    const result = await ingestLead({
      ...leadWith({ phoneE164: '+971501234567', language: 'ar' }, { source: 'meta_ctwa' }),
      realEstate: { ...emptyLead('website', 'x').realEstate, projectName: 'Emaar Beachfront' },
    });
    const tags = await query<{ namespace: string; value: string }>(
      `SELECT t.namespace, t.value FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = ?`,
      [result.contactId],
    );
    const flat = tags.map((t) => `${t.namespace}:${t.value}`);
    expect(flat).toContain('src:meta_ctwa');
    expect(flat).toContain('lang:ar');
    expect(flat).toContain('proj:emaar_beachfront');
  });

  it('records consent with the exact text the lead was shown', async () => {
    const lead = leadWith({ phoneE164: '+971501234567' });
    lead.consent = { whatsapp: true, email: true, sms: false, text: 'I agree to be contacted about property offers.' };
    const result = await ingestLead(lead);

    const consents = await query<{ channel: string; consent_text: string }>(
      'SELECT channel, consent_text FROM consents WHERE contact_id = ?',
      [result.contactId],
    );
    expect(consents.map((c) => c.channel).sort()).toEqual(['email', 'whatsapp']);
    expect(consents[0]?.consent_text).toBe('I agree to be contacted about property offers.');
  });

  // -------------------------------------------------------------------------
  // Replay tests over the sample payloads in /fixtures
  // -------------------------------------------------------------------------

  it('replays the Meta lead detail fixture into a complete lead', async () => {
    const detail = metaLeadDetailSchema.parse(await fixture('meta_lead_detail.json'));
    const lead = await normalizeMetaLead(detail);

    expect(lead.source).toBe('meta_lead_ads');
    expect(lead.externalId).toBe('987654321098765');
    expect(lead.person.fullName).toBe('Sara Al Mansoori');
    expect(lead.person.phoneE164).toBe('+971501234567');
    expect(lead.person.email).toBe('sara.almansoori@example.com');
    expect(lead.person.city).toBe('Dubai');
    expect(lead.attribution.campaignName).toBe('Q1-2026-Dubai-OffPlan-Leads');
    expect(lead.attribution.adId).toBe('23851234567890123');
    expect(lead.attribution.metaLeadId).toBe('987654321098765');

    // Unmapped custom questions are preserved, never dropped.
    expect(Object.keys(lead.unmapped)).toContain('what_is_your_budget?');
    expect(lead.notes).toContain('AED 1M - 2M');

    const result = await ingestLead(lead);
    expect(result.isNewContact).toBe(true);

    // Replaying the identical payload must not produce a second contact.
    const replay = await ingestLead(await normalizeMetaLead(detail));
    expect(replay.contactId).toBe(result.contactId);
    expect(await count('contacts')).toBe(1);
    expect(await count('opportunities')).toBe(1);
  });

  it('maps a Meta custom question once an admin adds the mapping', async () => {
    await execute(
      `INSERT INTO form_field_map (id, source, form_id, external_field, crm_field)
       VALUES (UUID(), 'meta_lead_ads', '1234567890123456', 'what_is_your_budget?', 'budget_band'),
              (UUID(), 'meta_lead_ads', '1234567890123456', 'which_project_are_you_interested_in?', 'project'),
              (UUID(), 'meta_lead_ads', '1234567890123456', 'when_are_you_looking_to_buy?', 'timeline'),
              (UUID(), 'meta_lead_ads', '1234567890123456', 'are_you_buying_to_invest_or_to_live_in?', 'purpose'),
              (UUID(), 'meta_lead_ads', '1234567890123456', 'are_you_interested_in_the_golden_visa?', 'golden_visa')`,
    );

    const detail = metaLeadDetailSchema.parse(await fixture('meta_lead_detail.json'));
    const lead = await normalizeMetaLead(detail);

    expect(lead.realEstate.budgetBand).toBe('AED 1M - 2M');
    expect(lead.realEstate.budgetMinAed).toBe(1_000_000);
    expect(lead.realEstate.budgetMaxAed).toBe(2_000_000);
    expect(lead.realEstate.projectName).toBe('Emaar Beachfront');
    expect(lead.realEstate.timeline).toBe('1_3_months');
    expect(lead.realEstate.purpose).toBe('investment');
    expect(lead.realEstate.goldenVisaInterest).toBe(true);
  });

  it('extracts leadgen notifications from the webhook envelope', async () => {
    const notifications = extractLeadgenNotifications(await fixture('meta_leadgen_webhook.json'));
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.leadgen_id).toBe('987654321098765');
    expect(notifications[0]?.form_id).toBe('1234567890123456');
  });

  it('replays the website form fixture', async () => {
    const payload = websiteFormSchema.parse(await fixture('website_form.json'));
    const lead = await normalizeWebsiteLead(payload, '84.23.1.9', 'Mozilla/5.0');

    expect(lead.person.phoneE164).toBe('+971509876543');
    expect(lead.person.email).toBe('ahmed.khalil@example.com');
    expect(lead.realEstate.projectName).toBe('Dubai Creek Harbour');
    expect(lead.attribution.gclid).toBe('Cj0KCQiA_fake_gclid_value_12345');
    expect(lead.attribution.utmCampaign).toBe('creek-harbour-2026');
    expect(lead.consent.whatsapp).toBe(true);
    expect(lead.consent.text).toContain('I agree to be contacted');

    const result = await ingestLead(lead);
    const opp = await one<{ gclid: string; utm_source: string; landing_page: string }>(
      'SELECT gclid, utm_source, landing_page FROM opportunities WHERE id = ?',
      [result.opportunityId],
    );
    expect(opp?.gclid).toBe('Cj0KCQiA_fake_gclid_value_12345');
    expect(opp?.utm_source).toBe('google');
  });

  it('replays the Google Ads lead fixture', async () => {
    const payload = googleLeadSchema.parse(await fixture('google_lead_form.json'));
    const lead = await normalizeGoogleLead(payload);

    expect(lead.source).toBe('google_ads');
    expect(lead.person.fullName).toBe('Fatima Noor');
    expect(lead.person.phoneE164).toBe('+971551112233');
    expect(lead.person.city).toBe('Abu Dhabi');
    expect(lead.attribution.gclid).toBe('Cj0KCQiA_fake_gclid_value_98765');

    const result = await ingestLead(lead);
    expect(result.isNewContact).toBe(true);
  });

  it('replays an inbound WhatsApp text into a contact and a message', async () => {
    const parsed = parseWhatsAppWebhook(await fixture('whatsapp_inbound_text.json'));
    expect(parsed.messages).toHaveLength(1);

    const result = await handleInboundMessage(parsed.messages[0]!);
    expect(result.isNewContact).toBe(true);
    expect(await count('messages')).toBe(1);

    const message = await one<{ direction: string; channel: string; body: string; status: string }>(
      'SELECT direction, channel, body, status FROM messages WHERE id = ?',
      [result.messageId],
    );
    expect(message?.direction).toBe('inbound');
    expect(message?.channel).toBe('whatsapp');
    expect(message?.body).toBe('Hi, what is the price for a 2 bedroom?');
    expect(message?.status).toBe('received');

    const contact = await one<{ wa_id: string; last_inbound_at: Date }>(
      'SELECT wa_id, last_inbound_at FROM contacts WHERE id = ?',
      [result.contactId],
    );
    expect(contact?.wa_id).toBe('971501234567');
    expect(contact?.last_inbound_at).toBeInstanceOf(Date);

    // Redelivery of the same message id is a no-op.
    const replay = await handleInboundMessage(parsed.messages[0]!);
    expect(replay.duplicate).toBe(true);
    expect(await count('messages')).toBe(1);
  });

  it('attributes a click-to-WhatsApp lead to the ad that produced it', async () => {
    const parsed = parseWhatsAppWebhook(await fixture('whatsapp_inbound_ctwa_referral.json'));
    const message = parsed.messages[0]!;
    expect(message.referral?.ctwa_clid).toBe('ARAaZmFrZV9jdHdhX2NsaWNrX2lkXzEyMzQ1');

    const lead = normalizeWhatsAppLead(message);
    expect(lead.source).toBe('meta_ctwa');
    expect(lead.attribution.ctwaClid).toBe('ARAaZmFrZV9jdHdhX2NsaWNrX2lkXzEyMzQ1');
    expect(lead.attribution.adId).toBe('23851234567890123');
    expect(lead.person.language).toBe('ar');

    const result = await handleInboundMessage(message);
    const opp = await one<{ source: string; ctwa_clid: string }>(
      'SELECT source, ctwa_clid FROM opportunities WHERE contact_id = ?',
      [result.contactId],
    );
    expect(opp?.source).toBe('meta_ctwa');
    expect(opp?.ctwa_clid).toBe('ARAaZmFrZV9jdHdhX2NsaWNrX2lkXzEyMzQ1');
  });

  it('parses a template quick-reply into a button payload', async () => {
    const parsed = parseWhatsAppWebhook(await fixture('whatsapp_inbound_button.json'));
    expect(parsed.messages[0]?.buttonPayload).toBe('PRICING');
    expect(parsed.messages[0]?.contextMessageId).toBe('wamid.HBgLOTcxNDEyMzQ1NjcVAgAR');
  });

  it('parses an interactive button reply', async () => {
    const parsed = parseWhatsAppWebhook(await fixture('whatsapp_inbound_interactive.json'));
    expect(parsed.messages[0]?.buttonPayload).toBe('CALL_ME');
    expect(parsed.messages[0]?.buttonText).toBe('Call me');
  });

  it('parses inbound media with its caption', async () => {
    const parsed = parseWhatsAppWebhook(await fixture('whatsapp_inbound_media.json'));
    const message = parsed.messages[0]!;
    expect(message.type).toBe('image');
    expect(message.media?.kind).toBe('image');
    expect(message.media?.id).toBe('media-id-1122334455');
    expect(message.text).toBe('Is this the tower you mentioned?');
  });

  it('applies delivery ticks and never moves a message backwards', async () => {
    const parsed = parseWhatsAppWebhook(await fixture('whatsapp_inbound_text.json'));
    const inbound = await handleInboundMessage(parsed.messages[0]!);

    // Record an outbound message we can tick.
    await execute(
      `INSERT INTO messages (id, conversation_id, contact_id, channel, direction, provider, provider_message_id, body, status)
       VALUES (UUID(), ?, ?, 'whatsapp', 'outbound', 'whatsapp_cloud', ?, 'hello', 'sent')`,
      [inbound.conversationId, inbound.contactId, 'wamid.HBgLOTcxNDEyMzQ1NjcVAgARGBI5QTBCMUMyRDNFNEY1QTZCN0MA'],
    );

    const statuses = parseWhatsAppWebhook(await fixture('whatsapp_statuses.json')).statuses;
    expect(await handleStatusUpdate(statuses[0]!)).toBe(true);
    let row = await one<{ status: string; delivered_at: Date | null }>(
      'SELECT status, delivered_at FROM messages WHERE provider_message_id = ?',
      ['wamid.HBgLOTcxNDEyMzQ1NjcVAgARGBI5QTBCMUMyRDNFNEY1QTZCN0MA'],
    );
    expect(row?.status).toBe('delivered');
    expect(row?.delivered_at).toBeInstanceOf(Date);

    // A late "sent" must not undo "delivered".
    expect(await handleStatusUpdate({ ...statuses[0]!, status: 'sent' })).toBe(false);
    row = await one<{ status: string; delivered_at: Date | null }>(
      'SELECT status, delivered_at FROM messages WHERE provider_message_id = ?',
      ['wamid.HBgLOTcxNDEyMzQ1NjcVAgARGBI5QTBCMUMyRDNFNEY1QTZCN0MA'],
    );
    expect(row?.status).toBe('delivered');
  });

  it('records a failed send with the Meta error code', async () => {
    const parsed = parseWhatsAppWebhook(await fixture('whatsapp_inbound_text.json'));
    const inbound = await handleInboundMessage(parsed.messages[0]!);
    await execute(
      `INSERT INTO messages (id, conversation_id, contact_id, channel, direction, provider, provider_message_id, body, status, is_automated)
       VALUES (UUID(), ?, ?, 'whatsapp', 'outbound', 'whatsapp_cloud', ?, 'hello', 'sent', 1)`,
      [inbound.conversationId, inbound.contactId, 'wamid.HBgLOTcxNDEyMzQ1NjcVAgARGBJBMEIxQzJEM0U0RjVBNkI3QzgA'],
    );

    const statuses = parseWhatsAppWebhook(await fixture('whatsapp_status_failed.json')).statuses;
    expect(await handleStatusUpdate(statuses[0]!)).toBe(true);

    const row = await one<{ status: string; error_code: string }>(
      'SELECT status, error_code FROM messages WHERE provider_message_id = ?',
      ['wamid.HBgLOTcxNDEyMzQ1NjcVAgARGBJBMEIxQzJEM0U0RjVBNkI3QzgA'],
    );
    expect(row?.status).toBe('failed');
    expect(row?.error_code).toBe('131049');

    // A marketing-limit failure schedules the email fallback.
    const jobs = await query<{ type: string }>(`SELECT type FROM jobs WHERE type = 'workflow.b.step'`);
    expect(jobs.length).toBe(1);
  });

  it('stores raw payloads and rejects replays at the event layer', async () => {
    const payload = await fixture('meta_leadgen_webhook.json');
    const first = await recordInboundEvent({ source: 'meta_lead_ads', externalId: '987654321098765', payload, signatureValid: true });
    const second = await recordInboundEvent({ source: 'meta_lead_ads', externalId: '987654321098765', payload, signatureValid: true });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    expect(await count('inbound_events')).toBe(1);
  });

  it('normalizes phone numbers from every source into the same contact', async () => {
    // The same person, written five different ways across five sources.
    const variants: Array<[string, LeadDTO['source']]> = [
      ['050 123 4567', 'meta_lead_ads'],
      ['+971501234567', 'website'],
      ['971501234567', 'google_ads'],
      ['00971501234567', 'csv_import'],
      ['0501234567', 'manual'],
    ];

    for (const [raw, source] of variants) {
      await ingestLead(
        normalizeLead({ source, externalId: `${source}-${raw}`, mapped: { phone: raw, full_name: 'Sara' } }),
      );
    }
    expect(await count('contacts')).toBe(1);
  });
});

async function count(table: string): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0]?.n ?? 0);
}

async function one<T>(sql: string, params: Array<string | number | Date | null> = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
