import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth, requirePermission,
} from '../middleware/auth.js';
import { assertCanViewContact } from '../../services/contacts.js';
import { visibleUserIds } from '../../auth/scope.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../audit/audit.js';
import { execute, query, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import {
  createTemplate, getTemplate, listTemplates, removeTemplate, updateTemplate,
} from '../../email/templates.js';
import { MERGE_FIELDS } from '../../email/merge.js';
import { previewClientEmail, sendClientEmail } from '../../email/send-client.js';
import { emailReadiness } from '../../email/provider.js';
import {
  audienceFor, estimatedMinutes, getCampaign, pauseCampaign, startCampaign,
} from '../../email/campaigns.js';

/**
 * Client email: the templates, the composer and the campaigns.
 *
 * Every route that touches one contact checks the caller may see that lead
 * first. Sending an email is contacting somebody's client, so the fence is
 * the same one the lead page uses.
 */
export const emailRouter = Router();
emailRouter.use(requireAuth, blockUntilPasswordChanged);

/* ── Templates ──────────────────────────────────────────────────────────── */

emailRouter.get(
  '/templates',
  asyncHandler(async (req: Request, res: Response) => {
    const canManage = ['owner', 'admin', 'manager'].includes(currentUser(req).role);
    res.json({
      items: await listTemplates({ includeDisabled: canManage }),
      /* Sent with the list so the composer can offer the fields rather than
         making an agent remember the spelling of {{agent_first_name}}. */
      mergeFields: MERGE_FIELDS.map(({ key, label }) => ({ key, label })),
    });
  }),
);

const templateSchema = z.object({
  name: z.string().min(1).max(160),
  category: z.enum(['first_reply', 'follow_up', 'project', 'appointment', 'offer', 'nurture', 'other']),
  language: z.string().max(12).optional(),
  subject: z.string().min(1).max(255),
  body: z.string().min(1).max(20_000),
  previewText: z.string().max(255).nullable().optional(),
  enabled: z.boolean().optional(),
});

emailRouter.post(
  '/templates',
  requirePermission('templates:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = await createTemplate(actorFrom(req), templateSchema.parse(req.body));
    res.status(201).json({ id });
  }),
);

emailRouter.patch(
  '/templates/:id',
  requirePermission('templates:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const ok = await updateTemplate(actorFrom(req), String(req.params.id), templateSchema.partial().parse(req.body));
    if (!ok) throw notFound('That template does not exist');
    res.json({ ok });
  }),
);

emailRouter.delete(
  '/templates/:id',
  requirePermission('templates:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await removeTemplate(actorFrom(req), String(req.params.id));
    if (!result) throw notFound('That template does not exist');
    /* A system template is switched off rather than deleted, and the UI says
       which happened so nobody goes looking for it in a bin. */
    res.json({ ok: true, outcome: result });
  }),
);

/* ── The composer ───────────────────────────────────────────────────────── */

const composeSchema = z.object({
  contactId: z.string().max(36),
  opportunityId: z.string().max(36).nullable().optional(),
  subject: z.string().min(1).max(255),
  body: z.string().min(1).max(20_000),
  templateKey: z.string().max(64).nullable().optional(),
});

/** Exactly what would be sent, through the same code that sends it. */
emailRouter.post(
  '/preview',
  asyncHandler(async (req: Request, res: Response) => {
    const body = composeSchema.parse(req.body);
    await assertCanViewContact(body.contactId, await visibleUserIds(currentUser(req)));
    res.json({
      ...(await previewClientEmail({ ...body, userId: currentUser(req).id })),
      readiness: emailReadiness(),
    });
  }),
);

emailRouter.post(
  '/send',
  asyncHandler(async (req: Request, res: Response) => {
    const body = composeSchema.parse(req.body);
    const user = currentUser(req);
    await assertCanViewContact(body.contactId, await visibleUserIds(user));

    const outcome = await sendClientEmail({
      ...body,
      userId: user.id,
      automated: false,
    });

    await writeAudit({
      actor: actorFrom(req),
      action: 'email.sent',
      entityType: 'contact',
      entityId: body.contactId,
      after: { subject: body.subject.slice(0, 120), sent: outcome.sent },
    });

    if (!outcome.sent && 'blocked' in outcome) {
      /* 200 with a reason, not an error: "this client unsubscribed" is an
         answer the composer shows, not a failure to retry. */
      return void res.json({ sent: false, reason: outcome.blocked.message });
    }
    res.json({
      sent: outcome.sent,
      redirected: outcome.redirected ?? false,
      ...(outcome.sent ? {} : { reason: 'The provider would not take it' }),
    });
  }),
);

/** What the Settings screen shows about email. Never includes a key. */
emailRouter.get(
  '/readiness',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(emailReadiness());
  }),
);

/* ── Campaigns ──────────────────────────────────────────────────────────── */

emailRouter.get(
  '/campaigns',
  requirePermission('templates:manage'),
  asyncHandler(async (_req: Request, res: Response) => {
    const items = await query(
      `SELECT ec.id, ec.name, ec.status, ec.subject, ec.scheduled_at, ec.throttle_per_hour,
              ec.total_members, ec.sent_count, ec.opened_count, ec.clicked_count,
              ec.bounced_count, ec.unsubscribed_count, ec.failed_count, ec.created_at,
              l.name AS list_name, u.name AS created_by
         FROM email_campaigns ec
         LEFT JOIN lists l ON l.id = ec.list_id
         LEFT JOIN users u ON u.id = ec.created_by_user_id
        WHERE ec.deleted_at IS NULL
        ORDER BY ec.created_at DESC
        LIMIT 100`,
    );
    res.json({ items });
  }),
);

const campaignSchema = z.object({
  name: z.string().min(1).max(160),
  listId: z.string().max(36).nullable().optional(),
  templateId: z.string().max(36).nullable().optional(),
  subject: z.string().min(1).max(255),
  body: z.string().min(1).max(20_000),
  previewText: z.string().max(255).nullable().optional(),
  fromUserId: z.string().max(36).nullable().optional(),
  throttlePerHour: z.number().int().min(10).max(5_000).optional(),
  scheduledAt: z.string().nullable().optional(),
});

emailRouter.post(
  '/campaigns',
  requirePermission('templates:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = campaignSchema.parse(req.body);
    const id = newId();
    await execute(
      `INSERT INTO email_campaigns
         (id, name, list_id, template_id, subject, body, preview_text, from_user_id,
          throttle_per_hour, scheduled_at, status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, body.name, body.listId ?? null, body.templateId ?? null, body.subject, body.body,
        body.previewText ?? null, body.fromUserId ?? currentUser(req).id,
        body.throttlePerHour ?? 200,
        body.scheduledAt ? new Date(body.scheduledAt) : null,
        body.scheduledAt ? 'scheduled' : 'draft',
        currentUser(req).id,
      ],
    );
    await writeAudit({
      actor: actorFrom(req), action: 'email_campaign.created',
      entityType: 'email_campaign', entityId: id, after: { name: body.name },
    });
    res.status(201).json({ id });
  }),
);

/** Who would get it, who would not, and roughly how long it would take. */
emailRouter.get(
  '/campaigns/:id/audience',
  requirePermission('templates:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const campaign = await getCampaign(String(req.params.id));
    if (!campaign) throw notFound('That campaign does not exist');
    if (!campaign.list_id) return void res.json({ willReceive: 0, skipped: [], minutes: 0 });

    const audience = await audienceFor(campaign.list_id);
    res.json({
      ...audience,
      minutes: estimatedMinutes(audience.willReceive, campaign.throttle_per_hour),
    });
  }),
);

emailRouter.post(
  '/campaigns/:id/start',
  requirePermission('templates:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    await startCampaign(actorFrom(req), String(req.params.id));
    res.json({ ok: true });
  }),
);

emailRouter.post(
  '/campaigns/:id/pause',
  requirePermission('templates:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    await pauseCampaign(actorFrom(req), String(req.params.id), 'Paused by hand');
    res.json({ ok: true });
  }),
);

emailRouter.get(
  '/campaigns/:id',
  requirePermission('templates:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const campaign = await getCampaign(String(req.params.id));
    if (!campaign) throw notFound('That campaign does not exist');

    const skipped = await query<{ reason: string; n: number }>(
      `SELECT reason, COUNT(*) AS n FROM email_campaign_members
        WHERE campaign_id = ? AND status IN ('skipped','failed') AND reason IS NOT NULL
        GROUP BY reason ORDER BY n DESC LIMIT 10`,
      [campaign.id],
    );

    res.json({
      campaign,
      skipped,
      minutes: estimatedMinutes(
        Math.max(0, campaign.total_members - campaign.sent_count),
        campaign.throttle_per_hour,
      ),
    });
  }),
);

/* ── What happened to a message ─────────────────────────────────────────── */

emailRouter.get(
  '/events/:contactId',
  asyncHandler(async (req: Request, res: Response) => {
    const contactId = String(req.params.contactId);
    await assertCanViewContact(contactId, await visibleUserIds(currentUser(req)));
    const items = await query(
      `SELECT id, message_id, type, url, city, occurred_at
         FROM email_events WHERE contact_id = ?
        ORDER BY occurred_at DESC LIMIT 200`,
      [contactId],
    );
    res.json({ items });
  }),
);

/* ── WhatsApp click-to-chat ─────────────────────────────────────────────── */

/**
 * The four openings an agent actually uses, filled in for this lead.
 *
 * Built on the server because they quote the project the lead asked about,
 * and the composer should not be guessing at that from whatever the page
 * happened to have loaded.
 */
emailRouter.get(
  '/whatsapp-openings/:contactId',
  asyncHandler(async (req: Request, res: Response) => {
    const contactId = String(req.params.contactId);
    await assertCanViewContact(contactId, await visibleUserIds(currentUser(req)));

    const row = await queryOne<{
      full_name: string | null; phone_e164: string | null; project_name: string | null;
    }>(
      `SELECT c.full_name, c.phone_e164,
              (SELECT o.project_name FROM opportunities o
                WHERE o.contact_id = c.id AND o.deleted_at IS NULL
                ORDER BY o.created_at DESC LIMIT 1) AS project_name
         FROM contacts c WHERE c.id = ?`,
      [contactId],
    );
    if (!row) throw notFound('That contact does not exist');
    if (!row.phone_e164) throw badRequest('That contact has no phone number');

    const first = (row.full_name ?? '').trim().split(/\s+/)[0] || 'there';
    const project = row.project_name ?? 'the project';
    const me = currentUser(req);

    const openings = [
      {
        key: 'first_touch',
        label: 'First message',
        text: `Hi ${first}, this is ${me.name} from Emigeo Homes. Thanks for your interest in ${project}. `
          + 'Is now a good time for a quick call?',
      },
      {
        key: 'missed_call',
        label: 'After a missed call',
        text: `Hi ${first}, I just tried to call you about ${project}. `
          + 'No rush — tell me a time that suits you and I will call then.',
      },
      {
        key: 'send_details',
        label: 'Sending details',
        text: `Hi ${first}, here are the details for ${project} as promised. `
          + 'Have a look and tell me which layout you prefer.',
      },
      {
        key: 'check_in',
        label: 'Checking in',
        text: `Hi ${first}, just checking in about ${project}. `
          + 'Are you still looking, or shall I leave it for now?',
      },
    ];

    res.json({
      phone: row.phone_e164,
      openings: openings.map((opening) => ({
        ...opening,
        /* wa.me wants digits only; a plus or a space gives a dead link. */
        url: `https://wa.me/${row.phone_e164!.replace(/\D/g, '')}?text=${encodeURIComponent(opening.text)}`,
      })),
    });
  }),
);
