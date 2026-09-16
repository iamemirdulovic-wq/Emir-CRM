import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase,
  describeWithDb,
  prepareTestDatabase,
  query,
  resetTables,
} from '../testing/db.js';
import { ingestLead } from './ingest.js';
import { normalizeLead } from './normalize.js';
import { handleInboundMessage } from './whatsapp-inbound.js';
import { parseWhatsAppWebhook } from './sources/whatsapp.js';

/**
 * The duplicate-storm test from the master prompt: the same lead arriving 20
 * times in parallel must produce exactly one contact.
 *
 * This is the load shape a real Meta webhook retry storm produces, and it is
 * where naive "check then insert" identity resolution falls over.
 */
describeWithDb('duplicate storm (integration)', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
  });
  beforeEach(async () => {
    await resetTables();
  });
  afterAll(async () => {
    await closeTestDatabase();
  });

  it('20 identical leads in parallel produce exactly 1 contact and 1 opportunity', async () => {
    const attempts = Array.from({ length: 20 }, (_, i) =>
      ingestLead(
        normalizeLead({
          source: 'meta_lead_ads',
          externalId: `storm-${i}`,
          mapped: {
            full_name: 'Sara Al Mansoori',
            phone: '+971501234567',
            email: 'sara@example.com',
            project: 'Emaar Beachfront',
          },
        }),
      ),
    );

    const results = await Promise.all(attempts);

    expect(await count('contacts')).toBe(1);
    expect(await count('opportunities')).toBe(1);
    expect(await count('conversations')).toBe(1);

    // Every caller got the same identity back.
    const contactIds = new Set(results.map((r) => r.contactId));
    expect(contactIds.size).toBe(1);
    const opportunityIds = new Set(results.map((r) => r.opportunityId));
    expect(opportunityIds.size).toBe(1);

    // Exactly one of them created the contact.
    expect(results.filter((r) => r.isNewContact)).toHaveLength(1);
    expect(results.filter((r) => r.isNewOpportunity)).toHaveLength(1);

    // Workflow A is scheduled once, not twenty times.
    const jobs = await query<{ type: string }>(`SELECT type FROM jobs WHERE type = 'workflow.a.instant_capture'`);
    expect(jobs).toHaveLength(1);
  });

  it('20 parallel leads written five different ways still produce 1 contact', async () => {
    const formats = ['+971501234567', '971501234567', '0501234567', '050 123 4567', '00971501234567'];
    const attempts = Array.from({ length: 20 }, (_, i) =>
      ingestLead(
        normalizeLead({
          source: 'website',
          externalId: `mixed-${i}`,
          mapped: { full_name: 'Sara', phone: formats[i % formats.length] as string },
        }),
      ),
    );

    await Promise.all(attempts);
    expect(await count('contacts')).toBe(1);
    expect(await count('opportunities')).toBe(1);
  });

  it('20 parallel inbound WhatsApp webhooks for one number produce 1 contact and 20 messages', async () => {
    const base = parseWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '778899001122334',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '556677889900112' },
                contacts: [{ profile: { name: 'Sara' }, wa_id: '971501234567' }],
                messages: [
                  { from: '971501234567', id: 'wamid.BASE', timestamp: '1774001000', type: 'text', text: { body: 'hi' } },
                ],
              },
            },
          ],
        },
      ],
    });
    const template = base.messages[0]!;

    // Twenty distinct messages from the same person, all at once.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        handleInboundMessage({ ...template, providerMessageId: `wamid.STORM.${i}` }),
      ),
    );

    expect(await count('contacts')).toBe(1);
    expect(await count('messages')).toBe(20);
    expect(new Set(results.map((r) => r.contactId)).size).toBe(1);
    expect(results.filter((r) => r.duplicate)).toHaveLength(0);
  });

  it('the same WhatsApp message redelivered 20 times is stored once', async () => {
    const base = parseWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '778899001122334',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '556677889900112' },
                contacts: [{ profile: { name: 'Sara' }, wa_id: '971501234567' }],
                messages: [
                  {
                    from: '971501234567',
                    id: 'wamid.REDELIVERED',
                    timestamp: '1774001000',
                    type: 'text',
                    text: { body: 'hello' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const message = base.messages[0]!;

    await Promise.all(Array.from({ length: 20 }, () => handleInboundMessage(message)));

    expect(await count('contacts')).toBe(1);
    expect(await count('messages')).toBe(1);
  });

  it('two different people arriving together stay two contacts', async () => {
    const people = [
      { name: 'Sara', phone: '+971501234567' },
      { name: 'Omar', phone: '+971559876543' },
    ];
    const attempts = Array.from({ length: 20 }, (_, i) => {
      const person = people[i % 2] as { name: string; phone: string };
      return ingestLead(
        normalizeLead({
          source: 'meta_lead_ads',
          externalId: `two-${i}`,
          mapped: { full_name: person.name, phone: person.phone },
        }),
      );
    });

    await Promise.all(attempts);
    expect(await count('contacts')).toBe(2);
    expect(await count('opportunities')).toBe(2);
  });
});

async function count(table: string): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0]?.n ?? 0);
}
