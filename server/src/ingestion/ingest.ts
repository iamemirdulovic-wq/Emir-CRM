import type { PoolConnection } from 'mysql2/promise';
import { execute, queryOne, withRetryingTransaction, type Executor } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { writeAudit, SYSTEM_ACTOR } from '../audit/audit.js';
import { DEFAULT_PIPELINE_KEY, defaultSubStatus } from '../pipeline/stages.js';
import { enqueue } from '../jobs/queue.js';
import type { LeadDTO } from './dto.js';
import { decideOpportunity } from './merge.js';
import { loadOpenOpportunities, resolveContact } from './identity.js';

export type IngestResult = {
  contactId: string;
  opportunityId: string;
  conversationId: string;
  isNewContact: boolean;
  isNewOpportunity: boolean;
  matchedBy: string;
  possibleDuplicate: boolean;
  /** Set when a re-inquiry attached to an existing card. */
  attachedReason?: string;
};

/**
 * Ingest one normalized lead.
 *
 * Everything runs in a single transaction: the contact, the opportunity, the
 * conversation, consents, tags, the activity trail and the Workflow A job all
 * commit together or not at all. That is what makes "never lose a lead" and
 * "never duplicate a lead" the same guarantee.
 */
export type IngestOptions = {
  inboundEventId?: string | null;
  /**
   * Set by a bulk import. Two things follow from it: the opportunity records
   * which import it came from, and Workflow A does not run.
   *
   * A file of forty thousand old leads must not fire forty thousand welcome
   * messages — it would breach the consent rules, exhaust Meta's messaging
   * limits and very likely get the WhatsApp number banned. Imported leads are
   * worked through a list or a campaign instead, which is consent-checked and
   * throttled.
   */
  importId?: string | null;
  /**
   * Open a new inquiry even when the 30-day re-inquiry rule would have attached
   * this to an existing card. Used by an import whose owner chose "create
   * anyway": they are re-importing an old list and want each row logged as a
   * fresh inquiry rather than folded into history.
   *
   * It cannot create a second *contact* for the same person — `phone_e164` and
   * `wa_id` are unique, and "never duplicate a lead" is the guarantee the whole
   * schema is built on. It creates a second opportunity against the one
   * contact, which is what "create anyway" can honestly mean here.
   */
  forceNewOpportunity?: boolean;
};

export async function ingestLead(lead: LeadDTO, opts: IngestOptions = {}): Promise<IngestResult> {
  return withRetryingTransaction(async (tx) => {
    const resolved = await resolveContact(tx, lead);

    const existing = await loadOpenOpportunities(tx, resolved.contactId);
    const decision = decideOpportunity(
      existing.map((o) => ({
        id: o.id,
        projectName: o.project_name,
        stageKey: o.stage_key,
        status: o.status,
        createdAt: o.created_at,
      })),
      lead,
      lead.receivedAt,
    );

    let opportunityId: string;
    let isNewOpportunity: boolean;

    if (decision.action === 'attach' && !opts.forceNewOpportunity) {
      opportunityId = decision.opportunityId;
      isNewOpportunity = false;
      await enrichOpportunity(tx, opportunityId, lead);
      await addActivity(tx, {
        contactId: resolved.contactId,
        opportunityId,
        type: 'lead.reinquiry',
        title: `Re-inquiry from ${lead.source}`,
        body: describeLead(lead),
        meta: { reason: decision.reason, source: lead.source, externalId: lead.externalId },
      });
    } else {
      opportunityId = await createOpportunity(
        tx,
        resolved.contactId,
        resolved.ownerUserId,
        lead,
        opts.importId ?? null,
      );
      isNewOpportunity = true;
      await addActivity(tx, {
        contactId: resolved.contactId,
        opportunityId,
        type: 'lead.created',
        title: `New lead from ${lead.source}`,
        body: describeLead(lead),
        meta: { reason: decision.reason, source: lead.source, externalId: lead.externalId },
      });
    }

    const conversationId = await ensureConversation(tx, resolved.contactId, resolved.ownerUserId);
    await recordConsents(tx, resolved.contactId, lead);
    await applyTags(tx, resolved.contactId, lead);

    if (resolved.possibleDuplicate) {
      await tagContact(tx, resolved.contactId, 'ops', 'possible-duplicate');
      await addActivity(tx, {
        contactId: resolved.contactId,
        opportunityId,
        type: 'contact.possible_duplicate',
        title: 'Possible duplicate flagged for review',
        body: 'Matched on email, but the phone number differs from the existing contact.',
        meta: { matchedBy: resolved.matchedBy },
      });
    }

    if (opts.inboundEventId) {
      await execute(
        'UPDATE inbound_events SET contact_id = ?, opportunity_id = ? WHERE id = ?',
        [resolved.contactId, opportunityId, opts.inboundEventId],
        tx,
      );
    }

    await writeAudit(
      {
        actor: SYSTEM_ACTOR,
        action: isNewOpportunity ? 'lead.ingested' : 'lead.reinquiry',
        entityType: 'opportunity',
        entityId: opportunityId,
        after: {
          source: lead.source,
          externalId: lead.externalId,
          contactId: resolved.contactId,
          isNewContact: resolved.isNew,
          matchedBy: resolved.matchedBy,
          importId: opts.importId ?? null,
          instantCaptureSuppressed: Boolean(opts.importId),
        },
      },
      tx,
    );

    // Workflow A runs only for a genuinely new inquiry that arrived on its own.
    // A re-inquiry keeps its existing automation rather than restarting the
    // welcome sequence, and an imported lead never starts one at all.
    if (isNewOpportunity && !opts.importId) {
      await enqueue(
        'workflow.a.instant_capture',
        { opportunityId, contactId: resolved.contactId, source: lead.source },
        {
          priority: 1,
          dedupeKey: `wf-a:${opportunityId}`,
          contactId: resolved.contactId,
        },
        tx,
      );
    }

    logger.info('lead ingested', {
      source: lead.source,
      contactId: resolved.contactId,
      opportunityId,
      isNewContact: resolved.isNew,
      isNewOpportunity,
      matchedBy: resolved.matchedBy,
    });

    return {
      contactId: resolved.contactId,
      opportunityId,
      conversationId,
      isNewContact: resolved.isNew,
      isNewOpportunity,
      matchedBy: resolved.matchedBy,
      possibleDuplicate: resolved.possibleDuplicate,
      ...(decision.action === 'attach' ? { attachedReason: decision.reason } : {}),
    };
  });
}

async function createOpportunity(
  tx: PoolConnection,
  contactId: string,
  ownerUserId: string | null,
  lead: LeadDTO,
  importId: string | null,
): Promise<string> {
  const stage = await queryOne<{ id: string; pipeline_id: string }>(
    `SELECT s.id, s.pipeline_id
       FROM pipeline_stages s
       JOIN pipelines p ON p.id = s.pipeline_id
      WHERE p.\`key\` = ? AND s.\`key\` = 'new_lead'`,
    [DEFAULT_PIPELINE_KEY],
    tx,
  );
  if (!stage) throw new Error(`Default pipeline "${DEFAULT_PIPELINE_KEY}" is not seeded`);

  const id = newId();
  const title = lead.realEstate.projectName
    ? `${lead.person.fullName ?? 'New lead'} — ${lead.realEstate.projectName}`
    : (lead.person.fullName ?? 'New lead');

  await execute(
    `INSERT INTO opportunities
       (id, contact_id, pipeline_id, stage_id, stage_key, sub_status, owner_user_id, title, status,
        project_name, developer, emirate, preferred_location, unit_type,
        budget_min_aed, budget_max_aed, budget_band, purpose, payment_method, timeline, golden_visa_interest,
        source, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, form_id, form_name,
        meta_lead_id, ctwa_clid, gclid, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
        landing_page, referrer, fbp, fbc, client_ip, client_user_agent,
        import_id, assigned_at, created_at, stage_changed_at)
     VALUES (?, ?, ?, ?, 'new_lead', ?, ?, ?, 'open',
             ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?)`,
    [
      id,
      contactId,
      stage.pipeline_id,
      stage.id,
      defaultSubStatus('new_lead'),
      ownerUserId,
      title.slice(0, 200),
      lead.realEstate.projectName,
      lead.realEstate.developer,
      lead.realEstate.emirate,
      lead.realEstate.preferredLocation,
      lead.realEstate.unitType,
      lead.realEstate.budgetMinAed,
      lead.realEstate.budgetMaxAed,
      lead.realEstate.budgetBand,
      lead.realEstate.purpose,
      lead.realEstate.paymentMethod,
      lead.realEstate.timeline,
      lead.realEstate.goldenVisaInterest ? 1 : 0,
      lead.source,
      lead.attribution.campaignId,
      lead.attribution.campaignName,
      lead.attribution.adsetId,
      lead.attribution.adsetName,
      lead.attribution.adId,
      lead.attribution.adName,
      lead.attribution.formId,
      lead.attribution.formName,
      lead.attribution.metaLeadId,
      lead.attribution.ctwaClid,
      lead.attribution.gclid,
      lead.attribution.utmSource,
      lead.attribution.utmMedium,
      lead.attribution.utmCampaign,
      lead.attribution.utmTerm,
      lead.attribution.utmContent,
      lead.attribution.landingPage,
      lead.attribution.referrer,
      lead.attribution.fbp,
      lead.attribution.fbc,
      lead.attribution.clientIp,
      lead.attribution.clientUserAgent,
      importId,
      ownerUserId ? lead.receivedAt : null,
      lead.receivedAt,
      lead.receivedAt,
    ],
    tx,
  );
  return id;
}

/** A re-inquiry may carry details the original card was missing. Fill only gaps. */
async function enrichOpportunity(tx: PoolConnection, opportunityId: string, lead: LeadDTO): Promise<void> {
  const fields: Array<[string, unknown]> = [
    ['project_name', lead.realEstate.projectName],
    ['developer', lead.realEstate.developer],
    ['emirate', lead.realEstate.emirate],
    ['preferred_location', lead.realEstate.preferredLocation],
    ['unit_type', lead.realEstate.unitType],
    ['budget_min_aed', lead.realEstate.budgetMinAed],
    ['budget_max_aed', lead.realEstate.budgetMaxAed],
    ['budget_band', lead.realEstate.budgetBand],
  ];
  const present = fields.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (present.length === 0) return;

  // COALESCE keeps whatever is already there; only NULL columns take the new value.
  await execute(
    `UPDATE opportunities SET ${present.map(([k]) => `${k} = COALESCE(${k}, ?)`).join(', ')} WHERE id = ?`,
    [...present.map(([, v]) => v as never), opportunityId],
    tx,
  );

  const enums: Array<[string, string]> = [
    ['purpose', lead.realEstate.purpose],
    ['payment_method', lead.realEstate.paymentMethod],
    ['timeline', lead.realEstate.timeline],
  ];
  for (const [column, value] of enums) {
    if (value === 'unknown') continue;
    await execute(`UPDATE opportunities SET ${column} = ? WHERE id = ? AND ${column} = 'unknown'`, [value, opportunityId], tx);
  }
}

export async function ensureConversation(
  tx: PoolConnection,
  contactId: string,
  assignedUserId: string | null,
): Promise<string> {
  const existing = await queryOne<{ id: string }>('SELECT id FROM conversations WHERE contact_id = ?', [contactId], tx);
  if (existing) return existing.id;

  const id = newId();
  try {
    await execute('INSERT INTO conversations (id, contact_id, assigned_user_id) VALUES (?, ?, ?)', [id, contactId, assignedUserId], tx);
    return id;
  } catch (err) {
    // Another writer created the thread first; use theirs.
    const row = await queryOne<{ id: string }>('SELECT id FROM conversations WHERE contact_id = ? FOR UPDATE', [contactId], tx);
    if (row) return row.id;
    throw err;
  }
}

async function recordConsents(tx: PoolConnection, contactId: string, lead: LeadDTO): Promise<void> {
  const channels: Array<['whatsapp' | 'email' | 'sms', boolean]> = [
    ['whatsapp', lead.consent.whatsapp],
    ['email', lead.consent.email],
    ['sms', lead.consent.sms],
  ];
  for (const [channel, granted] of channels) {
    if (!granted) continue;
    await execute(
      `INSERT INTO consents (id, contact_id, channel, granted, source, consent_text, ip)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
      [newId(), contactId, channel, lead.source, lead.consent.text, lead.attribution.clientIp],
      tx,
    );
  }
}

async function applyTags(tx: PoolConnection, contactId: string, lead: LeadDTO): Promise<void> {
  await tagContact(tx, contactId, 'src', lead.source);
  if (lead.person.language) await tagContact(tx, contactId, 'lang', lead.person.language);
  if (lead.realEstate.projectName) {
    await tagContact(tx, contactId, 'proj', slug(lead.realEstate.projectName));
  }
}

/** Tags use the namespace:value format and are created on demand. */
export async function tagContact(
  tx: Executor,
  contactId: string,
  namespace: string,
  value: string,
): Promise<void> {
  const cleanValue = slug(value);
  if (!cleanValue) return;

  await execute('INSERT IGNORE INTO tags (id, namespace, value, label) VALUES (?, ?, ?, ?)', [newId(), namespace, cleanValue, value], tx);
  const tag = await queryOne<{ id: string }>('SELECT id FROM tags WHERE namespace = ? AND value = ?', [namespace, cleanValue], tx);
  if (!tag) return;
  await execute('INSERT IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)', [contactId, tag.id], tx);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9؀-ۿ]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

export async function addActivity(
  tx: PoolConnection,
  input: {
    contactId: string | null;
    opportunityId?: string | null;
    userId?: string | null;
    type: string;
    title: string;
    body?: string | null;
    meta?: Record<string, unknown> | null;
  },
): Promise<string> {
  const id = newId();
  await execute(
    `INSERT INTO activities (id, contact_id, opportunity_id, user_id, type, title, body, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.contactId,
      input.opportunityId ?? null,
      input.userId ?? null,
      input.type,
      input.title.slice(0, 255),
      input.body ?? null,
      input.meta ? JSON.stringify(input.meta) : null,
    ],
    tx,
  );
  return id;
}

function describeLead(lead: LeadDTO): string {
  const parts: string[] = [];
  if (lead.realEstate.projectName) parts.push(`Project: ${lead.realEstate.projectName}`);
  if (lead.realEstate.budgetBand) parts.push(`Budget: ${lead.realEstate.budgetBand}`);
  if (lead.realEstate.unitType) parts.push(`Unit: ${lead.realEstate.unitType}`);
  if (lead.realEstate.timeline !== 'unknown') parts.push(`Timeline: ${lead.realEstate.timeline}`);
  if (lead.realEstate.purpose !== 'unknown') parts.push(`Purpose: ${lead.realEstate.purpose}`);
  if (lead.attribution.campaignName) parts.push(`Campaign: ${lead.attribution.campaignName}`);
  if (lead.notes) parts.push(lead.notes);
  return parts.join('\n') || 'No additional details provided.';
}
