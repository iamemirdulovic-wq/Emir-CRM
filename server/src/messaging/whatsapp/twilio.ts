import { API_VERSIONS } from '../../config/api-versions.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import {
  failure,
  type InteractiveButtonsSend,
  type LocationSend,
  type MediaSend,
  type SendResult,
  type TemplateSend,
  type TextSend,
  type WhatsAppAdapter,
} from './adapter.js';

/** Twilio's WhatsApp channel, behind the same interface. */
export class TwilioAdapter implements WhatsAppAdapter {
  readonly name = 'twilio';

  private credentials(): { sid: string; token: string; from: string } {
    const cfg = env();
    if (!cfg.TWILIO_ACCOUNT_SID || !cfg.TWILIO_AUTH_TOKEN || !cfg.TWILIO_WHATSAPP_FROM) {
      throw new Error('Twilio is not fully configured (SID, auth token and WhatsApp sender are all required)');
    }
    return { sid: cfg.TWILIO_ACCOUNT_SID, token: cfg.TWILIO_AUTH_TOKEN, from: cfg.TWILIO_WHATSAPP_FROM };
  }

  private async call(params: Record<string, string>): Promise<SendResult> {
    try {
      const { sid, token, from } = this.credentials();
      const url = `https://api.twilio.com/${API_VERSIONS.twilio}/Accounts/${sid}/Messages.json`;
      const body = new URLSearchParams({ From: `whatsapp:${from.replace(/^whatsapp:/, '')}`, ...params });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      const json = (await response.json()) as { sid?: string; message?: string; code?: number };
      if (!response.ok) {
        logger.warn('twilio send failed', { code: json.code, message: json.message });
        return failure(this.name, json.message ?? `HTTP ${response.status}`, json.code ? String(json.code) : null, json);
      }
      return { providerMessageId: json.sid ?? null, provider: this.name, ok: true, errorCode: null, errorMessage: null, raw: json };
    } catch (err) {
      return failure(this.name, err instanceof Error ? err.message : String(err), 'network_error');
    }
  }

  private to(waId: string): string {
    return `whatsapp:+${waId.replace(/^\+/, '')}`;
  }

  async sendTemplate(input: TemplateSend): Promise<SendResult> {
    // Twilio addresses approved templates by Content SID; the template name is
    // expected to hold it (HX…) when this provider is in use.
    return this.call({
      To: this.to(input.toWaId),
      ContentSid: input.templateName,
      ContentVariables: JSON.stringify(Object.fromEntries(input.bodyParams.map((v, i) => [String(i + 1), v]))),
    });
  }

  async sendText(input: TextSend): Promise<SendResult> {
    return this.call({ To: this.to(input.toWaId), Body: input.text });
  }

  async sendMedia(input: MediaSend): Promise<SendResult> {
    return this.call({
      To: this.to(input.toWaId),
      MediaUrl: input.link,
      ...(input.caption ? { Body: input.caption } : {}),
    });
  }

  async sendLocation(input: LocationSend): Promise<SendResult> {
    return this.call({
      To: this.to(input.toWaId),
      PersistentAction: `geo:${input.latitude},${input.longitude}${input.name ? `|${input.name}` : ''}`,
      Body: input.name ?? 'Location',
    });
  }

  async sendInteractiveButtons(input: InteractiveButtonsSend): Promise<SendResult> {
    // Twilio requires a pre-approved Content template for buttons; fall back to
    // numbered options so the conversation still works.
    const options = input.buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
    return this.sendText({ toWaId: input.toWaId, text: `${input.body}\n\n${options}` });
  }

  async listTemplates() {
    logger.info('twilio adapter does not expose Meta template status; manage content in the Twilio console');
    return [];
  }
}
