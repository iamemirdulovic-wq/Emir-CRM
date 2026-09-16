import { execute, queryOne, withRetryingTransaction } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { maskPhone } from '../lib/redact.js';
import { notFound } from '../lib/errors.js';
import { BOT_PAUSE_AFTER_HUMAN_MS, WA_WINDOW_MS } from '../config/constants.js';
import { evaluateGuards, isRetryable, type Channel, type GuardContext, type GuardDecision } from '../workflows/guards.js';
import { whatsapp } from './whatsapp/index.js';
import type { SendResult } from './whatsapp/adapter.js';
import { ensureConversation, addActivity } from '../ingestion/ingest.js';

/**
 * The single door every outbound message goes through. Nothing else in the
 * codebase calls a provider directly, so the guards cannot be bypassed.
 */

export type SendOutcome =
  | { sent: true; messageId: string; providerMessageId: string | null }
  | { sent: false; blocked: GuardDecision; retryable: boolean }
  | { sent: false; failed: true; errorCode: string | null; errorMessage: string | null; messageId: string };

type ContactRow = {
  id: string;
  wa_id: string | null;
  phone_e164: string | null;
  email: string | null;
  full_name: string | null;
  language: string;
  dnc: number;
  bot_paused_until: Date | null;
  last_human_outbound_at: Date | null;
};

/** Load everything the guards need for this contact and channel. */
export async function loadGuardContext(contactId: string, channel: Channel, now = new Date()): Promise<{
  context: GuardContext;
  contact: ContactRow;
  conversationId: string | null;
}> {
  const contact = await queryOne<ContactRow>(
    `SELECT id, wa_id, phone_e164, email, full_name, language, dnc, bot_paused_until, last_human_outbound_at
       FROM contacts WHERE id = ?`,
    [contactId],
  );
  if (!contact) throw notFound('Contact not found');

  const conversation = await queryOne<{ id: string; wa_window_expires_at: Date | null }>(
    'SELECT id, wa_window_expires_at FROM conversations WHERE contact_id = ?',
    [contactId],
  );

  // Consent is the most recent decision per channel, so a later opt-out wins.
  const consentRow = await queryOne<{ whatsapp: number; email: number; sms: number }>(
    `SELECT
       COALESCE(MAX(CASE WHEN channel IN ('whatsapp','all') THEN granted END), 0) AS whatsapp,
       COALESCE(MAX(CASE WHEN channel IN ('email','all') THEN granted END), 0) AS email,
       COALESCE(MAX(CASE WHEN channel IN ('sms','all') THEN granted END), 0) AS sms
     FROM consents c
     WHERE contact_id = ?
       AND created_at = (SELECT MAX(c2.created_at) FROM consents c2 WHERE c2.contact_id = c.contact_id AND c2.channel = c.channel)`,
    [contactId],
  );

  const identifiers = [contact.phone_e164, contact.wa_id, contact.email].filter(Boolean) as string[];
  const suppressed = identifiers.length
    ? Boolean(
        await queryOne<{ n: number }>(
          `SELECT 1 AS n FROM suppressions WHERE value IN (${identifiers.map(() => '?').join(',')}) LIMIT 1`,
          identifiers,
        ),
      )
    : false;

  const automated = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages
      WHERE contact_id = ? AND direction = 'outbound' AND is_automated = 1
        AND status <> 'failed'
        AND created_at > DATE_SUB(NOW(3), INTERVAL 24 HOUR)`,
    [contactId],
  );

  return {
    contact,
    conversationId: conversation?.id ?? null,
    context: {
      dnc: contact.dnc === 1,
      suppressed,
      consent: {
        whatsapp: Number(consentRow?.whatsapp ?? 0) === 1,
        email: Number(consentRow?.email ?? 0) === 1,
        sms: Number(consentRow?.sms ?? 0) === 1,
      },
      automatedMessagesLast24h: Number(automated?.n ?? 0),
      botPausedUntil: contact.bot_paused_until,
      lastHumanOutboundAt: contact.last_human_outbound_at,
      waWindowExpiresAt: conversation?.wa_window_expires_at ?? null,
      now,
    },
  };
}

export type WhatsAppSendRequest = {
  contactId: string;
  automated: boolean;
  /** The agent sending by hand, or null for automation. */
  userId?: string | null;
  bypassQuietHours?: boolean;
  /** Recorded on the message so the inbox can show what was sent. */
  bodyPreview?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  opportunityId?: string | null;
} & (
  | { kind: 'template'; templateName: string; templateLanguage: string; bodyParams: string[]; header?: Parameters<ReturnType<typeof whatsapp>['sendTemplate']>[0]['header']; buttonPayloads?: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'media'; mediaKind: 'image' | 'document' | 'video' | 'audio'; link: string; caption?: string; filename?: string }
  | { kind: 'location'; latitude: number; longitude: number; name?: string; address?: string }
  | { kind: 'buttons'; body: string; buttons: Array<{ id: string; title: string }>; header?: string; footer?: string }
);

/** Send on WhatsApp, subject to every guard. */
export async function sendWhatsApp(request: WhatsAppSendRequest): Promise<SendOutcome> {
  const { context, contact, conversationId } = await loadGuardContext(request.contactId, 'whatsapp');

  const decision = evaluateGuards(context, {
    channel: 'whatsapp',
    automated: request.automated,
    isTemplate: request.kind === 'template',
    ...(request.bypassQuietHours === undefined ? {} : { bypassQuietHours: request.bypassQuietHours }),
  });

  if (!decision.allowed) {
    logger.info('whatsapp send blocked by a guard', {
      contactId: request.contactId,
      reason: decision.reason,
      automated: request.automated,
    });
    return { sent: false, blocked: decision, retryable: isRetryable(decision) };
  }

  const toWaId = contact.wa_id ?? contact.phone_e164?.replace(/^\+/, '') ?? null;
  if (!toWaId) {
    return {
      sent: false,
      blocked: { allowed: false, reason: 'no_consent', message: 'Contact has no WhatsApp number' },
      retryable: false,
    };
  }

  const adapter = whatsapp();
  let result: SendResult;
  let preview: string;

  switch (request.kind) {
    case 'template':
      result = await adapter.sendTemplate({
        toWaId,
        templateName: request.templateName,
        language: request.templateLanguage,
        bodyParams: request.bodyParams,
        header: request.header,
        buttonPayloads: request.buttonPayloads,
      });
      preview = request.bodyPreview ?? `[template ${request.templateName}]`;
      break;
    case 'text':
      result = await adapter.sendText({ toWaId, text: request.text });
      preview = request.text;
      break;
    case 'media':
      result = await adapter.sendMedia({
        toWaId,
        kind: request.mediaKind,
        link: request.link,
        caption: request.caption,
        filename: request.filename,
      });
      preview = request.caption ?? `[${request.mediaKind}]`;
      break;
    case 'location':
      result = await adapter.sendLocation({
        toWaId,
        latitude: request.latitude,
        longitude: request.longitude,
        name: request.name,
        address: request.address,
      });
      preview = request.name ? `[location] ${request.name}` : '[location]';
      break;
    case 'buttons':
      result = await adapter.sendInteractiveButtons({
        toWaId,
        body: request.body,
        buttons: request.buttons,
        header: request.header,
        footer: request.footer,
      });
      preview = request.body;
      break;
  }

  return recordOutbound({
    contactId: request.contactId,
    conversationId,
    channel: 'whatsapp',
    provider: result.provider,
    providerMessageId: result.providerMessageId,
    userId: request.userId ?? null,
    isAutomated: request.automated,
    templateName: request.kind === 'template' ? request.templateName : null,
    templateLanguage: request.kind === 'template' ? request.templateLanguage : null,
    body: preview,
    payload: { kind: request.kind },
    ok: result.ok,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    opportunityId: request.opportunityId ?? null,
    toLabel: maskPhone(toWaId),
  });
}

export type RecordOutboundInput = {
  contactId: string;
  conversationId: string | null;
  channel: Channel | 'note' | 'system';
  provider: string | null;
  providerMessageId: string | null;
  userId: string | null;
  isAutomated: boolean;
  templateName: string | null;
  templateLanguage: string | null;
  subject?: string | null;
  body: string | null;
  payload?: Record<string, unknown> | null;
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  opportunityId?: string | null;
  toLabel?: string;
};

/**
 * Write the message to the thread and move the conversation's clocks.
 *
 * An agent's manual message pauses the bot for 24 hours; that pause is written
 * here so it applies no matter which surface the agent used.
 */
export async function recordOutbound(input: RecordOutboundInput): Promise<SendOutcome> {
  return withRetryingTransaction(async (tx) => {
    const conversationId = input.conversationId ?? (await ensureConversation(tx, input.contactId, input.userId));

    // Lock contact then conversation, the same order used everywhere else.
    await queryOne('SELECT id FROM contacts WHERE id = ? FOR UPDATE', [input.contactId], tx);
    await queryOne('SELECT id FROM conversations WHERE id = ? FOR UPDATE', [conversationId], tx);

    const messageId = newId();
    const now = new Date();

    await execute(
      `INSERT INTO messages
         (id, conversation_id, contact_id, channel, direction, provider, provider_message_id, user_id,
          is_automated, template_name, template_language, subject, body, payload, status,
          error_code, error_message, sent_at)
       VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        messageId,
        conversationId,
        input.contactId,
        input.channel,
        input.provider,
        input.providerMessageId,
        input.userId,
        input.isAutomated ? 1 : 0,
        input.templateName,
        input.templateLanguage,
        input.subject ?? null,
        input.body,
        input.payload ? JSON.stringify(input.payload) : null,
        input.ok ? 'sent' : 'failed',
        input.errorCode,
        input.errorMessage,
        input.ok ? now : null,
      ],
      tx,
    );

    if (input.ok) {
      const humanPause = !input.isAutomated && input.userId ? new Date(now.getTime() + BOT_PAUSE_AFTER_HUMAN_MS) : null;
      await execute(
        `UPDATE contacts
            SET last_outbound_at = ?,
                last_human_outbound_at = COALESCE(?, last_human_outbound_at),
                bot_paused_until = COALESCE(?, bot_paused_until)
          WHERE id = ?`,
        [now, humanPause ? now : null, humanPause, input.contactId],
        tx,
      );
      await execute(
        `UPDATE conversations SET last_message_at = ?, last_outbound_at = ?, status = 'open' WHERE id = ?`,
        [now, now, conversationId],
        tx,
      );

      await addActivity(tx, {
        contactId: input.contactId,
        opportunityId: input.opportunityId ?? null,
        userId: input.userId,
        type: input.isAutomated ? 'message.automated' : 'message.outbound',
        title: input.templateName
          ? `Sent template ${input.templateName}`
          : `Sent ${input.channel} message${input.toLabel ? ` to ${input.toLabel}` : ''}`,
        body: input.body,
        meta: { providerMessageId: input.providerMessageId, automated: input.isAutomated },
      });

      return { sent: true, messageId, providerMessageId: input.providerMessageId };
    }

    logger.warn('outbound message failed at the provider', {
      contactId: input.contactId,
      channel: input.channel,
      errorCode: input.errorCode,
    });
    return {
      sent: false,
      failed: true,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      messageId,
    };
  });
}

/** Refresh the WhatsApp window after an inbound message. */
export async function openWhatsAppWindow(contactId: string, at: Date = new Date()): Promise<void> {
  await execute(
    `UPDATE conversations SET wa_window_expires_at = ?, last_inbound_at = ? WHERE contact_id = ?`,
    [new Date(at.getTime() + WA_WINDOW_MS), at, contactId],
  );
}
