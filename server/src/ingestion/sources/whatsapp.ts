import { z } from 'zod';
import { parsePhone } from '../../lib/phone.js';
import { cleanText, detectLanguage } from '../parse.js';
import { normalizeLead } from '../normalize.js';
import type { LeadDTO } from '../dto.js';

/**
 * WhatsApp Cloud API inbound webhooks.
 *
 * One envelope can carry `messages[]` (what the person sent), `statuses[]`
 * (delivery ticks for what we sent) and a `referral` block that attributes a
 * click-to-WhatsApp lead back to the ad that produced it.
 */

const referralSchema = z.object({
  source_url: z.string().optional(),
  source_id: z.string().optional(),
  source_type: z.string().optional(),
  headline: z.string().optional(),
  body: z.string().optional(),
  media_type: z.string().optional(),
  ctwa_clid: z.string().optional(),
});

const mediaSchema = z.object({
  id: z.string().optional(),
  mime_type: z.string().optional(),
  sha256: z.string().optional(),
  caption: z.string().optional(),
  filename: z.string().optional(),
});

const messageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.union([z.string(), z.number()]).transform(String),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  button: z.object({ payload: z.string().optional(), text: z.string().optional() }).optional(),
  interactive: z
    .object({
      type: z.string(),
      button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      list_reply: z.object({ id: z.string(), title: z.string(), description: z.string().optional() }).optional(),
    })
    .optional(),
  image: mediaSchema.optional(),
  video: mediaSchema.optional(),
  audio: mediaSchema.optional(),
  document: mediaSchema.optional(),
  sticker: mediaSchema.optional(),
  location: z
    .object({ latitude: z.number(), longitude: z.number(), name: z.string().optional(), address: z.string().optional() })
    .optional(),
  contacts: z.array(z.unknown()).optional(),
  context: z.object({ from: z.string().optional(), id: z.string().optional() }).optional(),
  referral: referralSchema.optional(),
  errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() })).optional(),
});

const statusSchema = z.object({
  id: z.string(),
  status: z.enum(['sent', 'delivered', 'read', 'failed', 'deleted', 'warning']),
  timestamp: z.union([z.string(), z.number()]).transform(String),
  recipient_id: z.string(),
  conversation: z
    .object({ id: z.string().optional(), origin: z.object({ type: z.string().optional() }).optional() })
    .optional(),
  pricing: z.object({ billable: z.boolean().optional(), category: z.string().optional() }).optional(),
  errors: z
    .array(z.object({ code: z.number().optional(), title: z.string().optional(), message: z.string().optional() }))
    .optional(),
});

const valueSchema = z.object({
  messaging_product: z.string().optional(),
  metadata: z.object({ display_phone_number: z.string().optional(), phone_number_id: z.string().optional() }).optional(),
  contacts: z.array(z.object({ profile: z.object({ name: z.string().optional() }).optional(), wa_id: z.string() })).optional(),
  messages: z.array(messageSchema).optional(),
  statuses: z.array(statusSchema).optional(),
  errors: z.array(z.unknown()).optional(),
});

export const whatsappWebhookSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string().optional(),
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })).default([]),
    }),
  ),
});

export type WaMessage = z.infer<typeof messageSchema>;
export type WaStatus = z.infer<typeof statusSchema>;
export type WaReferral = z.infer<typeof referralSchema>;

export type ParsedInboundMessage = {
  providerMessageId: string;
  waId: string;
  phoneE164: string | null;
  profileName: string | null;
  sentAt: Date;
  type: string;
  /** Plain text we can classify: body, caption, button title or list title. */
  text: string | null;
  /** Set when the person tapped a template button or an interactive reply. */
  buttonPayload: string | null;
  buttonText: string | null;
  media: { kind: string; id?: string; mimeType?: string; filename?: string; caption?: string } | null;
  location: { latitude: number; longitude: number; name?: string; address?: string } | null;
  referral: WaReferral | null;
  /** The message we sent that this one replies to. */
  contextMessageId: string | null;
  raw: WaMessage;
};

export type ParsedStatus = {
  providerMessageId: string;
  status: WaStatus['status'];
  at: Date;
  recipientWaId: string;
  errorCode: number | null;
  errorMessage: string | null;
  raw: WaStatus;
};

export type ParsedWebhook = {
  messages: ParsedInboundMessage[];
  statuses: ParsedStatus[];
  phoneNumberId: string | null;
};

const toDate = (timestamp: string): Date => {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
};

/** Parse a whole webhook envelope into messages and delivery statuses. */
export function parseWhatsAppWebhook(payload: unknown): ParsedWebhook {
  const envelope = whatsappWebhookSchema.safeParse(payload);
  const result: ParsedWebhook = { messages: [], statuses: [], phoneNumberId: null };
  if (!envelope.success) return result;

  for (const entry of envelope.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      const value = valueSchema.safeParse(change.value);
      if (!value.success) continue;

      result.phoneNumberId = value.data.metadata?.phone_number_id ?? result.phoneNumberId;
      const profiles = new Map<string, string | null>();
      for (const contact of value.data.contacts ?? []) {
        profiles.set(contact.wa_id, contact.profile?.name ?? null);
      }

      for (const message of value.data.messages ?? []) {
        result.messages.push(parseMessage(message, profiles.get(message.from) ?? null));
      }
      for (const status of value.data.statuses ?? []) {
        const firstError = status.errors?.[0];
        result.statuses.push({
          providerMessageId: status.id,
          status: status.status,
          at: toDate(status.timestamp),
          recipientWaId: status.recipient_id,
          errorCode: firstError?.code ?? null,
          errorMessage: firstError?.message ?? firstError?.title ?? null,
          raw: status,
        });
      }
    }
  }
  return result;
}

function parseMessage(message: WaMessage, profileName: string | null): ParsedInboundMessage {
  const parsedPhone = parsePhone(message.from);

  let text: string | null = null;
  let buttonPayload: string | null = null;
  let buttonText: string | null = null;
  let media: ParsedInboundMessage['media'] = null;

  switch (message.type) {
    case 'text':
      text = cleanText(message.text?.body, 4096);
      break;
    case 'button':
      // Template quick-reply: the payload is the intent we set on the template.
      buttonPayload = cleanText(message.button?.payload, 128);
      buttonText = cleanText(message.button?.text, 128);
      text = buttonText;
      break;
    case 'interactive':
      buttonPayload = cleanText(message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id, 128);
      buttonText = cleanText(message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title, 128);
      text = buttonText;
      break;
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker': {
      const payload = (message as Record<string, unknown>)[message.type] as z.infer<typeof mediaSchema> | undefined;
      media = {
        kind: message.type,
        ...(payload?.id ? { id: payload.id } : {}),
        ...(payload?.mime_type ? { mimeType: payload.mime_type } : {}),
        ...(payload?.filename ? { filename: payload.filename } : {}),
        ...(payload?.caption ? { caption: payload.caption } : {}),
      };
      text = cleanText(payload?.caption, 1024);
      break;
    }
    default:
      text = null;
  }

  return {
    providerMessageId: message.id,
    waId: message.from,
    phoneE164: parsedPhone.e164,
    profileName: cleanText(profileName, 200),
    sentAt: toDate(message.timestamp),
    type: message.type,
    text,
    buttonPayload,
    buttonText,
    media,
    location: message.location
      ? {
          latitude: message.location.latitude,
          longitude: message.location.longitude,
          ...(message.location.name ? { name: message.location.name } : {}),
          ...(message.location.address ? { address: message.location.address } : {}),
        }
      : null,
    referral: message.referral ?? null,
    contextMessageId: message.context?.id ?? null,
    raw: message,
  };
}

/**
 * A brand-new WhatsApp number becomes a contact. The source is `meta_ctwa` when
 * the message carries an ad referral, otherwise `whatsapp_direct`.
 */
export function normalizeWhatsAppLead(message: ParsedInboundMessage): LeadDTO {
  const isCtwa = Boolean(message.referral?.ctwa_clid || message.referral?.source_id);

  return normalizeLead({
    source: isCtwa ? 'meta_ctwa' : 'whatsapp_direct',
    externalId: message.providerMessageId,
    receivedAt: message.sentAt,
    mapped: {
      ...(message.profileName ? { full_name: message.profileName } : {}),
      phone: message.phoneE164 ?? message.waId,
      ...(detectLanguage(message.text, message.profileName)
        ? { language: detectLanguage(message.text, message.profileName) as string }
        : {}),
      ...(message.text ? { notes: message.text } : {}),
    },
    attribution: {
      ...(message.referral?.ctwa_clid ? { ctwaClid: message.referral.ctwa_clid } : {}),
      ...(message.referral?.source_id ? { adId: message.referral.source_id } : {}),
      ...(message.referral?.source_url ? { landingPage: message.referral.source_url } : {}),
      ...(message.referral?.headline ? { adName: message.referral.headline } : {}),
    },
    // The person messaged us first: that is consent to reply on WhatsApp.
    consent: {
      whatsapp: true,
      email: false,
      sms: false,
      text: 'Contact initiated the WhatsApp conversation.',
    },
  });
}
