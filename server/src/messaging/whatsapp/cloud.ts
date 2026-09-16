import { GRAPH_BASE } from '../../config/api-versions.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import type { TemplateComponent } from '../templates/types.js';
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

/** WhatsApp Cloud API, direct from Meta. */
export class CloudApiAdapter implements WhatsAppAdapter {
  readonly name = 'whatsapp_cloud';

  private token(): string {
    const token = env().WHATSAPP_ACCESS_TOKEN;
    if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN is not configured');
    return token;
  }

  private phoneNumberId(): string {
    const id = env().WHATSAPP_PHONE_NUMBER_ID;
    if (!id) throw new Error('WHATSAPP_PHONE_NUMBER_ID is not configured');
    return id;
  }

  private async post(body: Record<string, unknown>): Promise<SendResult> {
    const url = `${GRAPH_BASE}/${this.phoneNumberId()}/messages`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...body }),
      });
      const json = (await response.json()) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } };
      };

      if (!response.ok || json.error) {
        const code = json.error?.code !== undefined ? String(json.error.code) : String(response.status);
        const message = json.error?.error_data?.details ?? json.error?.message ?? `HTTP ${response.status}`;
        logger.warn('whatsapp cloud send failed', { code, message });
        return failure(this.name, message, code, json);
      }
      return {
        providerMessageId: json.messages?.[0]?.id ?? null,
        provider: this.name,
        ok: true,
        errorCode: null,
        errorMessage: null,
        raw: json,
      };
    } catch (err) {
      return failure(this.name, err instanceof Error ? err.message : String(err), 'network_error');
    }
  }

  async sendTemplate(input: TemplateSend): Promise<SendResult> {
    const components: Array<Record<string, unknown>> = [];

    if (input.header) {
      if (input.header.kind === 'text') {
        components.push({ type: 'header', parameters: [{ type: 'text', text: input.header.text }] });
      } else {
        const media: Record<string, unknown> = { link: input.header.link };
        if (input.header.kind === 'document' && input.header.filename) media.filename = input.header.filename;
        components.push({ type: 'header', parameters: [{ type: input.header.kind, [input.header.kind]: media }] });
      }
    }
    if (input.bodyParams.length) {
      components.push({
        type: 'body',
        parameters: input.bodyParams.map((text) => ({ type: 'text', text })),
      });
    }
    input.buttonPayloads?.forEach((payload, index) => {
      components.push({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload }],
      });
    });

    return this.post({
      to: input.toWaId,
      type: 'template',
      template: {
        name: input.templateName,
        language: { code: input.language },
        ...(components.length ? { components } : {}),
      },
    });
  }

  async sendText(input: TextSend): Promise<SendResult> {
    return this.post({
      to: input.toWaId,
      type: 'text',
      text: { body: input.text, preview_url: input.previewUrl ?? false },
    });
  }

  async sendMedia(input: MediaSend): Promise<SendResult> {
    const media: Record<string, unknown> = { link: input.link };
    if (input.caption && input.kind !== 'audio') media.caption = input.caption;
    if (input.filename && input.kind === 'document') media.filename = input.filename;
    return this.post({ to: input.toWaId, type: input.kind, [input.kind]: media });
  }

  async sendLocation(input: LocationSend): Promise<SendResult> {
    return this.post({
      to: input.toWaId,
      type: 'location',
      location: {
        latitude: input.latitude,
        longitude: input.longitude,
        ...(input.name ? { name: input.name } : {}),
        ...(input.address ? { address: input.address } : {}),
      },
    });
  }

  async sendInteractiveButtons(input: InteractiveButtonsSend): Promise<SendResult> {
    return this.post({
      to: input.toWaId,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(input.header ? { header: { type: 'text', text: input.header } } : {}),
        body: { text: input.body },
        ...(input.footer ? { footer: { text: input.footer } } : {}),
        // Meta allows at most 3 interactive reply buttons.
        action: { buttons: input.buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    });
  }

  async listTemplates() {
    const wabaId = env().WHATSAPP_BUSINESS_ACCOUNT_ID;
    if (!wabaId) throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID is not configured');

    const out: Array<{
      name: string;
      language: string;
      status: string;
      category: string;
      components: TemplateComponent[];
      id?: string;
      rejectedReason?: string | null;
      qualityScore?: string | null;
    }> = [];

    let url: string | null =
      `${GRAPH_BASE}/${wabaId}/message_templates?limit=100&fields=name,language,status,category,components,id,rejected_reason,quality_score`;

    while (url) {
      const response: Response = await fetch(url, { headers: { Authorization: `Bearer ${this.token()}` } });
      const json = (await response.json()) as {
        data?: Array<Record<string, unknown>>;
        paging?: { next?: string };
        error?: { message?: string };
      };
      if (!response.ok || json.error) {
        throw new Error(`Template sync failed: ${json.error?.message ?? response.status}`);
      }
      for (const row of json.data ?? []) {
        out.push({
          name: String(row.name),
          language: String(row.language),
          status: String(row.status),
          category: String(row.category),
          components: (row.components ?? []) as TemplateComponent[],
          id: row.id ? String(row.id) : undefined,
          rejectedReason: row.rejected_reason ? String(row.rejected_reason) : null,
          qualityScore:
            row.quality_score && typeof row.quality_score === 'object'
              ? String((row.quality_score as { score?: string }).score ?? '')
              : null,
        });
      }
      url = json.paging?.next ?? null;
    }
    return out;
  }
}
