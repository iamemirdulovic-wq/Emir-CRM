import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth,
} from '../middleware/auth.js';
import { requirePermission } from '../middleware/auth.js';
import { execute, query, queryOne, withRetryingTransaction } from '../../db/client.js';
import { normalizeLead } from '../../ingestion/normalize.js';
import { ingestLead } from '../../ingestion/ingest.js';
import { toE164 } from '../../lib/phone.js';
import { normalizeEmail } from '../../lib/email.js';
import { writeAudit } from '../../audit/audit.js';
import { enqueue } from '../../jobs/queue.js';
import { logger, errorContext } from '../../lib/logger.js';
import { armSlaTimer } from '../../workflows/workflow-a.js';
import { recordAssignment } from '../../routing/assignments.js';

/**
 * Adding a lead by hand — a walk-in, a referral, a number from a roadshow.
 *
 * It goes through the same `ingestLead` every webhook uses, rather than
 * inserting a contact directly. That is the whole reason dedupe works: a
 * walk-in who filled the website form last week has to land on the record
 * that already exists, not beside it.
 */
export const addLeadRouter = Router();
addLeadRouter.use(requireAuth, blockUntilPasswordChanged);

/**
 * Is this person already here?
 *
 * Called while the agent is still typing, so it answers with the least it can.
 * An agent must never be shown the details of a lead that is not theirs — they
 * are told it exists and that the owner has been told, and nothing else.
 */
const checkSchema = z.object({
  phone: z.string().max(40).optional(),
  email: z.string().max(255).optional(),
});

addLeadRouter.post(
  '/check',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const input = checkSchema.parse(req.body ?? {});

    const phone = input.phone ? toE164(input.phone) : null;
    const email = input.email ? normalizeEmail(input.email) : null;
    if (!phone && !email) {
      res.json({ found: false });
      return;
    }

    const existing = await queryOne<{
      id: string; full_name: string | null; owner_user_id: string | null;
      owner_name: string | null; last_inbound_at: Date | null; created_at: Date;
    }>(
      `SELECT c.id, c.full_name, c.owner_user_id, u.name AS owner_name, c.last_inbound_at, c.created_at
         FROM contacts c
         LEFT JOIN users u ON u.id = c.owner_user_id
        WHERE c.merged_into_id IS NULL
          AND (${phone ? 'c.phone_e164 = ?' : '1 = 0'} OR ${email ? 'c.email = ?' : '1 = 0'})
        ORDER BY c.created_at ASC LIMIT 1`,
      [...(phone ? [phone] : []), ...(email ? [email] : [])],
    );

    if (!existing) {
      res.json({ found: false });
      return;
    }

    const mine = existing.owner_user_id === user.id;
    const canSeeAnyone = user.role !== 'agent';

    if (mine || canSeeAnyone) {
      res.json({
        found: true,
        canOpen: true,
        contactId: existing.id,
        name: existing.full_name,
        ownerName: existing.owner_name,
        lastContactAt: existing.last_inbound_at,
      });
      return;
    }

    /*
     * Somebody else's lead. The agent learns only that the client is already
     * in the CRM — not whose, not what was said. Telling them the owner's name
     * would be telling them who to go and argue with about a commission.
     */
    res.json({ found: true, canOpen: false });
  }),
);

const addSchema = z.object({
  fullName: z.string().min(1).max(200),
  phone: z.string().max(40).optional(),
  email: z.string().max(255).optional(),
  whatsapp: z.string().max(40).optional(),
  nationality: z.string().max(8).optional(),
  projectName: z.string().max(160).optional(),
  preferredLocation: z.string().max(160).optional(),
  unitType: z.string().max(64).optional(),
  budgetMinAed: z.number().int().nonnegative().max(1_000_000_000).optional(),
  budgetMaxAed: z.number().int().nonnegative().max(1_000_000_000).optional(),
  purpose: z.enum(['investment', 'end_use', 'unknown']).optional(),
  timeline: z.enum(['immediate', '1_3_months', '3_6_months', '6_12_months', '12_plus', 'unknown']).optional(),
  source: z.enum(['walk_in', 'referral', 'instagram', 'meta_lead_ads', 'google_ads', 'whatsapp_direct', 'event', 'website', 'manual']),
  referredBy: z.string().max(160).optional(),
  note: z.string().max(2000).optional(),
  /** Manager+ only; ignored for an agent, who always gets their own lead. */
  assignToUserId: z.string().max(36).nullable().optional(),
});

addLeadRouter.post(
  '/',
  requirePermission('contacts:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const body = addSchema.parse(req.body);

    if (!body.phone && !body.email) {
      res.status(400).json({
        error: { code: 'bad_request', message: 'A lead needs a phone number or an email — otherwise nobody can call them.' },
      });
      return;
    }

    const lead = normalizeLead({
      source: body.source,
      /* Unique per entry, so pressing Save twice does not make two leads. */
      externalId: `manual:${user.id}:${Date.now()}`,
      /* Only what was actually filled in. An empty string is not the same as
         "not asked", and the normaliser treats a blank as a value. */
      mapped: Object.fromEntries(
        Object.entries({
          full_name: body.fullName,
          phone: body.phone,
          email: body.email,
          wa_id: body.whatsapp ?? body.phone,
          country: body.nationality,
          project: body.projectName,
          preferred_location: body.preferredLocation,
          unit_type: body.unitType,
          budget_min: body.budgetMinAed === undefined ? undefined : String(body.budgetMinAed),
          budget_max: body.budgetMaxAed === undefined ? undefined : String(body.budgetMaxAed),
          purpose: body.purpose,
          timeline: body.timeline,
          message: [body.note, body.referredBy ? `Referred by ${body.referredBy}` : null]
            .filter(Boolean).join('\n') || undefined,
        }).filter(([, value]) => value !== undefined && value !== ''),
      ) as Record<string, string>,
      /*
       * Entered by a member of staff who spoke to them. That is a real basis
       * for consent, and it is recorded as such rather than assumed silently.
       */
      consent: {
        whatsapp: true,
        email: Boolean(body.email),
        sms: false,
        text: `Added by ${user.name} in the CRM after speaking to the client`,
      },
      receivedAt: new Date(),
    });

    const result = await ingestLead(lead);

    /*
     * Who it belongs to. An agent adding a lead keeps it — they are standing
     * in front of the person — and no clock starts, because there is nothing
     * to chase: they already made contact.
     */
    const isAgent = user.role === 'agent';
    const assignTo = isAgent ? user.id : (body.assignToUserId ?? null);

    if (assignTo) {
      await execute(
        'UPDATE opportunities SET owner_user_id = ?, assigned_at = NOW(3), accepted_at = NOW(3) WHERE id = ?',
        [assignTo, result.opportunityId],
      );
      await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ? AND owner_user_id IS NULL',
        [assignTo, result.contactId]);
      await withRetryingTransaction((tx) => recordAssignment(tx, {
        opportunityId: result.opportunityId,
        contactId: result.contactId,
        agentUserId: assignTo,
        assignedByUserId: user.id,
      })).catch((err: unknown) => logger.warn('could not record a manual assignment', errorContext(err)));

      /* A manager handing it to someone else is a hand-over like any other,
         so that one does get a clock. */
      if (!isAgent) {
        await armSlaTimer({
          opportunityId: result.opportunityId,
          contactId: result.contactId,
          assignedUserId: assignTo,
          phase: 'accept',
        }).catch((err: unknown) => logger.warn('could not arm the timer for a manual lead', errorContext(err)));
      }
    }

    await writeAudit({
      actor: actorFrom(req),
      action: 'lead.added_manually',
      entityType: 'opportunity',
      entityId: result.opportunityId,
      after: { source: body.source, assignedTo: assignTo, existingContact: !result.isNewContact },
    });

    /*
     * No automatic welcome. Somebody just spoke to this person; a template
     * arriving thirty seconds later saying "thank you for your interest"
     * would read as a machine that was not listening. Scoring still runs.
     */
    await enqueue('lead.score', { opportunityId: result.opportunityId, contactId: result.contactId }, {
      dedupeKey: `score:${result.opportunityId}`,
      contactId: result.contactId,
    }).catch(() => undefined);

    res.status(201).json({
      contactId: result.contactId,
      opportunityId: result.opportunityId,
      isNewContact: result.isNewContact,
      assignedTo: assignTo,
    });
  }),
);

/** Agents to choose from, for the people allowed to choose. */
addLeadRouter.get(
  '/agents',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    if (user.role === 'agent') {
      res.json({ items: [] });
      return;
    }
    const items = await query<{ id: string; name: string; open_leads: number }>(
      `SELECT u.id, u.name,
              (SELECT COUNT(*) FROM opportunities o
                WHERE o.owner_user_id = u.id AND o.status = 'open' AND o.deleted_at IS NULL) AS open_leads
         FROM users u
        WHERE u.is_active = 1 AND u.role IN ('agent','manager','admin','owner')
        ORDER BY u.name`,
    );
    res.json({ items });
  }),
);
