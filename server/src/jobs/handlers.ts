import { execute, query, queryOne } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { parsePhone } from '../lib/phone.js';
import { HOT_SCORE_THRESHOLD } from '../config/constants.js';
import { fetchLeadDetail, fetchFormLeads, normalizeMetaLead } from '../ingestion/sources/meta.js';
import { markEventFailed, markEventProcessed, markEventProcessing, recordInboundEvent } from '../ingestion/events.js';
import { ingestLead } from '../ingestion/ingest.js';
import { runWorkflowA, runSlaCheck } from '../workflows/workflow-a.js';
import { runWorkflowBStep, type Step } from '../workflows/workflow-b.js';
import { runWorkflowC } from '../workflows/workflow-c.js';
import { sendWhatsApp } from '../messaging/send.js';
import { sendEmail } from '../messaging/email/send.js';
import { pushToManagers, pushToUser } from '../messaging/push.js';
import { syncTemplates } from '../messaging/templates/sync.js';
import { pollInbox } from '../messaging/email/imap.js';
import { detectSpamSignals, scoreLead } from '../scoring/score.js';
import { applyExtractedFields, extractFields, summarizeContact } from '../ai/index.js';
import { sendCapiEvent } from '../attribution/meta-capi.js';
import { uploadConversion } from '../attribution/google-ads.js';
import { purgeExpiredSessions } from '../auth/sessions.js';
import { purgeOldLoginAttempts } from '../auth/lockout.js';
import { reclaimStaleJobs, enqueue } from './queue.js';
import { pruneCronKeys } from './cron.js';
import { runChunk } from '../imports/run.js';
import { purgeExpiredUploads } from '../imports/retention.js';
import { sweepTaskReminders } from '../tasks/reminders.js';
import { purgeOrphanedAttachments } from '../tasks/attachments.js';
import { purgeStaleDocuments } from '../ai/document-store.js';
import { purgeStaleTrash } from '../services/offers.js';
import { sendBatch } from '../campaigns/run.js';
import { recycleList } from '../lists/store.js';
import { recycleStaleClaims } from '../assignment/apply.js';
import type { JobType } from './types.js';

export type JobHandler = (payload: Record<string, unknown>) => Promise<unknown>;

const str = (payload: Record<string, unknown>, key: string): string => {
  const value = payload[key];
  if (typeof value !== 'string' || !value) throw new Error(`Job payload is missing "${key}"`);
  return value;
};
const optionalStr = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === 'string' && value ? value : null;
};

export const HANDLERS: Record<JobType, JobHandler> = {
  // --- ingestion ------------------------------------------------------------
  'meta.fetch_lead': async (payload) => {
    const leadgenId = str(payload, 'leadgenId');
    const inboundEventId = optionalStr(payload, 'inboundEventId');

    if (inboundEventId) await markEventProcessing(inboundEventId);
    try {
      const detail = await fetchLeadDetail(leadgenId);
      const lead = await normalizeMetaLead(detail);
      const result = await ingestLead(lead, { inboundEventId });
      if (inboundEventId) {
        await markEventProcessed(inboundEventId, { contactId: result.contactId, opportunityId: result.opportunityId });
      }
      return result;
    } catch (err) {
      if (inboundEventId) await markEventFailed(inboundEventId, err);
      throw err;
    }
  },

  /** Backfill every 10 minutes, so a missed webhook never loses a lead. */
  'meta.backfill_form': async (payload) => {
    const formId = str(payload, 'formId');
    const sinceMinutes = typeof payload.sinceMinutes === 'number' ? payload.sinceMinutes : 60;
    const since = new Date(Date.now() - sinceMinutes * 60 * 1000);

    const { leads } = await fetchFormLeads(formId, since);
    let ingested = 0;
    let duplicates = 0;

    for (const detail of leads) {
      // The inbound_events unique key does the deduplication for us.
      const event = await recordInboundEvent({
        source: 'meta_lead_ads',
        externalId: detail.id,
        payload: detail,
        signatureValid: true,
      });
      if (event.duplicate) {
        duplicates += 1;
        continue;
      }
      const lead = await normalizeMetaLead(detail);
      const result = await ingestLead(lead, { inboundEventId: event.id });
      await markEventProcessed(event.id, { contactId: result.contactId, opportunityId: result.opportunityId });
      ingested += 1;
    }

    if (ingested > 0) logger.info('meta backfill recovered leads a webhook missed', { formId, ingested });
    return { formId, scanned: leads.length, ingested, duplicates };
  },

  // --- workflows ------------------------------------------------------------
  'workflow.a.instant_capture': async (payload) =>
    runWorkflowA({
      opportunityId: str(payload, 'opportunityId'),
      contactId: str(payload, 'contactId'),
      ...(payload.skipWelcomeTemplate === true ? { skipWelcomeTemplate: true } : {}),
    }),

  'workflow.a.sla_check': async (payload) =>
    runSlaCheck({
      opportunityId: str(payload, 'opportunityId'),
      contactId: str(payload, 'contactId'),
      assignedUserId: str(payload, 'assignedUserId'),
    }),

  'workflow.b.step': async (payload) => {
    // A WhatsApp failure reschedules this job without a step; nothing to do.
    const step = optionalStr(payload, 'step');
    if (!step) return { skipped: 'no_step' };

    const opportunityId = optionalStr(payload, 'opportunityId');
    if (!opportunityId) return { skipped: 'no_opportunity' };

    return runWorkflowBStep({
      contactId: str(payload, 'contactId'),
      opportunityId,
      step: step as Step,
    });
  },

  'workflow.c.route_inbound': async (payload) =>
    runWorkflowC({
      contactId: str(payload, 'contactId'),
      conversationId: str(payload, 'conversationId'),
      messageId: str(payload, 'messageId'),
      opportunityId: optionalStr(payload, 'opportunityId'),
      text: optionalStr(payload, 'text'),
      buttonPayload: optionalStr(payload, 'buttonPayload'),
    }),

  // --- messaging ------------------------------------------------------------
  'whatsapp.send_template': async (payload) =>
    sendWhatsApp({
      kind: 'template',
      contactId: str(payload, 'contactId'),
      opportunityId: optionalStr(payload, 'opportunityId'),
      automated: payload.automated !== false,
      templateName: str(payload, 'templateName'),
      templateLanguage: optionalStr(payload, 'templateLanguage') ?? 'en',
      bodyParams: Array.isArray(payload.bodyParams) ? payload.bodyParams.map(String) : [],
    }),

  'whatsapp.send_text': async (payload) =>
    sendWhatsApp({
      kind: 'text',
      contactId: str(payload, 'contactId'),
      opportunityId: optionalStr(payload, 'opportunityId'),
      automated: payload.automated !== false,
      text: str(payload, 'text'),
    }),

  'email.send': async (payload) =>
    sendEmail({
      contactId: str(payload, 'contactId'),
      opportunityId: optionalStr(payload, 'opportunityId'),
      automated: payload.automated !== false,
      subject: str(payload, 'subject'),
      text: str(payload, 'text'),
    }),

  'push.send': async (payload) => {
    const message = {
      title: str(payload, 'title'),
      body: str(payload, 'body'),
      ...(optionalStr(payload, 'link') ? { link: optionalStr(payload, 'link') as string } : {}),
      ...(optionalStr(payload, 'tel') ? { tel: optionalStr(payload, 'tel') as string } : {}),
    };
    if (payload.audience === 'managers') return { delivered: await pushToManagers(message) };
    return { delivered: await pushToUser(str(payload, 'userId'), message) };
  },

  // --- intelligence ---------------------------------------------------------
  'lead.score': async (payload) => {
    const opportunityId = str(payload, 'opportunityId');
    const contactId = str(payload, 'contactId');

    const opportunity = await queryOne<{
      budget_min_aed: number | null;
      budget_max_aed: number | null;
      timeline: string;
      purpose: string;
      golden_visa_interest: number;
    }>(
      'SELECT budget_min_aed, budget_max_aed, timeline, purpose, golden_visa_interest FROM opportunities WHERE id = ?',
      [opportunityId],
    );
    const contact = await queryOne<{ phone_e164: string | null; email: string | null; full_name: string | null; notes: string | null }>(
      'SELECT phone_e164, email, full_name, notes FROM contacts WHERE id = ?',
      [contactId],
    );
    if (!opportunity || !contact) return { skipped: 'record_gone' };

    const phone = parsePhone(contact.phone_e164);
    const inbound = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM messages WHERE contact_id = ? AND direction = 'inbound' AND channel = 'whatsapp'`,
      [contactId],
    );
    const intents = await query<{ value: string }>(
      `SELECT t.value FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
        WHERE ct.contact_id = ? AND t.namespace = 'intent'`,
      [contactId],
    );
    const intentSet = new Set(intents.map((i) => i.value));
    const inquiries = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM opportunities WHERE contact_id = ?', [contactId]);

    const breakdown = scoreLead({
      hasValidPhone: phone.isValid,
      isMobile: phone.isMobile,
      hasEmail: Boolean(contact.email),
      budgetMinAed: opportunity.budget_min_aed,
      budgetMaxAed: opportunity.budget_max_aed,
      timeline: opportunity.timeline as never,
      purpose: opportunity.purpose as never,
      repliedOnWhatsApp: Number(inbound?.n ?? 0) > 0,
      requestedCall: intentSet.has('call_me') || intentSet.has('hot'),
      requestedPricing: intentSet.has('pricing'),
      requestedBrochure: intentSet.has('brochure'),
      inquiryCount: Number(inquiries?.n ?? 1),
      goldenVisaInterest: opportunity.golden_visa_interest === 1,
      spamSignals: detectSpamSignals({
        fullName: contact.full_name,
        email: contact.email,
        phoneValid: phone.isValid,
        notes: contact.notes,
      }),
      invalidNumber: !phone.isValid,
    });

    await execute('UPDATE opportunities SET lead_score = ? WHERE id = ?', [breakdown.score, opportunityId]);
    await execute('UPDATE contacts SET lead_score = ? WHERE id = ?', [breakdown.score, contactId]);

    // A score of 70+ is hot and triggers a manager push.
    if (breakdown.isHot) {
      const wasHot = await queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
          WHERE ct.contact_id = ? AND t.namespace = 'intent' AND t.value = 'hot'`,
        [contactId],
      );
      await execute(`INSERT IGNORE INTO tags (id, namespace, value, label) VALUES (UUID(), 'intent', 'hot', 'Hot lead')`);
      const tag = await queryOne<{ id: string }>(`SELECT id FROM tags WHERE namespace = 'intent' AND value = 'hot'`);
      if (tag) await execute('INSERT IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)', [contactId, tag.id]);

      if (Number(wasHot?.n ?? 0) === 0) {
        await pushToManagers({
          title: `Hot lead (${breakdown.score}/100)`,
          body: `${contact.full_name ?? 'A lead'} scored ${breakdown.score} — worth a look.`,
          link: `/contacts/${contactId}`,
          priority: 'high',
        }).catch(() => 0);
      }
    }

    return { score: breakdown.score, isHot: breakdown.score >= HOT_SCORE_THRESHOLD, components: breakdown.components };
  },

  'ai.extract': async (payload) => {
    const contactId = str(payload, 'contactId');
    const opportunityId = optionalStr(payload, 'opportunityId');
    const fields = await extractFields(contactId, opportunityId);
    if (!fields) return { skipped: 'ai_disabled_or_no_messages' };
    const applied = opportunityId ? await applyExtractedFields(opportunityId, fields) : [];
    return { fields, applied };
  },

  'ai.summarize': async (payload) => {
    const result = await summarizeContact(str(payload, 'contactId'));
    return result ?? { skipped: 'ai_disabled_or_no_messages' };
  },

  // --- ad platform feedback -------------------------------------------------
  'capi.send_event': async (payload) =>
    sendCapiEvent({
      opportunityId: str(payload, 'opportunityId'),
      contactId: str(payload, 'contactId'),
      eventName: str(payload, 'eventName'),
    }),

  'google.upload_conversion': async (payload) =>
    uploadConversion({
      opportunityId: str(payload, 'opportunityId'),
      contactId: str(payload, 'contactId'),
      eventName: str(payload, 'eventName'),
    }),

  // --- maintenance ----------------------------------------------------------
  'templates.sync': async () => syncTemplates(),
  'email.imap_poll': async () => pollInbox(),

  // --- bulk import, campaigns and lists -------------------------------------

  /**
   * One chunk of a bulk import, then it re-enqueues itself.
   *
   * Self-rescheduling rather than one long job: a worker restart costs a
   * thousand rows, not a hundred thousand, and the progress bar keeps moving
   * because each chunk commits its own counts.
   */
  'import.run_chunk': async (payload) => {
    const importId = str(payload, 'importId');
    const result = await runChunk(importId);
    if (!result.done) {
      await enqueue(
        'import.run_chunk',
        { importId },
        { priority: 5, dedupeKey: `import-chunk:${importId}:${Date.now()}` },
      );
    }
    return result;
  },

  /** One throttled batch of a WhatsApp campaign. Schedules the next itself. */
  'campaign.send_batch': async (payload) => {
    const campaignId = str(payload, 'campaignId');
    return sendBatch(campaignId);
  },

  /** Returns untouched leads to the pool, per each list's own setting. */
  'list.recycle': async (payload) => {
    const listId = optionalStr(payload, 'listId');
    if (listId) return { listId, recycled: await recycleList(listId) };

    const lists = await query<{ id: string }>(
      'SELECT id FROM lists WHERE recycle_after_days IS NOT NULL AND recycle_action IS NOT NULL',
    );
    let recycled = 0;
    for (const list of lists) recycled += await recycleList(list.id);
    const claims = await recycleStaleClaims();
    return { lists: lists.length, recycled, poolClaimsReleased: claims };
  },

  'task.reminder_sweep': async () => sweepTaskReminders(),

  'maintenance.cleanup': async () => {
    const sessions = await purgeExpiredSessions();
    const attempts = await purgeOldLoginAttempts();
    const reclaimed = await reclaimStaleJobs();
    const events = await execute(
      `DELETE FROM inbound_events WHERE status = 'processed' AND received_at < DATE_SUB(NOW(3), INTERVAL 90 DAY)`,
    );
    const cronKeys = await pruneCronKeys();
    const uploads = await purgeExpiredUploads();
    // A deleted task cascades its attachment rows away and leaves the bytes.
    const orphans = await purgeOrphanedAttachments();
    // A brochure left behind by a request that died mid-read.
    const scratch = await purgeStaleDocuments();
    // Offers in the trash are recoverable for thirty days, then they are not.
    const offers = await purgeStaleTrash();
    return {
      expiredSessions: sessions,
      oldLoginAttempts: attempts,
      reclaimedJobs: reclaimed,
      prunedInboundEvents: events.affectedRows,
      prunedCronKeys: cronKeys,
      deletedUploads: uploads,
      orphanedAttachments: orphans,
      staleDocuments: scratch,
      purgedOffers: offers,
    };
  },
};
