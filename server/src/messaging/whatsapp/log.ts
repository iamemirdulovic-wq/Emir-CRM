import { env } from '../../config/env.js';
import { newToken } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { maskPhone } from '../../lib/redact.js';
import type {
  InteractiveButtonsSend,
  LocationSend,
  MediaSend,
  SendResult,
  TemplateSend,
  TextSend,
  WhatsAppAdapter,
} from './adapter.js';

/** Shown in the inbox when the CRM is running without WhatsApp connected. */
export const NOT_CONNECTED_MESSAGE =
  'Not sent — WhatsApp is not connected yet. Call or email this lead instead.';

/**
 * Development and test provider. It never reaches the network.
 *
 * In development it reports success, so the whole system — workflows, the
 * inbox, the demo data — can be exercised without a WhatsApp Business account.
 *
 * In production it reports **failure**, deliberately. Running live with this
 * provider is allowed (ALLOW_FAKE_WHATSAPP), because a brokerage can work
 * imports and calls long before WhatsApp is approved — but a message that
 * never left the building must not appear in the inbox wearing a delivery
 * tick. An agent who believes a lead was welcomed does not call them, and that
 * is the exact failure this CRM exists to prevent.
 */
export class LogAdapter implements WhatsAppAdapter {
  readonly name = 'log';

  private accept(kind: string, toWaId: string, detail: Record<string, unknown>): SendResult {
    const live = env().NODE_ENV === 'production';
    logger[live ? 'warn' : 'info']('whatsapp send (log provider)', {
      kind,
      to: maskPhone(toWaId),
      sent: !live,
      ...detail,
    });

    if (live) {
      return {
        providerMessageId: null,
        provider: this.name,
        ok: false,
        errorCode: 'whatsapp_not_connected',
        errorMessage: NOT_CONNECTED_MESSAGE,
        raw: { kind, ...detail },
      };
    }

    return {
      providerMessageId: `log.${newToken(12)}`,
      provider: this.name,
      ok: true,
      errorCode: null,
      errorMessage: null,
      raw: { kind, ...detail },
    };
  }

  async sendTemplate(input: TemplateSend): Promise<SendResult> {
    return this.accept('template', input.toWaId, { template: input.templateName, language: input.language });
  }
  async sendText(input: TextSend): Promise<SendResult> {
    return this.accept('text', input.toWaId, { length: input.text.length });
  }
  async sendMedia(input: MediaSend): Promise<SendResult> {
    return this.accept('media', input.toWaId, { mediaKind: input.kind });
  }
  async sendLocation(input: LocationSend): Promise<SendResult> {
    return this.accept('location', input.toWaId, { name: input.name ?? null });
  }
  async sendInteractiveButtons(input: InteractiveButtonsSend): Promise<SendResult> {
    return this.accept('interactive', input.toWaId, { buttons: input.buttons.length });
  }
  async listTemplates() {
    return [];
  }
}
