import { env } from '../../config/env.js';
import type { WhatsAppAdapter } from './adapter.js';
import { CloudApiAdapter } from './cloud.js';
import { LogAdapter } from './log.js';
import { TwilioAdapter } from './twilio.js';
import { WatiAdapter } from './wati.js';

let cached: WhatsAppAdapter | null = null;

/** The configured provider. `log` keeps development off the wire. */
export function whatsapp(): WhatsAppAdapter {
  if (cached) return cached;
  switch (env().WHATSAPP_PROVIDER) {
    case 'cloud':
      cached = new CloudApiAdapter();
      break;
    case 'wati':
      cached = new WatiAdapter();
      break;
    case 'twilio':
      cached = new TwilioAdapter();
      break;
    default:
      cached = new LogAdapter();
  }
  return cached;
}

/** Tests swap the provider through here. */
export function setWhatsAppAdapterForTesting(adapter: WhatsAppAdapter | null): void {
  cached = adapter;
}

export * from './adapter.js';
