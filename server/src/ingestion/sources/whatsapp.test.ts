import { describe, expect, it } from 'vitest';
import { parseWhatsAppWebhook } from './whatsapp.js';

const envelope = (message: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: '1' },
            contacts: [{ profile: { name: 'Sara' }, wa_id: '971501234567' }],
            messages: [message],
          },
        },
      ],
    },
  ],
});

describe('inbound message timestamps', () => {
  const base = { from: '971501234567', id: 'wamid.X', type: 'text', text: { body: 'hi' } };

  it('uses the provider timestamp when it is in the past', () => {
    const tenMinutesAgo = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
    const parsed = parseWhatsAppWebhook(envelope({ ...base, timestamp: String(tenMinutesAgo) }));
    expect(parsed.messages[0]?.sentAt.getTime()).toBe(tenMinutesAgo * 1000);
  });

  it('clamps a future timestamp to now, so the WhatsApp window cannot be overstated', () => {
    const anHourAhead = Math.floor((Date.now() + 60 * 60 * 1000) / 1000);
    const parsed = parseWhatsAppWebhook(envelope({ ...base, timestamp: String(anHourAhead) }));
    const sentAt = parsed.messages[0]?.sentAt.getTime() ?? 0;
    expect(sentAt).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('falls back to now for a missing or nonsense timestamp', () => {
    for (const timestamp of ['0', '-5', 'not-a-number']) {
      const parsed = parseWhatsAppWebhook(envelope({ ...base, timestamp }));
      const sentAt = parsed.messages[0]?.sentAt.getTime() ?? 0;
      expect(Math.abs(sentAt - Date.now()), timestamp).toBeLessThan(5000);
    }
  });
});
