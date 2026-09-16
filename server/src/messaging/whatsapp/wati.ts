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

/**
 * Wati, behind the same interface as Cloud API. Wati proxies Meta, so templates
 * are managed in its console and only the send surface differs.
 */
export class WatiAdapter implements WhatsAppAdapter {
  readonly name = 'wati';

  private base(): string {
    const base = env().WATI_BASE_URL;
    if (!base) throw new Error('WATI_BASE_URL is not configured');
    return `${base.replace(/\/+$/, '')}/api/${API_VERSIONS.wati}`;
  }

  private token(): string {
    const token = env().WATI_ACCESS_TOKEN;
    if (!token) throw new Error('WATI_ACCESS_TOKEN is not configured');
    return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }

  private async call(path: string, body: Record<string, unknown>, waId: string): Promise<SendResult> {
    try {
      const url = `${this.base()}${path}?whatsappNumber=${encodeURIComponent(waId)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: this.token(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as { result?: boolean; id?: string; info?: string; message?: unknown };
      if (!response.ok || json.result === false) {
        const message = json.info ?? (typeof json.message === 'string' ? json.message : `HTTP ${response.status}`);
        logger.warn('wati send failed', { message });
        return failure(this.name, message, String(response.status), json);
      }
      return { providerMessageId: json.id ?? null, provider: this.name, ok: true, errorCode: null, errorMessage: null, raw: json };
    } catch (err) {
      return failure(this.name, err instanceof Error ? err.message : String(err), 'network_error');
    }
  }

  async sendTemplate(input: TemplateSend): Promise<SendResult> {
    return this.call(
      '/sendTemplateMessage',
      {
        template_name: input.templateName,
        broadcast_name: `${input.templateName}_${Date.now()}`,
        // Wati addresses body variables by index name, not position.
        parameters: input.bodyParams.map((value, i) => ({ name: String(i + 1), value })),
      },
      input.toWaId,
    );
  }

  async sendText(input: TextSend): Promise<SendResult> {
    return this.call('/sendSessionMessage', { messageText: input.text }, input.toWaId);
  }

  async sendMedia(input: MediaSend): Promise<SendResult> {
    return this.call(
      '/sendSessionFile',
      { url: input.link, caption: input.caption ?? '', fileName: input.filename ?? '' },
      input.toWaId,
    );
  }

  async sendLocation(input: LocationSend): Promise<SendResult> {
    // Wati has no location endpoint; a maps link is the closest equivalent.
    const label = input.name ? `${input.name}\n` : '';
    return this.sendText({
      toWaId: input.toWaId,
      text: `${label}https://maps.google.com/?q=${input.latitude},${input.longitude}`,
      previewUrl: true,
    });
  }

  async sendInteractiveButtons(input: InteractiveButtonsSend): Promise<SendResult> {
    return this.call(
      '/sendInteractiveButtonsMessage',
      {
        body: input.body,
        ...(input.header ? { header: { type: 'Text', text: input.header } } : {}),
        ...(input.footer ? { footer: input.footer } : {}),
        buttons: input.buttons.slice(0, 3).map((b) => ({ text: b.title.slice(0, 20) })),
      },
      input.toWaId,
    );
  }

  async listTemplates() {
    // Templates live in the Wati console; syncing them is out of scope here.
    logger.info('wati adapter does not expose template status; manage templates in the Wati console');
    return [];
  }
}
