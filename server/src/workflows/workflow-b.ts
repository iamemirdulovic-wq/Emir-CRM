import { execute, queryOne, withRetryingTransaction } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { hours } from '../lib/time.js';
import { SYSTEM_ACTOR, writeAudit } from '../audit/audit.js';
import { addActivity } from '../ingestion/ingest.js';
import { cancelJobs, enqueue } from '../jobs/queue.js';
import { sendWhatsApp } from '../messaging/send.js';
import { sendEmail } from '../messaging/email/send.js';
import { templateNameFor } from '../messaging/templates/library.js';
import { findVerifiedProject, formatAed } from '../services/projects.js';
import { moveStage } from '../services/opportunities.js';
import { cancelRuns, findRunningRun, startRun, setStep, completeRun } from './runs.js';

/**
 * Workflow B — no-response follow-up.
 *
 * The 24-hour window is closed by definition here, so every WhatsApp step uses
 * an approved template:
 *   +2h   followup_2h  + a call task
 *   +24h  followup_24h (image header, starting price) + project email + call task
 *   +72h  followup_3d  (Still interested / Not now / Stop) + a "should I close
 *         your file?" email
 *   +96h  mark Lost (unresponsive) and move to long-term nurture
 *
 * Stop conditions: the lead replies on any channel, the stage moves past
 * Attempted Contact, the opportunity closes, or the lead opts out.
 */

export const STEPS = ['followup_2h', 'followup_24h', 'followup_3d', 'close_unresponsive'] as const;
export type Step = (typeof STEPS)[number];

const NEXT_STEP: Record<Step, { step: Step; delayMs: number } | null> = {
  followup_2h: { step: 'followup_24h', delayMs: hours(22) },   // 24h after the lead arrived
  followup_24h: { step: 'followup_3d', delayMs: hours(48) },   // 72h
  followup_3d: { step: 'close_unresponsive', delayMs: hours(24) }, // 96h
  close_unresponsive: null,
};

export type WorkflowBResult = {
  step: Step;
  action: 'sent' | 'skipped' | 'closed' | 'deferred';
  reason?: string;
};

/** Should this sequence still be running? */
export async function shouldContinue(contactId: string, opportunityId: string): Promise<{ ok: boolean; reason?: string }> {
  const opportunity = await queryOne<{ status: string; stage_key: string }>(
    'SELECT status, stage_key FROM opportunities WHERE id = ?',
    [opportunityId],
  );
  if (!opportunity) return { ok: false, reason: 'opportunity_gone' };
  if (opportunity.status !== 'open') return { ok: false, reason: 'opportunity_closed' };
  if (opportunity.stage_key !== 'new_lead' && opportunity.stage_key !== 'attempted_contact') {
    return { ok: false, reason: 'stage_moved_past_attempted_contact' };
  }

  const contact = await queryOne<{ dnc: number; last_inbound_at: Date | null }>(
    'SELECT dnc, last_inbound_at FROM contacts WHERE id = ?',
    [contactId],
  );
  if (!contact) return { ok: false, reason: 'contact_gone' };
  if (contact.dnc === 1) return { ok: false, reason: 'opted_out' };
  // Any reply at all cancels the sequence.
  if (contact.last_inbound_at) return { ok: false, reason: 'lead_replied' };

  return { ok: true };
}

export async function runWorkflowBStep(input: {
  contactId: string;
  opportunityId: string;
  step: Step;
}): Promise<WorkflowBResult> {
  const check = await shouldContinue(input.contactId, input.opportunityId);
  if (!check.ok) {
    await stopSequence(input.contactId, check.reason ?? 'stopped');
    return { step: input.step, action: 'skipped', reason: check.reason };
  }

  const run =
    (await findRunningRun(input.contactId, 'B_no_response_followup')) ??
    ({ id: await startRun({ workflowKey: 'B_no_response_followup', contactId: input.contactId, opportunityId: input.opportunityId }) } as {
      id: string;
      current_step?: string | null;
    });
  await setStep(run.id, input.step);

  const result = await executeStep(input);

  const next = NEXT_STEP[input.step];
  if (next && result.action !== 'closed') {
    await enqueue(
      'workflow.b.step',
      { contactId: input.contactId, opportunityId: input.opportunityId, step: next.step },
      {
        priority: 5,
        runAt: new Date(Date.now() + next.delayMs),
        dedupeKey: `wf-b:${input.opportunityId}:${next.step}`,
        contactId: input.contactId,
      },
    );
  } else if (!next) {
    await completeRun(run.id);
  }

  return result;
}

async function executeStep(input: { contactId: string; opportunityId: string; step: Step }): Promise<WorkflowBResult> {
  switch (input.step) {
    case 'followup_2h':
      return step2h(input.contactId, input.opportunityId);
    case 'followup_24h':
      return step24h(input.contactId, input.opportunityId);
    case 'followup_3d':
      return step3d(input.contactId, input.opportunityId);
    case 'close_unresponsive':
      return closeUnresponsive(input.contactId, input.opportunityId);
  }
}

type LeadContext = {
  language: 'en' | 'ar';
  leadName: string;
  agentName: string;
  agentUserId: string | null;
  projectName: string | null;
};

async function leadContext(contactId: string, opportunityId: string): Promise<LeadContext> {
  const contact = await queryOne<{ full_name: string | null; first_name: string | null; language: string }>(
    'SELECT full_name, first_name, language FROM contacts WHERE id = ?',
    [contactId],
  );
  const opportunity = await queryOne<{ project_name: string | null; owner_user_id: string | null }>(
    'SELECT project_name, owner_user_id FROM opportunities WHERE id = ?',
    [opportunityId],
  );
  const agent = opportunity?.owner_user_id
    ? await queryOne<{ name: string }>('SELECT name FROM users WHERE id = ?', [opportunity.owner_user_id])
    : null;

  const language = contact?.language === 'ar' ? 'ar' : 'en';
  return {
    language,
    leadName: contact?.first_name ?? contact?.full_name ?? (language === 'ar' ? 'عميلنا العزيز' : 'there'),
    agentName: agent?.name ?? (language === 'ar' ? 'فريق المبيعات' : 'our sales team'),
    agentUserId: opportunity?.owner_user_id ?? null,
    projectName: opportunity?.project_name ?? null,
  };
}

/** +2 hours: WhatsApp followup_2h and a call task. */
async function step2h(contactId: string, opportunityId: string): Promise<WorkflowBResult> {
  const ctx = await leadContext(contactId, opportunityId);
  const projectLabel = ctx.projectName ?? (ctx.language === 'ar' ? 'مشاريعنا' : 'our projects');

  const result = await sendWhatsApp({
    kind: 'template',
    contactId,
    opportunityId,
    automated: true,
    templateName: templateNameFor('followup_2h', ctx.language),
    templateLanguage: ctx.language,
    bodyParams: [ctx.leadName, ctx.agentName, projectLabel],
    buttonPayloads: ['CALL_ME', 'PRICING'],
    bodyPreview: `Follow-up (2h) about ${projectLabel}`,
  });

  await createCallTask(contactId, opportunityId, ctx.agentUserId, 'Call the lead — no response after 2 hours', 'high');
  await markAttempted(contactId, opportunityId);

  return handleSendResult('followup_2h', result, contactId, opportunityId, 'followup_2h');
}

/** +24 hours: followup_24h with the verified starting price, plus a project email. */
async function step24h(contactId: string, opportunityId: string): Promise<WorkflowBResult> {
  const ctx = await leadContext(contactId, opportunityId);
  const project = await findVerifiedProject(ctx.projectName);

  // HARD RULE: the price variable may only come from a verified project row. If
  // there is none, send the 2h template again rather than invent a figure.
  const startingPrice = formatAed(project?.starting_price_aed ?? null);
  const projectLabel = project?.name ?? ctx.projectName ?? (ctx.language === 'ar' ? 'مشاريعنا' : 'our projects');

  const result = startingPrice
    ? await sendWhatsApp({
        kind: 'template',
        contactId,
        opportunityId,
        automated: true,
        templateName: templateNameFor('followup_24h', ctx.language),
        templateLanguage: ctx.language,
        bodyParams: [ctx.leadName, projectLabel, startingPrice],
        ...(project?.image_url ? { header: { kind: 'image' as const, link: project.image_url } } : {}),
        buttonPayloads: ['PRICING', 'CALL_ME'],
        bodyPreview: `Follow-up (24h): ${projectLabel} from AED ${startingPrice}`,
      })
    : await sendWhatsApp({
        kind: 'template',
        contactId,
        opportunityId,
        automated: true,
        templateName: templateNameFor('followup_2h', ctx.language),
        templateLanguage: ctx.language,
        bodyParams: [ctx.leadName, ctx.agentName, projectLabel],
        buttonPayloads: ['CALL_ME', 'PRICING'],
        bodyPreview: `Follow-up (24h) about ${projectLabel}`,
      });

  if (!startingPrice) {
    logger.info('no verified price for this project; sent the generic follow-up instead', { opportunityId });
  }

  await sendEmail({
    contactId,
    opportunityId,
    automated: true,
    subject: `${projectLabel} — details and availability`,
    text: buildProjectEmail(ctx, project, startingPrice),
  });

  await createCallTask(contactId, opportunityId, ctx.agentUserId, 'Call the lead — no response after 24 hours', 'high');
  return handleSendResult('followup_24h', result, contactId, opportunityId, 'followup_24h');
}

/** +72 hours: the "still interested?" template and email. */
async function step3d(contactId: string, opportunityId: string): Promise<WorkflowBResult> {
  const ctx = await leadContext(contactId, opportunityId);
  const projectLabel = ctx.projectName ?? (ctx.language === 'ar' ? 'مشاريعنا' : 'our projects');

  const result = await sendWhatsApp({
    kind: 'template',
    contactId,
    opportunityId,
    automated: true,
    templateName: templateNameFor('followup_3d', ctx.language),
    templateLanguage: ctx.language,
    bodyParams: [ctx.leadName, projectLabel],
    buttonPayloads: ['STILL_INTERESTED', 'NOT_NOW', 'STOP'],
    bodyPreview: `Follow-up (3d): still interested in ${projectLabel}?`,
  });

  await sendEmail({
    contactId,
    opportunityId,
    automated: true,
    subject: 'Should I close your file?',
    text:
      `Hello ${ctx.leadName},\n\n` +
      `I have not managed to reach you about ${projectLabel}, and I do not want to keep messaging if the timing is not right.\n\n` +
      `Just reply "yes" and I will keep your file open, or "no" and I will close it and stop following up.\n\n` +
      `${ctx.agentName}\nEmir Real Estate`,
  });

  return handleSendResult('followup_3d', result, contactId, opportunityId, 'followup_3d');
}

/** +96 hours: mark Lost (unresponsive) and move to long-term nurture. */
async function closeUnresponsive(contactId: string, opportunityId: string): Promise<WorkflowBResult> {
  await moveStage({
    opportunityId,
    to: 'lost',
    lostReason: 'unresponsive',
    lostNote: 'Closed automatically after four days with no response.',
    actor: { ...SYSTEM_ACTOR, role: 'automation' },
    actingUserId: null,
  });

  await withRetryingTransaction(async (tx) => {
    await execute('INSERT IGNORE INTO tags (id, namespace, value, label) VALUES (?, ?, ?, ?)', [
      newId(),
      'ops',
      'nurture',
      'Long-term nurture',
    ], tx);
    const tag = await queryOne<{ id: string }>('SELECT id FROM tags WHERE namespace = ? AND value = ?', ['ops', 'nurture'], tx);
    if (tag) await execute('INSERT IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)', [contactId, tag.id], tx);

    await addActivity(tx, {
      contactId,
      opportunityId,
      type: 'workflow.b.closed',
      title: 'Closed as unresponsive and moved to long-term nurture',
    });
  });

  await cancelRuns({ contactId, workflowKey: 'B_no_response_followup', reason: 'closed_unresponsive' });
  logger.info('workflow B closed a lead as unresponsive', { opportunityId });
  return { step: 'close_unresponsive', action: 'closed' };
}

function buildProjectEmail(ctx: LeadContext, project: Awaited<ReturnType<typeof findVerifiedProject>>, price: string | null): string {
  const lines = [`Hello ${ctx.leadName},`, ''];
  if (project) {
    lines.push(`${project.name} by ${project.developer}${project.area ? `, ${project.area}` : ''}.`);
    // Only verified figures appear here.
    if (price) lines.push(`Starting from AED ${price}.`);
    if (project.payment_plan) lines.push(`Payment plan: ${project.payment_plan}.`);
    if (project.handover_date) lines.push(`Handover: ${project.handover_date}.`);
    if (project.golden_visa_eligible === 1) lines.push('Eligible for the Golden Visa.');
    if (project.brochure_url) lines.push('', `Brochure: ${project.brochure_url}`);
  } else {
    lines.push('I would be glad to send you the current availability and payment plans.');
  }
  lines.push('', 'Reply here or on WhatsApp and I will take it from there.', '', ctx.agentName, 'Emir Real Estate');
  return lines.join('\n');
}

async function handleSendResult(
  step: Step,
  result: Awaited<ReturnType<typeof sendWhatsApp>>,
  contactId: string,
  opportunityId: string,
  templateBase: string,
): Promise<WorkflowBResult> {
  if ('sent' in result && result.sent) return { step, action: 'sent' };

  if ('blocked' in result) {
    if (result.retryable && result.blocked.deferUntil) {
      // Quiet hours or an agent takeover: try again when it lifts.
      await enqueue(
        'workflow.b.step',
        { contactId, opportunityId, step },
        {
          priority: 5,
          runAt: result.blocked.deferUntil,
          dedupeKey: `wf-b:${opportunityId}:${step}:deferred`,
          contactId,
        },
      );
      return { step, action: 'deferred', reason: result.blocked.reason };
    }
    return { step, action: 'skipped', reason: result.blocked.reason };
  }

  // The provider rejected it — most often Meta's marketing limits. Email instead.
  logger.info('WhatsApp follow-up failed; falling back to email', { opportunityId, step, templateBase });
  const ctx = await leadContext(contactId, opportunityId);
  await sendEmail({
    contactId,
    opportunityId,
    automated: true,
    subject: `Following up on ${ctx.projectName ?? 'your enquiry'}`,
    text:
      `Hello ${ctx.leadName},\n\n` +
      `I tried to reach you on WhatsApp about ${ctx.projectName ?? 'your enquiry'}. ` +
      `Reply here and I will send the details straight away.\n\n${ctx.agentName}\nEmir Real Estate`,
  });
  return { step, action: 'sent', reason: 'whatsapp_failed_email_fallback' };
}

async function createCallTask(
  contactId: string,
  opportunityId: string,
  assignedUserId: string | null,
  title: string,
  priority: 'normal' | 'high' | 'urgent',
): Promise<void> {
  if (!assignedUserId) return;
  await execute(
    `INSERT INTO tasks (id, contact_id, opportunity_id, assigned_user_id, type, title, priority, due_at)
     VALUES (?, ?, ?, ?, 'call', ?, ?, NOW(3))`,
    [newId(), contactId, opportunityId, assignedUserId, title, priority],
  );
}

/** Nudge the card into Attempted Contact and count the attempt. */
async function markAttempted(contactId: string, opportunityId: string): Promise<void> {
  const current = await queryOne<{ stage_key: string; sub_status: string | null }>(
    'SELECT stage_key, sub_status FROM opportunities WHERE id = ?',
    [opportunityId],
  );
  if (!current || current.stage_key !== 'new_lead') return;

  await moveStage({
    opportunityId,
    to: 'attempted_contact',
    subStatus: 'attempt_1',
    actor: { ...SYSTEM_ACTOR, role: 'automation' },
    actingUserId: null,
  }).catch((err) => logger.warn('could not move the card to attempted contact', { opportunityId, error: String(err) }));

  await writeAudit({
    actor: SYSTEM_ACTOR,
    action: 'workflow.b.attempted',
    entityType: 'opportunity',
    entityId: opportunityId,
    after: { contactId },
  });
}

/** Cancel every remaining step of the sequence. */
export async function stopSequence(contactId: string, reason: string): Promise<void> {
  const cancelled = await cancelJobs({ contactId, types: ['workflow.b.step'], reason });
  await cancelRuns({ contactId, workflowKey: 'B_no_response_followup', reason });
  if (cancelled > 0) {
    logger.info('workflow B stopped', { contactId, reason, cancelledJobs: cancelled });
  }
}
