import type { TemplateComponent } from '../templates/types.js';

/**
 * One interface for every WhatsApp provider. Cloud API is the default; Wati and
 * Twilio exist so a brokerage already on one of them can migrate without a
 * rewrite, and `log` keeps development and tests off the wire entirely.
 */

export type SendResult = {
  providerMessageId: string | null;
  provider: string;
  /** Meta's error code, when the provider reports one. */
  errorCode: string | null;
  errorMessage: string | null;
  ok: boolean;
  raw: unknown;
};

export type TemplateSend = {
  toWaId: string;
  templateName: string;
  language: string;
  /** Body variables, in order. */
  bodyParams: string[];
  header?:
    | { kind: 'text'; text: string }
    | { kind: 'image' | 'video' | 'document'; link: string; filename?: string }
    | undefined;
  /** Dynamic quick-reply payloads, indexed by button position. */
  buttonPayloads?: string[] | undefined;
};

export type TextSend = {
  toWaId: string;
  text: string;
  previewUrl?: boolean;
};

export type MediaSend = {
  toWaId: string;
  kind: 'image' | 'document' | 'video' | 'audio';
  link: string;
  caption?: string | undefined;
  filename?: string | undefined;
};

export type LocationSend = {
  toWaId: string;
  latitude: number;
  longitude: number;
  name?: string | undefined;
  address?: string | undefined;
};

export type InteractiveButtonsSend = {
  toWaId: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
  header?: string | undefined;
  footer?: string | undefined;
};

export interface WhatsAppAdapter {
  readonly name: string;
  sendTemplate(input: TemplateSend): Promise<SendResult>;
  sendText(input: TextSend): Promise<SendResult>;
  sendMedia(input: MediaSend): Promise<SendResult>;
  sendLocation(input: LocationSend): Promise<SendResult>;
  sendInteractiveButtons(input: InteractiveButtonsSend): Promise<SendResult>;
  /** Pull template statuses so we can alert when one is paused or rejected. */
  listTemplates(): Promise<Array<{ name: string; language: string; status: string; category: string; components: TemplateComponent[]; id?: string; rejectedReason?: string | null; qualityScore?: string | null }>>;
}

export function failure(provider: string, message: string, code: string | null = null, raw: unknown = null): SendResult {
  return { providerMessageId: null, provider, ok: false, errorCode: code, errorMessage: message, raw };
}
