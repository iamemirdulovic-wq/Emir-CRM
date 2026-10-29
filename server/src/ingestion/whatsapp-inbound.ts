import { execute, isDuplicateKeyError, queryOne, withRetryingTransaction } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { WA_WINDOW_MS } from '../config/constants.js';
import { enqueue } from '../jobs/queue.js';
import { addActivity, ensureConversation, ingestLead } from './ingest.js';
import { normalizeWhatsAppLead, type ParsedInboundMessage, type ParsedStatus } from './sources/whatsapp.js';

export type InboundMessageResult = {
  contactId: string;
  conversationId: string;
  messageId: string;
  isNewContact: boolean;
  duplicate: boolean;
};

/**
 * Record one inbound WhatsApp message.
 *
 * A brand-new number becomes a contact through the normal ingestion path, so it
 * gets an opportunity, tags, consent and Workflow A just like any other lead.
 * The unique key on (provider, provider_message_id) makes a redelivered webhook
 * a no-op.
 */
export async function handleInboundMessage(message: ParsedInboundMessage): Promise<InboundMessageResult> {
  // Meta redelivers webhooks aggressively; check before doing any work.
  const seen = await queryOne<{ id: string; contact_id: string; conversation_id: string }>(
    'SELECT id, contact_id, conversation_id FROM messages WHERE provider = ? AND provider_message_id = ?',
    ['whatsapp_cloud', message.providerMessageId],
  );
  if (seen) {
    logger.debug('inbound whatsapp message already recorded', { providerMessageId: message.providerMessageId });
    return {
      contactId: seen.contact_id,
      conversationId: seen.conversation_id,
      messageId: seen.id,
      isNewContact: false,
      duplicate: true,
    };
  }

  const lead = normalizeWhatsAppLead(message);
  const ingested = await ingestLead(lead);

  return withRetryingTransaction(async (tx) => {
    const conversationId = await ensureConversation(tx, ingested.contactId, null);

    /*
     * Take the exclusive locks up front, contact before conversation, and keep
     * that order everywhere.
     *
     * Without this, twenty webhooks for one number deadlock: inserting a
     * message takes a shared foreign-key lock on both parent rows, and the
     * updates below then need those same rows exclusively. Every transaction
     * ends up holding a shared lock everyone else needs to upgrade.
     */
    await queryOne('SELECT id FROM contacts WHERE id = ? FOR UPDATE', [ingested.contactId], tx);
    await queryOne('SELECT id FROM conversations WHERE id = ? FOR UPDATE', [conversationId], tx);

    const messageId = newId();

    try {
      await execute(
        `INSERT INTO messages
           (id, conversation_id, contact_id, channel, direction, provider, provider_message_id,
            body, media, payload, status, sent_at)
         VALUES (?, ?, ?, 'whatsapp', 'inbound', 'whatsapp_cloud', ?, ?, ?, ?, 'received', ?)`,
        [
          messageId,
          conversationId,
          ingested.contactId,
          message.providerMessageId,
          message.text,
          message.media ? JSON.stringify(message.media) : null,
          JSON.stringify({
            type: message.type,
            buttonPayload: message.buttonPayload,
            buttonText: message.buttonText,
            location: message.location,
            referral: message.referral,
            contextMessageId: message.contextMessageId,
          }),
          message.sentAt,
        ],
        tx,
      );
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const existing = await queryOne<{ id: string }>(
        'SELECT id FROM messages WHERE provider = ? AND provider_message_id = ?',
        ['whatsapp_cloud', message.providerMessageId],
        tx,
      );
      return {
        contactId: ingested.contactId,
        conversationId,
        messageId: existing?.id ?? messageId,
        isNewContact: false,
        duplicate: true,
      };
    }

    // An inbound message opens the 24-hour customer service window and stops
    // any follow-up sequence. Both are read by the guards before every send.
    const windowExpiry = new Date(message.sentAt.getTime() + WA_WINDOW_MS);
    await execute('UPDATE contacts SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, ?), ?) WHERE id = ?', [
      message.sentAt,
      message.sentAt,
      ingested.contactId,
    ], tx);
    await execute(
      `UPDATE conversations
          SET last_message_at = GREATEST(COALESCE(last_message_at, ?), ?),
              last_inbound_at = GREATEST(COALESCE(last_inbound_at, ?), ?),
              wa_window_expires_at = GREATEST(COALESCE(wa_window_expires_at, ?), ?),
              unread_count = unread_count + 1,
              status = 'open'
        WHERE id = ?`,
      [message.sentAt, message.sentAt, message.sentAt, message.sentAt, windowExpiry, windowExpiry, conversationId],
      tx,
    );

    await addActivity(tx, {
      contactId: ingested.contactId,
      opportunityId: ingested.opportunityId,
      type: 'message.inbound',
      title: 'Inbound WhatsApp message',
      body: message.text ?? `(${message.type})`,
      meta: { providerMessageId: message.providerMessageId, buttonPayload: message.buttonPayload },
    });

    // Workflow C decides what to do with it.
    await enqueue(
      'workflow.c.route_inbound',
      {
        contactId: ingested.contactId,
        conversationId,
        messageId,
        opportunityId: ingested.opportunityId,
        text: message.text,
        buttonPayload: message.buttonPayload,
      },
      { priority: 1, dedupeKey: `wf-c:${message.providerMessageId}`, contactId: ingested.contactId },
      tx,
    );

    return {
      contactId: ingested.contactId,
      conversationId,
      messageId,
      isNewContact: ingested.isNewContact,
      duplicate: false,
    };
  });
}

const STATUS_RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4, received: 5 };

/**
 * Apply a delivery tick. Statuses can arrive out of order, so a status only
 * moves the message forward, never backwards.
 */
export async function handleStatusUpdate(status: ParsedStatus): Promise<boolean> {
  const message = await queryOne<{ id: string; status: string; contact_id: string }>(
    'SELECT id, status, contact_id FROM messages WHERE provider = ? AND provider_message_id = ?',
    ['whatsapp_cloud', status.providerMessageId],
  );
  if (!message) {
    logger.debug('status for an unknown message', { providerMessageId: status.providerMessageId });
    return false;
  }

  const next = status.status === 'deleted' || status.status === 'warning' ? null : status.status;
  if (!next) return false;
  if ((STATUS_RANK[next] ?? 0) <= (STATUS_RANK[message.status] ?? 0) && next !== 'failed') return false;

  await execute(
    `UPDATE messages
        SET status = ?,
            delivered_at = CASE WHEN ? IN ('delivered','read') THEN COALESCE(delivered_at, ?) ELSE delivered_at END,
            read_at = CASE WHEN ? = 'read' THEN COALESCE(read_at, ?) ELSE read_at END,
            error_code = ?, error_message = ?
      WHERE id = ?`,
    [
      next,
      next,
      status.at,
      next,
      status.at,
      status.errorCode === null ? null : String(status.errorCode),
      status.errorMessage,
      message.id,
    ],
  );

  if (next === 'failed') {
    logger.warn('whatsapp message failed', {
      messageId: message.id,
      errorCode: status.errorCode,
      errorMessage: status.errorMessage,
    });
    // Marketing-limit failures fall back to email; the workflow decides.
    await enqueue(
      'workflow.b.step',
      { contactId: message.contact_id, reason: 'whatsapp_send_failed', errorCode: status.errorCode, messageId: message.id },
      { priority: 2, dedupeKey: `wa-fail:${status.providerMessageId}`, contactId: message.contact_id },
    );
  }
  return true;
}
