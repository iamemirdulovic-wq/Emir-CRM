import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { env } from '../../config/env.js';
import { execute, queryOne, withRetryingTransaction } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { logger, errorContext } from '../../lib/logger.js';
import { normalizeEmail, parseReplyAddress } from '../../lib/email.js';
import { addActivity } from '../../ingestion/ingest.js';
import { enqueue } from '../../jobs/queue.js';
import { stopSequence } from '../../workflows/workflow-b.js';

/**
 * Inbound email via an IMAP poll.
 *
 * A reply is matched to its thread by the `reply+{conversation_id}@domain`
 * address we set as Reply-To, falling back to the sender's address.
 */

export type PollResult = { scanned: number; matched: number; unmatched: number };

export async function pollInbox(): Promise<PollResult> {
  const cfg = env();
  if (!cfg.IMAP_HOST || !cfg.IMAP_USER || !cfg.IMAP_PASSWORD) {
    return { scanned: 0, matched: 0, unmatched: 0 };
  }

  const client = new ImapFlow({
    host: cfg.IMAP_HOST,
    port: cfg.IMAP_PORT,
    secure: cfg.IMAP_SECURE,
    auth: { user: cfg.IMAP_USER, pass: cfg.IMAP_PASSWORD },
    logger: false,
  });

  let scanned = 0;
  let matched = 0;
  let unmatched = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const unseen = await client.search({ seen: false });
      const uids = Array.isArray(unseen) ? unseen.slice(0, 100) : [];

      for (const uid of uids) {
        scanned += 1;
        try {
          const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!message || typeof message === 'boolean' || !message.source) continue;

          const parsed = await simpleParser(message.source);
          const handled = await storeInboundEmail({
            messageId: parsed.messageId ?? `imap-${uid}`,
            fromAddress: normalizeEmail(parsed.from?.value?.[0]?.address ?? null),
            fromName: parsed.from?.value?.[0]?.name ?? null,
            toAddresses: (parsed.to && 'value' in parsed.to ? parsed.to.value : []).map((a) => a.address ?? ''),
            subject: parsed.subject ?? null,
            text: parsed.text ?? stripHtml(parsed.html || ''),
            receivedAt: parsed.date ?? new Date(),
          });

          if (handled) matched += 1;
          else unmatched += 1;

          // Mark seen either way, so one unmatchable message cannot wedge the poll.
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        } catch (err) {
          logger.warn('failed to process an inbound email', errorContext(err));
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    logger.error('IMAP poll failed', errorContext(err));
  } finally {
    await client.logout().catch(() => undefined);
  }

  if (scanned > 0) logger.info('imap poll complete', { scanned, matched, unmatched });
  return { scanned, matched, unmatched };
}

type InboundEmail = {
  messageId: string;
  fromAddress: string | null;
  fromName: string | null;
  toAddresses: string[];
  subject: string | null;
  text: string;
  receivedAt: Date;
};

/** Returns true when the email was matched to a contact. */
export async function storeInboundEmail(email: InboundEmail): Promise<boolean> {
  // Already stored? IMAP re-delivers on reconnect.
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM messages WHERE provider = ? AND provider_message_id = ?',
    ['imap', email.messageId],
  );
  if (existing) return true;

  // Prefer the Reply-To thread id; fall back to the sender's address.
  let conversationId: string | null = null;
  for (const to of email.toAddresses) {
    const fromReply = parseReplyAddress(to);
    if (fromReply) {
      const row = await queryOne<{ id: string }>('SELECT id FROM conversations WHERE id = ?', [fromReply]);
      if (row) {
        conversationId = row.id;
        break;
      }
    }
  }

  let contactId: string | null = null;
  if (conversationId) {
    const row = await queryOne<{ contact_id: string }>('SELECT contact_id FROM conversations WHERE id = ?', [conversationId]);
    contactId = row?.contact_id ?? null;
  } else if (email.fromAddress) {
    const row = await queryOne<{ id: string }>(
      'SELECT id FROM contacts WHERE email = ? AND merged_into_id IS NULL ORDER BY created_at ASC LIMIT 1',
      [email.fromAddress],
    );
    contactId = row?.id ?? null;
    if (contactId) {
      const conversation = await queryOne<{ id: string }>('SELECT id FROM conversations WHERE contact_id = ?', [contactId]);
      conversationId = conversation?.id ?? null;
    }
  }

  if (!contactId || !conversationId) {
    logger.info('inbound email did not match a contact', { subject: email.subject?.slice(0, 80) ?? null });
    return false;
  }

  const finalContactId = contactId;
  const finalConversationId = conversationId;

  await withRetryingTransaction(async (tx) => {
    // Lock contact then conversation, the order used everywhere else.
    await queryOne('SELECT id FROM contacts WHERE id = ? FOR UPDATE', [finalContactId], tx);
    await queryOne('SELECT id FROM conversations WHERE id = ? FOR UPDATE', [finalConversationId], tx);

    const messageId = newId();
    await execute(
      `INSERT INTO messages (id, conversation_id, contact_id, channel, direction, provider, provider_message_id,
                             subject, body, status, sent_at)
       VALUES (?, ?, ?, 'email', 'inbound', 'imap', ?, ?, ?, 'received', ?)`,
      [
        messageId,
        finalConversationId,
        finalContactId,
        email.messageId,
        email.subject,
        email.text.slice(0, 60000),
        email.receivedAt,
      ],
      tx,
    );

    await execute('UPDATE contacts SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, ?), ?) WHERE id = ?', [
      email.receivedAt,
      email.receivedAt,
      finalContactId,
    ], tx);
    await execute(
      `UPDATE conversations SET last_message_at = ?, last_inbound_at = ?, unread_count = unread_count + 1, status = 'open'
        WHERE id = ?`,
      [email.receivedAt, email.receivedAt, finalConversationId],
      tx,
    );

    await addActivity(tx, {
      contactId: finalContactId,
      type: 'message.inbound',
      title: `Email reply: ${email.subject ?? '(no subject)'}`,
      body: email.text.slice(0, 2000),
      meta: { messageId: email.messageId, from: email.fromAddress },
    });
  });

  // A reply on any channel stops the follow-up sequence.
  await stopSequence(finalContactId, 'lead_replied_by_email');

  await enqueue(
    'push.send',
    {
      audience: 'managers',
      title: 'Email reply received',
      body: `${email.fromName ?? email.fromAddress ?? 'A lead'}: ${(email.subject ?? '').slice(0, 80)}`,
      link: `/inbox/${finalConversationId}`,
    },
    { priority: 3, dedupeKey: `email-reply:${email.messageId}`, contactId: finalContactId },
  );

  return true;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
