import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { actorFrom, blockUntilPasswordChanged, currentUser, requireAuth } from '../middleware/auth.js';
import { ownerPredicate, visibleUserIds } from '../../auth/scope.js';
import { isManagerOrAbove, type Role } from '../../auth/rbac.js';
import { execute, query, queryOne } from '../../db/client.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { REPLY_LOCK_MS } from '../../config/constants.js';
import { assertCanViewContact } from '../../services/contacts.js';
import { sendWhatsApp } from '../../messaging/send.js';
import { sendEmail } from '../../messaging/email/send.js';
import { isTemplateApproved } from '../../messaging/templates/sync.js';
import { writeAudit } from '../../audit/audit.js';
import { addClient, publish, removeClient } from '../../realtime/hub.js';

export const inboxRouter = Router();
inboxRouter.use(requireAuth, blockUntilPasswordChanged);

const listSchema = z.object({
  filter: z.enum(['mine', 'unassigned', 'all']).default('mine'),
  channel: z.enum(['whatsapp', 'email', 'sms', 'any']).default('any'),
  unread: z.enum(['0', '1']).optional(),
  stage: z.string().max(48).optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Thread list. Filters: Mine, Unassigned, All (manager+), channel, unread, stage. */
inboxRouter.get(
  '/conversations',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const params = listSchema.parse(req.query);
    const visible = await visibleUserIds(user);

    if (params.filter === 'all' && !isManagerOrAbove(user.role)) {
      throw forbidden('Only managers and above can see every conversation');
    }

    const where: string[] = [];
    const args: Array<string | number> = [];

    if (params.filter === 'mine') {
      where.push('cv.assigned_user_id = ?');
      args.push(user.id);
    } else if (params.filter === 'unassigned') {
      where.push('cv.assigned_user_id IS NULL');
    } else {
      // "All" still respects the viewer's data scope.
      const scope = ownerPredicate('cv.assigned_user_id', visible);
      where.push(visible === null ? '1=1' : `(${scope.sql} OR cv.assigned_user_id IS NULL)`);
      args.push(...scope.params);
    }

    if (params.unread === '1') where.push('cv.unread_count > 0');
    if (params.channel !== 'any') {
      where.push('EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = cv.id AND m.channel = ?)');
      args.push(params.channel);
    }
    if (params.stage) {
      where.push('EXISTS (SELECT 1 FROM opportunities o WHERE o.contact_id = cv.contact_id AND o.stage_key = ?)');
      args.push(params.stage);
    }
    if (params.search) {
      where.push('(c.full_name LIKE ? OR c.phone_e164 LIKE ? OR c.email LIKE ?)');
      const like = `%${params.search}%`;
      args.push(like, like, like);
    }

    const clause = where.length ? where.join(' AND ') : '1=1';
    const offset = (params.page - 1) * params.pageSize;

    const items = await query(
      `SELECT cv.id, cv.contact_id, cv.assigned_user_id, cv.status, cv.unread_count,
              cv.last_message_at, cv.last_inbound_at, cv.wa_window_expires_at,
              cv.reply_lock_user_id, cv.reply_lock_expires_at,
              c.full_name, c.phone_e164, c.email, c.language, c.lead_score, c.dnc,
              u.name AS assignee_name,
              (SELECT m.body FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
              (SELECT m.channel FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC LIMIT 1) AS last_channel,
              (SELECT m.direction FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC LIMIT 1) AS last_direction,
              (SELECT o.stage_key FROM opportunities o WHERE o.contact_id = cv.contact_id ORDER BY o.created_at DESC LIMIT 1) AS stage_key
         FROM conversations cv
         JOIN contacts c ON c.id = cv.contact_id
         LEFT JOIN users u ON u.id = cv.assigned_user_id
        WHERE ${clause}
        ORDER BY cv.last_message_at IS NULL, cv.last_message_at DESC
        LIMIT ${params.pageSize} OFFSET ${offset}`,
      args,
    );

    const total = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM conversations cv JOIN contacts c ON c.id = cv.contact_id WHERE ${clause}`,
      args,
    );

    res.json({ items, page: params.page, pageSize: params.pageSize, total: Number(total?.n ?? 0) });
  }),
);

/** One thread: every channel in one timeline. */
inboxRouter.get(
  '/conversations/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const conversationId = String(req.params.id);

    const conversation = await queryOne<{
      id: string;
      contact_id: string;
      assigned_user_id: string | null;
      wa_window_expires_at: Date | null;
      reply_lock_user_id: string | null;
      reply_lock_expires_at: Date | null;
      unread_count: number;
      status: string;
      full_name: string | null;
      phone_e164: string | null;
      email: string | null;
      language: string | null;
      lead_score: number;
      dnc: number;
      assignee_name: string | null;
    }>(
      `SELECT cv.id, cv.contact_id, cv.assigned_user_id, cv.wa_window_expires_at, cv.reply_lock_user_id,
              cv.reply_lock_expires_at, cv.unread_count, cv.status,
              c.full_name, c.phone_e164, c.email, c.language, c.lead_score, c.dnc,
              u.name AS assignee_name
         FROM conversations cv
         JOIN contacts c ON c.id = cv.contact_id
         LEFT JOIN users u ON u.id = cv.assigned_user_id
        WHERE cv.id = ?`,
      [conversationId],
    );
    if (!conversation) throw notFound('Conversation not found');
    await assertCanViewContact(conversation.contact_id, await visibleUserIds(user));

    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 200);

    const messages = await query(
      `SELECT m.id, m.channel, m.direction, m.provider, m.provider_message_id, m.user_id, m.is_automated,
              m.template_name, m.template_language, m.subject, m.body, m.media, m.payload, m.status,
              m.error_code, m.error_message, m.sent_at, m.delivered_at, m.read_at, m.created_at,
              u.name AS user_name
         FROM messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.conversation_id = ? ${before ? 'AND m.created_at < ?' : ''}
        ORDER BY m.created_at DESC
        LIMIT ${limit}`,
      before ? [conversationId, new Date(before)] : [conversationId],
    );

    // System events belong in the same timeline as the messages.
    const events = await query(
      `SELECT id, type, title, body, created_at, user_id FROM activities
        WHERE contact_id = ? AND type NOT IN ('message.inbound','message.outbound','message.automated')
        ORDER BY created_at DESC LIMIT 50`,
      [conversation.contact_id],
    );

    const now = Date.now();
    const windowOpen = Boolean(conversation.wa_window_expires_at && conversation.wa_window_expires_at.getTime() > now);
    const lockedBy =
      conversation.reply_lock_expires_at && conversation.reply_lock_expires_at.getTime() > now
        ? conversation.reply_lock_user_id
        : null;

    res.json({
      conversation: {
        ...conversation,
        whatsappWindowOpen: windowOpen,
        whatsappWindowExpiresAt: conversation.wa_window_expires_at,
        // While the window is closed the composer only allows approved templates.
        composerMode: windowOpen ? 'free_form' : 'template_only',
        replyLock: lockedBy && lockedBy !== user.id ? { userId: lockedBy, expiresAt: conversation.reply_lock_expires_at } : null,
      },
      messages: messages.reverse(),
      events,
    });
  }),
);

inboxRouter.post(
  '/conversations/:id/read',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const conversationId = String(req.params.id);
    const conversation = await requireConversation(conversationId, user);

    await execute('UPDATE conversations SET unread_count = 0 WHERE id = ?', [conversationId]);
    publish({ type: 'conversation.updated', payload: { conversationId, contactId: conversation.contact_id, unread: 0 } });
    res.json({ ok: true });
  }),
);

/**
 * Collision guard: "X is replying…" with a 90-second soft lock. It is advisory —
 * it warns the second agent rather than blocking them.
 */
inboxRouter.post(
  '/conversations/:id/typing',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const conversationId = String(req.params.id);
    const conversation = await requireConversation(conversationId, user);

    await execute(
      `UPDATE conversations
          SET reply_lock_user_id = ?, reply_lock_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND)
        WHERE id = ? AND (reply_lock_expires_at IS NULL OR reply_lock_expires_at <= NOW(3) OR reply_lock_user_id = ?)`,
      [user.id, Math.floor(REPLY_LOCK_MS / 1000), conversationId, user.id],
    );

    publish({
      type: 'typing',
      payload: { conversationId, contactId: conversation.contact_id, userId: user.id, userName: user.name },
    });
    res.json({ ok: true });
  }),
);

const sendSchema = z.discriminatedUnion('channel', [
  z.object({
    channel: z.literal('whatsapp'),
    kind: z.enum(['text', 'template']).default('text'),
    text: z.string().max(4000).optional(),
    templateName: z.string().max(120).optional(),
    templateLanguage: z.string().max(16).optional(),
    bodyParams: z.array(z.string().max(500)).max(20).optional(),
  }),
  z.object({
    channel: z.literal('email'),
    subject: z.string().min(1).max(500),
    text: z.string().min(1).max(50000),
  }),
  z.object({
    channel: z.literal('note'),
    text: z.string().min(1).max(10000),
  }),
]);

inboxRouter.post(
  '/conversations/:id/send',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const conversationId = String(req.params.id);
    const conversation = await requireConversation(conversationId, user);
    const body = sendSchema.parse(req.body);

    const opportunity = await queryOne<{ id: string }>(
      'SELECT id FROM opportunities WHERE contact_id = ? ORDER BY created_at DESC LIMIT 1',
      [conversation.contact_id],
    );

    if (body.channel === 'note') {
      const id = newId();
      await execute(
        `INSERT INTO messages (id, conversation_id, contact_id, channel, direction, user_id, body, status, sent_at)
         VALUES (?, ?, ?, 'note', 'outbound', ?, ?, 'sent', NOW(3))`,
        [id, conversationId, conversation.contact_id, user.id, body.text],
      );
      publish({
        type: 'message.created',
        payload: { conversationId, contactId: conversation.contact_id, messageId: id, channel: 'note' },
      });
      res.status(201).json({ messageId: id, channel: 'note' });
      return;
    }

    if (body.channel === 'email') {
      const outcome = await sendEmail({
        contactId: conversation.contact_id,
        opportunityId: opportunity?.id ?? null,
        automated: false,
        userId: user.id,
        subject: body.subject,
        text: body.text,
      });
      await auditSend(req, conversation.contact_id, 'email', outcome);
      publish({
        type: 'message.created',
        payload: { conversationId, contactId: conversation.contact_id, channel: 'email' },
      });
      res.status(outcomeStatus(outcome)).json(outcome);
      return;
    }

    // WhatsApp: free-form inside the window, approved templates outside it.
    if (body.kind === 'template') {
      if (!body.templateName) throw badRequest('templateName is required when sending a template');
      const language = body.templateLanguage ?? 'en';
      if (!(await isTemplateApproved(body.templateName, language))) {
        throw badRequest(`Template "${body.templateName}" (${language}) is not approved for sending`);
      }
      const outcome = await sendWhatsApp({
        kind: 'template',
        contactId: conversation.contact_id,
        opportunityId: opportunity?.id ?? null,
        automated: false,
        userId: user.id,
        templateName: body.templateName,
        templateLanguage: language,
        bodyParams: body.bodyParams ?? [],
        bodyPreview: `[template ${body.templateName}]`,
      });
      await auditSend(req, conversation.contact_id, 'whatsapp_template', outcome);
      publish({
        type: 'message.created',
        payload: { conversationId, contactId: conversation.contact_id, channel: 'whatsapp' },
      });
      res.status(outcomeStatus(outcome)).json(outcome);
      return;
    }

    if (!body.text) throw badRequest('text is required when sending a free-form message');
    const outcome = await sendWhatsApp({
      kind: 'text',
      contactId: conversation.contact_id,
      opportunityId: opportunity?.id ?? null,
      automated: false,
      userId: user.id,
      text: body.text,
    });
    await auditSend(req, conversation.contact_id, 'whatsapp', outcome);
    publish({
      type: 'message.created',
      payload: { conversationId, contactId: conversation.contact_id, channel: 'whatsapp' },
    });
    res.status(outcomeStatus(outcome)).json(outcome);
  }),
);

/** Realtime stream. The client falls back to polling if this fails. */
inboxRouter.get('/stream', (req: Request, res: Response) => {
  const user = currentUser(req);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx buffers SSE by default and swallows every event.
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const clientId = newId();
  addClient(clientId, user.id, res);
  req.on('close', () => removeClient(clientId));
});

async function requireConversation(conversationId: string, user: { id: string; role: Role }) {
  const conversation = await queryOne<{ id: string; contact_id: string; assigned_user_id: string | null }>(
    'SELECT id, contact_id, assigned_user_id FROM conversations WHERE id = ?',
    [conversationId],
  );
  if (!conversation) throw notFound('Conversation not found');
  await assertCanViewContact(conversation.contact_id, await visibleUserIds(user));
  return conversation;
}

function outcomeStatus(outcome: { sent: boolean }): number {
  return outcome.sent ? 201 : 409;
}

async function auditSend(req: Request, contactId: string, kind: string, outcome: { sent: boolean }): Promise<void> {
  await writeAudit({
    actor: actorFrom(req),
    action: 'message.sent',
    entityType: 'contact',
    entityId: contactId,
    after: { kind, sent: outcome.sent },
  });
}
