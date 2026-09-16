import { execute, queryOne, withRetryingTransaction } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { isQuietHours } from '../lib/time.js';
import { SYSTEM_ACTOR, writeAudit } from '../audit/audit.js';
import { addActivity } from '../ingestion/ingest.js';
import { enqueue } from '../jobs/queue.js';
import { sendWhatsApp } from '../messaging/send.js';
import { pushToUser } from '../messaging/push.js';
import { classifyIntent } from '../ai/index.js';
import { findVerifiedProject, hasLocation, pricingMessage } from '../services/projects.js';
import { setDnc } from '../services/contacts.js';
import { moveStage } from '../services/opportunities.js';
import { resolveIntent, type Intent, type IntentResult } from './intent.js';
import { stopSequence } from './workflow-b.js';
import { startRun, completeRun, setStep } from './runs.js';

/**
 * Workflow C — inbound WhatsApp routing.
 *
 *  1. update last_inbound_at (this cancels Workflow B)
 *  2. if the stage is Attempted Contact, move it to Engaged
 *  3. resolve intent: button payload → keywords (EN/AR) → AI classifier
 *  4. route by intent
 */

export type WorkflowCInput = {
  contactId: string;
  conversationId: string;
  messageId: string;
  opportunityId: string | null;
  text: string | null;
  buttonPayload: string | null;
};

export type WorkflowCResult = {
  intent: Intent;
  intentSource: IntentResult['source'];
  action: string;
};

export async function runWorkflowC(input: WorkflowCInput): Promise<WorkflowCResult> {
  const runId = await startRun({
    workflowKey: 'C_inbound_routing',
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    context: { messageId: input.messageId },
  });

  // Step 1 — the inbound message stops the follow-up sequence.
  await setStep(runId, 'cancel_followups');
  await stopSequence(input.contactId, 'lead_replied');

  // Step 2 — Attempted Contact becomes Engaged.
  await setStep(runId, 'advance_stage');
  await advanceToEngaged(input.opportunityId);

  // Step 3 — resolve the intent.
  await setStep(runId, 'resolve_intent');
  let intent = resolveIntent({ buttonPayload: input.buttonPayload, text: input.text });
  if (intent.intent === 'UNKNOWN' && input.text) {
    const ai = await classifyIntent(input.text);
    if (ai) intent = ai;
  }

  // Step 4 — route.
  await setStep(runId, `route:${intent.intent}`);
  const action = await route(input, intent);

  await withRetryingTransaction(async (tx) => {
    await addActivity(tx, {
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      type: 'intent.resolved',
      title: `Intent: ${intent.intent}`,
      body: intent.matched ? `Matched "${intent.matched}"` : null,
      meta: { intent: intent.intent, source: intent.source, confidence: intent.confidence, action },
    });
  });

  await completeRun(runId);
  logger.info('workflow C routed an inbound message', {
    contactId: input.contactId,
    intent: intent.intent,
    source: intent.source,
    action,
  });

  return { intent: intent.intent, intentSource: intent.source, action };
}

async function advanceToEngaged(opportunityId: string | null): Promise<void> {
  if (!opportunityId) return;
  const current = await queryOne<{ stage_key: string; status: string }>(
    'SELECT stage_key, status FROM opportunities WHERE id = ?',
    [opportunityId],
  );
  if (!current || current.status !== 'open') return;
  if (current.stage_key !== 'attempted_contact' && current.stage_key !== 'new_lead') return;

  await moveStage({
    opportunityId,
    to: 'engaged_qualified',
    subStatus: 'engaged',
    actor: { ...SYSTEM_ACTOR, role: 'automation' },
    actingUserId: null,
  }).catch((err) => logger.warn('could not advance the card to engaged', { opportunityId, error: String(err) }));
}

async function route(input: WorkflowCInput, intent: IntentResult): Promise<string> {
  const context = await routingContext(input.contactId, input.opportunityId);

  switch (intent.intent) {
    case 'STOP':
      return handleStop(input.contactId, context.language);
    case 'PRICING':
      return handlePricing(input, context);
    case 'PAYMENT':
      return handlePricing(input, context); // payment plans live on the same verified row
    case 'LOCATION':
      return handleLocation(input, context);
    case 'BROCHURE':
      return handleBrochure(input, context);
    case 'CALL_ME':
      return handleCallMe(input, context);
    case 'STILL_INTERESTED':
      return handleStillInterested(input, context);
    case 'NOT_NOW':
      return handleNotNow(input, context);
    case 'APPT_CONFIRM':
    case 'APPT_RESCHEDULE':
      return handleAppointment(input, context, intent.intent);
    default:
      return handleUnknown(input, context);
  }
}

type RoutingContext = {
  language: 'en' | 'ar';
  leadName: string;
  projectName: string | null;
  ownerUserId: string | null;
};

async function routingContext(contactId: string, opportunityId: string | null): Promise<RoutingContext> {
  const contact = await queryOne<{ full_name: string | null; first_name: string | null; language: string; owner_user_id: string | null }>(
    'SELECT full_name, first_name, language, owner_user_id FROM contacts WHERE id = ?',
    [contactId],
  );
  const opportunity = opportunityId
    ? await queryOne<{ project_name: string | null; owner_user_id: string | null }>(
        'SELECT project_name, owner_user_id FROM opportunities WHERE id = ?',
        [opportunityId],
      )
    : null;

  const language = contact?.language === 'ar' ? 'ar' : 'en';
  return {
    language,
    leadName: contact?.first_name ?? contact?.full_name ?? (language === 'ar' ? 'عميلنا العزيز' : 'there'),
    projectName: opportunity?.project_name ?? null,
    ownerUserId: opportunity?.owner_user_id ?? contact?.owner_user_id ?? null,
  };
}

/** STOP: confirm, then add to DNC. */
async function handleStop(contactId: string, language: 'en' | 'ar'): Promise<string> {
  /*
   * Acknowledge first, suppress second.
   *
   * Once the contact is on the DNC list our own guards correctly refuse to
   * message them — including this confirmation. The acknowledgement is a direct
   * reply to the message they just sent, inside the open 24-hour window, and it
   * is what tells them the opt-out worked.
   */
  try {
    await sendWhatsApp({
      kind: 'text',
      contactId,
      automated: false,
      text:
        language === 'ar'
          ? 'تم إيقاف الرسائل. لن نتواصل معك مرة أخرى. إذا غيّرت رأيك، راسلنا في أي وقت.'
          : 'You have been unsubscribed and we will not message you again. If you change your mind, message us any time.',
    });
  } catch (err) {
    // A failed confirmation must never stop us honouring the opt-out itself.
    logger.warn('could not confirm the opt-out', { contactId, error: err instanceof Error ? err.message : String(err) });
  }

  await setDnc({ contactId, reason: 'Replied STOP on WhatsApp', actor: SYSTEM_ACTOR });
  await stopSequence(contactId, 'opted_out');
  return 'dnc_added_and_confirmed';
}

/** PRICING / PAYMENT: quote only from the verified projects table. */
async function handlePricing(input: WorkflowCInput, context: RoutingContext): Promise<string> {
  const project = await findVerifiedProject(context.projectName);
  const message = project ? pricingMessage(project, context.language) : null;

  if (!message) {
    // HARD RULE: never invent prices. Hand it to a human instead.
    await escalateToAgent(input, context, 'pricing_requested_no_verified_data');
    await sendWhatsApp({
      kind: 'text',
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      automated: true,
      text:
        context.language === 'ar'
          ? `شكراً ${context.leadName}. سيرسل لك مستشارنا الأسعار المحدّثة خلال دقائق.`
          : `Thanks ${context.leadName}. Your advisor will send you the current pricing within a few minutes.`,
    });
    return 'escalated_no_verified_pricing';
  }

  await sendWhatsApp({
    kind: 'buttons',
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    automated: true,
    body: message,
    buttons: [
      { id: 'BROCHURE', title: context.language === 'ar' ? 'الكتيب' : 'Brochure' },
      { id: 'LOCATION', title: context.language === 'ar' ? 'الموقع' : 'Location' },
      { id: 'CALL_ME', title: context.language === 'ar' ? 'اتصل بي' : 'Call me' },
    ],
  });
  await tag(input.contactId, 'intent', 'pricing');
  return 'sent_verified_pricing';
}

/** LOCATION: a real WhatsApp location message when we have coordinates. */
async function handleLocation(input: WorkflowCInput, context: RoutingContext): Promise<string> {
  const project = await findVerifiedProject(context.projectName);

  if (!project || !hasLocation(project)) {
    await escalateToAgent(input, context, 'location_requested_no_verified_data');
    return 'escalated_no_verified_location';
  }

  await sendWhatsApp({
    kind: 'location',
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    automated: true,
    latitude: Number(project.location_lat),
    longitude: Number(project.location_lng),
    name: project.name,
    ...(project.location_label ? { address: project.location_label } : {}),
  });
  return 'sent_location';
}

/** BROCHURE: the branded PDF as a document. */
async function handleBrochure(input: WorkflowCInput, context: RoutingContext): Promise<string> {
  const project = await findVerifiedProject(context.projectName);

  if (!project?.brochure_url) {
    await escalateToAgent(input, context, 'brochure_requested_no_verified_file');
    return 'escalated_no_brochure';
  }

  // Branded link: /b/{project}?a={agent} tracks opens and notifies the agent.
  const brandedUrl = context.ownerUserId
    ? `${project.brochure_url}${project.brochure_url.includes('?') ? '&' : '?'}a=${context.ownerUserId}`
    : project.brochure_url;

  await sendWhatsApp({
    kind: 'media',
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    automated: true,
    mediaKind: 'document',
    link: brandedUrl,
    filename: `${project.slug}.pdf`,
    caption: context.language === 'ar' ? `كتيب ${project.name}` : `${project.name} brochure`,
  });
  await tag(input.contactId, 'intent', 'brochure');
  return 'sent_brochure';
}

/** CALL_ME: urgent push, a 5-minute task and the `hot` tag. */
async function handleCallMe(input: WorkflowCInput, context: RoutingContext): Promise<string> {
  await tag(input.contactId, 'intent', 'hot');
  await tag(input.contactId, 'intent', 'call_me');

  if (context.ownerUserId) {
    await execute(
      `INSERT INTO tasks (id, contact_id, opportunity_id, assigned_user_id, type, title, priority, due_at)
       VALUES (?, ?, ?, ?, 'call', ?, 'urgent', DATE_ADD(NOW(3), INTERVAL 5 MINUTE))`,
      [newId(), input.contactId, input.opportunityId, context.ownerUserId, 'Call back — the lead asked to be called'],
    );
    const contact = await queryOne<{ phone_e164: string | null; full_name: string | null }>(
      'SELECT phone_e164, full_name FROM contacts WHERE id = ?',
      [input.contactId],
    );
    await pushToUser(context.ownerUserId, {
      title: 'Call request — call within 5 minutes',
      body: `${contact?.full_name ?? 'A lead'} asked to be called about ${context.projectName ?? 'their enquiry'}.`,
      link: `/contacts/${input.contactId}`,
      ...(contact?.phone_e164 ? { tel: `tel:${contact.phone_e164}` } : {}),
      priority: 'high',
    });
  }

  await sendWhatsApp({
    kind: 'text',
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    automated: true,
    text:
      context.language === 'ar'
        ? `تمام ${context.leadName}، سيتصل بك مستشارنا خلال دقائق.`
        : `Of course ${context.leadName}, your advisor will call you within a few minutes.`,
  });
  return 'call_requested';
}

async function handleStillInterested(input: WorkflowCInput, context: RoutingContext): Promise<string> {
  await tag(input.contactId, 'intent', 'engaged');
  await escalateToAgent(input, context, 'lead_still_interested');
  await sendWhatsApp({
    kind: 'text',
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    automated: true,
    text:
      context.language === 'ar'
        ? 'ممتاز! سيتواصل معك مستشارنا لمتابعة التفاصيل.'
        : 'Great — your advisor will pick this up with you shortly.',
  });
  return 'kept_open';
}

/** NOT_NOW: stop the sequence, keep the lead for long-term nurture. */
async function handleNotNow(input: WorkflowCInput, context: RoutingContext): Promise<string> {
  await stopSequence(input.contactId, 'lead_said_not_now');
  await tag(input.contactId, 'ops', 'nurture');

  if (input.opportunityId) {
    await moveStage({
      opportunityId: input.opportunityId,
      to: 'engaged_qualified',
      subStatus: 'nurture',
      actor: { ...SYSTEM_ACTOR, role: 'automation' },
      actingUserId: null,
    }).catch(() => undefined);
  }

  await sendWhatsApp({
    kind: 'text',
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    automated: true,
    text:
      context.language === 'ar'
        ? 'مفهوم تماماً. سنتواصل معك عند إطلاق مشاريع جديدة تناسبك.'
        : 'Understood. I will reach out when something that suits you launches.',
  });
  return 'moved_to_nurture';
}

async function handleAppointment(input: WorkflowCInput, context: RoutingContext, intent: Intent): Promise<string> {
  await escalateToAgent(input, context, intent === 'APPT_CONFIRM' ? 'appointment_confirmed' : 'appointment_reschedule_requested');

  if (intent === 'APPT_CONFIRM' && input.opportunityId) {
    await execute(`UPDATE opportunities SET sub_status = 'confirmed' WHERE id = ? AND stage_key = 'appointment_scheduled'`, [
      input.opportunityId,
    ]);
  }
  return intent === 'APPT_CONFIRM' ? 'appointment_confirmed' : 'appointment_reschedule_requested';
}

/**
 * Unknown: leave it for a human. After hours, send one auto-acknowledgement so
 * the lead knows they have been heard.
 */
async function handleUnknown(input: WorkflowCInput, context: RoutingContext): Promise<string> {
  await escalateToAgent(input, context, 'unrecognised_message');

  if (!isQuietHours()) return 'left_for_human';

  // One acknowledgement per contact per night, not per message.
  const alreadyAcknowledged = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages
      WHERE contact_id = ? AND direction = 'outbound' AND is_automated = 1
        AND JSON_EXTRACT(payload, '$.afterHoursAck') = true
        AND created_at > DATE_SUB(NOW(3), INTERVAL 12 HOUR)`,
    [input.contactId],
  );
  if (Number(alreadyAcknowledged?.n ?? 0) > 0) return 'left_for_human';

  await sendWhatsApp({
    kind: 'text',
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    automated: true,
    // The lead messaged us, so the window is open and the reply is expected.
    bypassQuietHours: true,
    text:
      context.language === 'ar'
        ? `شكراً ${context.leadName}. وصلت رسالتك وسيرد عليك مستشارنا صباحاً.`
        : `Thanks ${context.leadName} — we have your message and your advisor will reply first thing in the morning.`,
  });
  return 'after_hours_acknowledged';
}

/** Flag the conversation for the agent and push them. */
async function escalateToAgent(input: WorkflowCInput, context: RoutingContext, reason: string): Promise<void> {
  await withRetryingTransaction(async (tx) => {
    await addActivity(tx, {
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      type: 'conversation.needs_human',
      title: 'Handed to a human',
      body: reason,
      meta: { reason, messageId: input.messageId },
    });
    await writeAudit(
      {
        actor: SYSTEM_ACTOR,
        action: 'workflow.c.escalated',
        entityType: 'conversation',
        entityId: input.conversationId,
        after: { reason },
      },
      tx,
    );
  });

  if (context.ownerUserId) {
    await enqueue(
      'push.send',
      {
        userId: context.ownerUserId,
        title: 'New WhatsApp message',
        body: `${context.leadName} replied and needs an answer.`,
        link: `/inbox/${input.conversationId}`,
      },
      { priority: 2, dedupeKey: `push-inbound:${input.messageId}`, contactId: input.contactId },
    );
  }
}

async function tag(contactId: string, namespace: string, value: string): Promise<void> {
  await withRetryingTransaction(async (tx) => {
    await execute('INSERT IGNORE INTO tags (id, namespace, value, label) VALUES (?, ?, ?, ?)', [newId(), namespace, value, value], tx);
    const row = await queryOne<{ id: string }>('SELECT id FROM tags WHERE namespace = ? AND value = ?', [namespace, value], tx);
    if (row) await execute('INSERT IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)', [contactId, row.id], tx);
  });
}
