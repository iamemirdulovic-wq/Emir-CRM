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

/**
 * Development and test provider. It never reaches the network: the message is
 * still written to the conversation, so the whole system can be exercised
 * without a WhatsApp Business account.
 */
export class LogAdapter implements WhatsAppAdapter {
  readonly name = 'log';

  private accept(kind: string, toWaId: string, detail: Record<string, unknown>): SendResult {
    logger.info('whatsapp send (log provider)', { kind, to: maskPhone(toWaId), ...detail });
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
