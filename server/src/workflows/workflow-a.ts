import type { PoolConnection } from 'mysql2/promise';
import { execute, queryOne, query, withRetryingTransaction } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger, errorContext } from '../lib/logger.js';
import { dubaiParts } from '../lib/time.js';
import { SYSTEM_ACTOR, writeAudit } from '../audit/audit.js';
import { addActivity } from '../ingestion/ingest.js';
import { enqueue } from '../jobs/queue.js';
import { routingSettings } from '../routing/settings.js';
import { parseClock, slaDeadline } from '../routing/hours.js';
import { notify, notifyManagers } from '../messaging/notify.js';
import { recordBounceForAlerting } from '../routing/storm.js';
import { emailOwnersAboutLead } from '../routing/new-lead-email.js';
import {
  bounceLead, clearStickyOwner, decideSla, hasActed, recordAssignment, recordFirstAction,
} from '../routing/assignments.js';
import { pushToManagers, pushToUser } from '../messaging/push.js';
import { sendWhatsApp } from '../messaging/send.js';
import { sendEmail } from '../messaging/email/send.js';
import { templateNameFor } from '../messaging/templates/library.js';
import { findVerifiedProject } from '../services/projects.js';
import { chooseAgent, type Candidate } from './assignment.js';
import { startRunOnce, setStep, completeRun, failRun } from './runs.js';
import { COMPANY_NAME, COMPANY_LOCALITY_EN } from '../config/constants.js';

/**
 * Workflow A — Instant capture. Target: under 30 seconds end to end.
 *
 *  1. assign the lead (sticky owner, else weighted round-robin)
 *  2. send the approved WhatsApp template lead_welcome_{lang}
 *  3. push the agent with a deep link and a click-to-call link
 *  4. async: score, tag, report the CAPI Lead event, arm Workflow B
 *  5. SLA at 5 minutes: if untouched, reassign, alert the manager, tag sla-breach
 */

export type WorkflowAInput = {
  opportunityId: string;
  contactId: string;
  /** Skip the template step and reply free-form: used for inbound WhatsApp,
   *  where the 24-hour window is already open. */
  skipWelcomeTemplate?: boolean;
};

export type WorkflowAResult = {
  assignedUserId: string | null;
  assignmentReason: string;
  welcomeSent: boolean;
  welcomeChannel: 'whatsapp' | 'email' | 'none';
  pushed: number;
};

export async function runWorkflowA(input: WorkflowAInput): Promise<WorkflowAResult> {
  /*
   * Exactly once per opportunity. A lead must never receive two welcome
   * messages, and this can be reached more than once: a worker that dies after
   * sending but before marking the job done retries it, and a caller may run it
   * directly while the queued job is still pending.
   *
   * The claim is a unique-key INSERT, so it is atomic — a read-then-write check
   * loses this race under concurrency.
   */
  const runId = await startRunOnce({
    workflowKey: 'A_instant_capture',
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    context: { skipWelcomeTemplate: Boolean(input.skipWelcomeTemplate) },
    singletonKey: `A:${input.opportunityId}`,
  });

  if (runId === null) {
    const owner = await queryOne<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM opportunities WHERE id = ?',
      [input.opportunityId],
    );
    logger.info('workflow A already claimed for this opportunity; skipping', { opportunityId: input.opportunityId });
    return {
      assignedUserId: owner?.owner_user_id ?? null,
      assignmentReason: 'already_run',
      welcomeSent: false,
      welcomeChannel: 'none',
      pushed: 0,
    };
  }

  try {
    await setStep(runId, 'assign');
    const assignment = await assignLead(input.opportunityId, input.contactId);

    await setStep(runId, 'welcome');
    const welcome = input.skipWelcomeTemplate
      ? { sent: false, channel: 'none' as const }
      : await sendWelcome(input.contactId, input.opportunityId, assignment.userId);

    await setStep(runId, 'push');
    const pushed = assignment.userId ? await notifyAgent(assignment.userId, input.contactId, input.opportunityId) : 0;

    /*
     * The owners hear about it by email, because they are in a meeting or in
     * the car, not in the CRM. Never allowed to fail the workflow: a lead that
     * arrived and was answered is a success whatever the mail server did.
     */
    void emailOwnersAboutLead({
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      assignedToName: assignment.userId
        ? (await queryOne<{ name: string }>('SELECT name FROM users WHERE id = ?', [assignment.userId]))?.name ?? null
        : null,
    }).catch((err: unknown) => logger.warn('new-lead email failed', errorContext(err)));

    await setStep(runId, 'async');
    await scheduleAsyncWork(input, assignment.userId);

    await completeRun(runId);
    return {
      assignedUserId: assignment.userId,
      assignmentReason: assignment.reason,
      welcomeSent: welcome.sent,
      welcomeChannel: welcome.channel,
      pushed,
    };
  } catch (err) {
    await failRun(runId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Step 1 — assignment
// ---------------------------------------------------------------------------

type AssignmentOutcome = { userId: string | null; reason: string };

/**
 * Pick and record the owner.
 *
 * The whole selection runs inside one transaction holding `SELECT … FOR UPDATE`
 * on the assignment cursor, so two leads arriving together cannot both be
 * handed to the same agent and skew the split.
 */
export async function assignLead(opportunityId: string, contactId: string): Promise<AssignmentOutcome> {
  return withRetryingTransaction(async (tx) => {
    const opportunity = await queryOne<{
      id: string;
      owner_user_id: string | null;
      project_name: string | null;
      contact_id: string;
    }>('SELECT id, owner_user_id, project_name, contact_id FROM opportunities WHERE id = ? FOR UPDATE', [opportunityId], tx);
    if (!opportunity) throw new Error(`Opportunity ${opportunityId} not found`);

    const contact = await queryOne<{ owner_user_id: string | null; language: string }>(
      'SELECT owner_user_id, language FROM contacts WHERE id = ?',
      [contactId],
      tx,
    );

    // Sticky owner first: a returning lead stays with their agent.
    const sticky = opportunity.owner_user_id ?? contact?.owner_user_id ?? null;
    if (sticky) {
      await applyAssignment(tx, { opportunityId, contactId, userId: sticky, reason: 'sticky_owner' });
      return { userId: sticky, reason: 'sticky_owner' };
    }

    // Serialize the round-robin on a single row.
    await queryOne('SELECT id FROM assignment_state WHERE id = ? FOR UPDATE', ['round_robin'], tx);

    const candidates = await loadCandidates(tx);
    const choice = chooseAgent(candidates, {
      language: contact?.language ?? null,
      projectName: opportunity.project_name,
      dubaiMinutes: dubaiMinutesNow(),
    });

    if (!choice.assigned) {
      // Nobody available: queue it and alert the managers rather than dropping it.
      await execute(
        `INSERT INTO unassigned_queue (id, opportunity_id, contact_id, reason)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE reason = VALUES(reason), resolved_at = NULL`,
        [newId(), opportunityId, contactId, choice.reason],
        tx,
      );
      await addActivity(tx, {
        contactId,
        opportunityId,
        type: 'lead.unassigned',
        title: 'No agent was available; added to the unassigned queue',
        meta: { reason: choice.reason },
      });
      await writeAudit(
        { actor: SYSTEM_ACTOR, action: 'lead.unassigned', entityType: 'opportunity', entityId: opportunityId, after: { reason: choice.reason } },
        tx,
      );
      await enqueue(
        'push.send',
        { audience: 'managers', title: 'Unassigned lead', body: 'A new lead could not be assigned to any agent.', link: '/unassigned' },
        { priority: 1, dedupeKey: `unassigned-alert:${opportunityId}` },
        tx,
      );
      return { userId: null, reason: choice.reason };
    }

    await applyAssignment(tx, { opportunityId, contactId, userId: choice.userId, reason: choice.reason });
    await execute(
      `UPDATE assignment_state SET cursor_user_id = ? WHERE id = 'round_robin'`,
      [choice.userId],
      tx,
    );
    return { userId: choice.userId, reason: choice.reason };
  });
}

async function applyAssignment(
  tx: PoolConnection,
  input: { opportunityId: string; contactId: string; userId: string; reason: string; assignedByUserId?: string | null },
): Promise<void> {
  /*
   * accepted_at is cleared along with the new owner: a lead handed to someone
   * else has not been accepted by them, and leaving the old agent's tick there
   * would stop the new agent's clock before it started.
   */
  await execute(
    'UPDATE opportunities SET owner_user_id = ?, assigned_at = NOW(3), accepted_at = NULL WHERE id = ?',
    [input.userId, input.opportunityId],
    tx,
  );
  await recordAssignment(tx, {
    opportunityId: input.opportunityId,
    contactId: input.contactId,
    agentUserId: input.userId,
    assignedByUserId: input.assignedByUserId ?? null,
  });
  // The sticky owner is set once; later inquiries return to the same agent.
  await execute('UPDATE contacts SET owner_user_id = COALESCE(owner_user_id, ?) WHERE id = ?', [
    input.userId,
    input.contactId,
  ], tx);
  await execute('UPDATE conversations SET assigned_user_id = COALESCE(assigned_user_id, ?) WHERE contact_id = ?', [
    input.userId,
    input.contactId,
  ], tx);
  await execute('UPDATE unassigned_queue SET resolved_at = NOW(3) WHERE opportunity_id = ? AND resolved_at IS NULL', [
    input.opportunityId,
  ], tx);

  await addActivity(tx, {
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    type: 'lead.assigned',
    title: `Assigned by ${input.reason.replace(/_/g, ' ')}`,
    meta: { userId: input.userId, reason: input.reason },
  });
  await writeAudit(
    {
      actor: SYSTEM_ACTOR,
      action: 'lead.assigned',
      entityType: 'opportunity',
      entityId: input.opportunityId,
      after: { ownerUserId: input.userId, reason: input.reason },
    },
    tx,
  );
}

async function loadCandidates(tx: PoolConnection): Promise<Candidate[]> {
  const rows = await query<{
    id: string;
    name: string;
    is_active: number;
    availability: 'available' | 'busy' | 'off';
    shift_start: string | null;
    shift_end: string | null;
    languages: unknown;
    projects_covered: unknown;
    routing_weight: number;
    assigned_count: number;
  }>(
    `SELECT u.id, u.name, u.is_active, u.availability, u.shift_start, u.shift_end,
            u.languages, u.projects_covered, u.routing_weight,
            (SELECT COUNT(*) FROM opportunities o
              WHERE o.owner_user_id = u.id AND o.assigned_at > DATE_SUB(NOW(3), INTERVAL 7 DAY)) AS assigned_count
       FROM users u
      WHERE u.role = 'agent' AND u.is_active = 1`,
    [],
    tx,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isActive: row.is_active === 1,
    availability: row.availability,
    shiftStart: row.shift_start,
    shiftEnd: row.shift_end,
    languages: parseJsonArray(row.languages),
    projectsCovered: parseJsonArray(row.projects_covered),
    weight: row.routing_weight,
    assignedCount: Number(row.assigned_count ?? 0),
  }));
}

function parseJsonArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function dubaiMinutesNow(): number {
  const parts = dubaiParts();
  return parts.hour * 60 + parts.minute;
}

// ---------------------------------------------------------------------------
// Step 2 — the welcome message
// ---------------------------------------------------------------------------

async function sendWelcome(
  contactId: string,
  opportunityId: string,
  agentUserId: string | null,
): Promise<{ sent: boolean; channel: 'whatsapp' | 'email' | 'none' }> {
  const contact = await queryOne<{ full_name: string | null; first_name: string | null; language: string; email: string | null }>(
    'SELECT full_name, first_name, language, email FROM contacts WHERE id = ?',
    [contactId],
  );
  const opportunity = await queryOne<{ project_name: string | null }>(
    'SELECT project_name FROM opportunities WHERE id = ?',
    [opportunityId],
  );
  const agent = agentUserId
    ? await queryOne<{ name: string }>('SELECT name FROM users WHERE id = ?', [agentUserId])
    : null;

  const language = contact?.language === 'ar' ? 'ar' : 'en';
  const templateName = templateNameFor('lead_welcome', language);
  const projectName = opportunity?.project_name ?? (language === 'ar' ? 'مشاريعنا' : 'our projects');
  const leadName = contact?.first_name ?? contact?.full_name ?? (language === 'ar' ? 'عميلنا العزيز' : 'there');
  const agentName = agent?.name ?? (language === 'ar' ? 'فريق المبيعات' : 'our sales team');
  const company = COMPANY_NAME;

  const approved = await queryOne<{ status: string }>(
    'SELECT status FROM wa_templates WHERE name = ? AND language = ?',
    [templateName, language],
  );
  if (approved && approved.status !== 'APPROVED') {
    logger.warn('welcome template is not approved; falling back to email', { templateName, status: approved.status });
    return sendWelcomeEmail(contactId, opportunityId, leadName, projectName, agentName);
  }

  // A verified project gives us a branded brochure to attach as the header.
  const project = await findVerifiedProject(opportunity?.project_name ?? null);
  const brochureLink = project?.brochure_url ?? null;

  const result = await sendWhatsApp({
    kind: 'template',
    contactId,
    opportunityId,
    automated: true,
    // The instant reply is the one automated message allowed during quiet hours.
    bypassQuietHours: true,
    templateName,
    templateLanguage: language,
    bodyParams: [leadName, projectName, agentName, company],
    ...(brochureLink
      ? { header: { kind: 'document' as const, link: brochureLink, filename: `${project?.slug ?? 'brochure'}.pdf` } }
      : {}),
    buttonPayloads: ['PRICING', 'LOCATION', 'CALL_ME'],
    bodyPreview:
      language === 'ar'
        ? `مرحباً ${leadName}، شكراً لاهتمامك بمشروع ${projectName}.`
        : `Hello ${leadName}, thank you for your interest in ${projectName}.`,
  });

  if ('sent' in result && result.sent) return { sent: true, channel: 'whatsapp' };

  // No WhatsApp consent, or the send failed: fall back to email.
  logger.info('welcome WhatsApp did not send; trying email', { contactId });
  return sendWelcomeEmail(contactId, opportunityId, leadName, projectName, agentName);
}

async function sendWelcomeEmail(
  contactId: string,
  opportunityId: string,
  leadName: string,
  projectName: string,
  agentName: string,
): Promise<{ sent: boolean; channel: 'whatsapp' | 'email' | 'none' }> {
  const result = await sendEmail({
    contactId,
    opportunityId,
    automated: true,
    bypassQuietHours: true,
    subject: `Thank you for your interest in ${projectName}`,
    text:
      `Hello ${leadName},\n\n` +
      `Thank you for your enquiry about ${projectName}. My name is ${agentName} and I will be looking after it personally.\n\n` +
      `I will call you shortly. If it is easier, simply reply to this email with a good time to reach you.\n\n` +
      `${agentName}\n${COMPANY_NAME} — ${COMPANY_LOCALITY_EN}`,
  });
  return { sent: 'sent' in result && result.sent, channel: 'sent' in result && result.sent ? 'email' : 'none' };
}

// ---------------------------------------------------------------------------
// Step 3 — notify the agent
// ---------------------------------------------------------------------------

export async function notifyAgent(agentUserId: string, contactId: string, opportunityId: string): Promise<number> {
  const contact = await queryOne<{ full_name: string | null; phone_e164: string | null; language: string }>(
    'SELECT full_name, phone_e164, language FROM contacts WHERE id = ?',
    [contactId],
  );
  const opportunity = await queryOne<{ project_name: string | null; source: string }>(
    'SELECT project_name, source FROM opportunities WHERE id = ?',
    [opportunityId],
  );

  return pushToUser(agentUserId, {
    title: 'New lead — respond within 5 minutes',
    body: `${contact?.full_name ?? 'A new lead'} · ${opportunity?.project_name ?? 'no project named'} · via ${opportunity?.source ?? 'unknown'}`,
    link: `/contacts/${contactId}`,
    ...(contact?.phone_e164 ? { tel: `tel:${contact.phone_e164}` } : {}),
    data: { opportunityId, contactId },
    priority: 'high',
  });
}

// ---------------------------------------------------------------------------
// Steps 4 & 5 — async work and the SLA timer
// ---------------------------------------------------------------------------

async function scheduleAsyncWork(input: WorkflowAInput, assignedUserId: string | null): Promise<void> {
  await enqueue('lead.score', { opportunityId: input.opportunityId, contactId: input.contactId }, {
    priority: 4,
    dedupeKey: `score:${input.opportunityId}:initial`,
    contactId: input.contactId,
  });

  await enqueue(
    'capi.send_event',
    { opportunityId: input.opportunityId, contactId: input.contactId, eventName: 'valid_lead' },
    { priority: 6, dedupeKey: `capi:${input.opportunityId}:valid_lead`, contactId: input.contactId },
  );

  // Workflow B's first step, two hours out.
  await enqueue(
    'workflow.b.step',
    { opportunityId: input.opportunityId, contactId: input.contactId, step: 'followup_2h' },
    {
      priority: 5,
      runAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      dedupeKey: `wf-b:${input.opportunityId}:followup_2h`,
      contactId: input.contactId,
    },
  );

  // The clock on accepting it. Its length is a setting the owner controls.
  if (assignedUserId) {
    await armSlaTimer({
      opportunityId: input.opportunityId,
      contactId: input.contactId,
      assignedUserId,
      phase: 'accept',
    });
  }
}

export type SlaPhase = 'accept' | 'action';

/**
 * Start the clock on an agent.
 *
 * Two phases, two separate jobs, because they have separate deadlines: a lead
 * accepted at minute one still has the full window to be acted on, and a
 * single timer would bounce it at minute five while the agent was within
 * their time. The dedupe keys differ for the same reason — one must not
 * swallow the other.
 */
export async function armSlaTimer(input: {
  opportunityId: string;
  contactId: string;
  assignedUserId: string;
  phase: SlaPhase;
}): Promise<{ deadline: Date; deferred: boolean }> {
  const settings = await routingSettings();
  const now = new Date();

  /*
   * A job at an exact time rather than a sweep every thirty seconds. The
   * deadline is known the moment the lead is assigned, so the cheapest
   * correct thing is to ask to be woken then — no polling, and the bounce
   * lands on the second rather than up to half a minute late.
   */
  const { deadline, deferred } = slaDeadline(now, settings.slaMinutes, quietHoursOf(settings));

  await enqueue(
    'workflow.a.sla_check',
    {
      opportunityId: input.opportunityId,
      contactId: input.contactId,
      assignedUserId: input.assignedUserId,
      phase: input.phase,
    },
    {
      priority: 2,
      runAt: deadline,
      dedupeKey: `sla:${input.opportunityId}:${input.phase}`,
      contactId: input.contactId,
    },
  );

  /*
   * The nudge. It was a setting with nothing behind it until now — an owner
   * could choose three minutes and no agent was ever reminded. Armed as its
   * own job so it can be cancelled independently, and skipped entirely when
   * there is no room for it before the deadline.
   */
  if (settings.reminderMinutes > 0) {
    const remindAt = new Date(deadline.getTime() - settings.reminderMinutes * 60 * 1000);
    if (remindAt.getTime() > now.getTime() + 5_000) {
      await enqueue(
        'workflow.a.sla_reminder',
        {
          opportunityId: input.opportunityId,
          contactId: input.contactId,
          assignedUserId: input.assignedUserId,
          phase: input.phase,
        },
        {
          priority: 2,
          runAt: remindAt,
          dedupeKey: `sla-reminder:${input.opportunityId}:${input.phase}`,
          contactId: input.contactId,
        },
      ).catch((err: unknown) => logger.warn('could not arm the reminder', errorContext(err)));
    }
  }

  return { deadline, deferred };
}

/** The quiet window, or null when the owner has switched it off. */
function quietHoursOf(settings: { quietHours: boolean; quietStart: string; quietEnd: string }) {
  if (!settings.quietHours) return null;
  return {
    startMinute: parseClock(settings.quietStart, 22 * 60),
    endMinute: parseClock(settings.quietEnd, 8 * 60),
  };
}

/**
 * "Two minutes left." Sent only if the lead is still sitting there.
 *
 * Deliberately quiet about the ones that no longer need it: an agent who
 * accepted the lead a minute ago does not want to be told they are about to
 * lose it, and a nudge that arrives after the fact teaches people to ignore
 * nudges.
 */
export async function runSlaReminder(input: {
  opportunityId: string;
  contactId: string;
  assignedUserId: string;
  phase?: SlaPhase;
}): Promise<{ sent: boolean; why: string }> {
  const phase: SlaPhase = input.phase ?? 'accept';
  const opportunity = await queryOne<{
    owner_user_id: string | null;
    accepted_at: Date | null;
    first_touch_at: Date | null;
    status: string;
    title: string | null;
  }>(
    `SELECT owner_user_id, accepted_at, first_touch_at, status, title
       FROM opportunities WHERE id = ? AND deleted_at IS NULL`,
    [input.opportunityId],
  );

  if (!opportunity) return { sent: false, why: 'gone' };
  if (opportunity.status !== 'open') return { sent: false, why: 'closed' };
  if (opportunity.owner_user_id !== input.assignedUserId) return { sent: false, why: 'owner_changed' };
  if (phase === 'accept' && opportunity.accepted_at) return { sent: false, why: 'accepted' };
  if (opportunity.first_touch_at) return { sent: false, why: 'acted' };

  const acted = await hasActed({
    opportunityId: input.opportunityId,
    contactId: input.contactId,
    since: phase === 'action' ? opportunity.accepted_at : null,
  });
  if (acted.acted) return { sent: false, why: 'acted' };

  const { reminderMinutes } = await routingSettings();
  await notify({
    userId: input.assignedUserId,
    type: 'sla_reminder',
    title: `${reminderMinutes} minute${reminderMinutes === 1 ? '' : 's'} left`,
    body: `${opportunity.title ?? 'Your new lead'} goes back to the owner if you do not call.`,
    link: `/contacts/${input.contactId}`,
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    priority: 'high',
  }).catch((err: unknown) => logger.warn('could not send the SLA reminder', errorContext(err)));

  return { sent: true, why: 'reminded' };
}

/**
 * The SLA check: if the agent has not picked the lead up, hand it back.
 *
 * Where it used to pass the lead quietly to the next agent, it now returns it
 * to Incoming for an owner to place — unless the owner has turned that off.
 * A lead passed round four people in twenty minutes looks like it is being
 * worked and is nobody's responsibility.
 */
export async function runSlaCheck(input: {
  opportunityId: string;
  contactId: string;
  assignedUserId: string;
  /** Older queued jobs carry no phase; they are the accept clock. */
  phase?: SlaPhase;
}): Promise<{ breached: boolean; reassignedTo?: string | null; bounced?: boolean }> {
  const phase: SlaPhase = input.phase ?? 'accept';
  const opportunity = await queryOne<{
    id: string;
    owner_user_id: string | null;
    first_touch_at: Date | null;
    accepted_at: Date | null;
    stage_key: string;
    status: string;
    assigned_at: Date | null;
    title: string | null;
  }>(
    `SELECT id, owner_user_id, first_touch_at, accepted_at, stage_key, status, assigned_at, title
       FROM opportunities WHERE id = ?`,
    [input.opportunityId],
  );
  if (!opportunity) return { breached: false };

  const acted = await hasActed({
    opportunityId: input.opportunityId,
    contactId: input.contactId,
    since: phase === 'action' ? opportunity.accepted_at : null,
  });

  // The decision itself lives in routing/assignments.ts, where every case is
  // written down in a test. This function does the reading and the writing.
  const verdict = decideSla({
    phase,
    open: opportunity.status === 'open',
    ownedByTimerAgent: opportunity.owner_user_id === input.assignedUserId,
    acceptedAt: opportunity.accepted_at,
    acted: acted.acted,
    firstTouchAt: opportunity.first_touch_at,
  });

  if (verdict.act === 'ignore') return { breached: false };
  if (verdict.act === 'record') {
    if (acted.at) {
      await recordFirstAction({
        opportunityId: input.opportunityId,
        agentUserId: input.assignedUserId,
        at: acted.at,
        assignedAt: opportunity.assigned_at,
      }).catch((err: unknown) => logger.warn('could not record the first action time', errorContext(err)));
    }
    return { breached: false };
  }

  logger.warn('speed-to-lead SLA breached', {
    opportunityId: input.opportunityId,
    agentUserId: input.assignedUserId,
    phase,
    why: verdict.why,
  });

  const { bounceToOwner } = await routingSettings();
  if (bounceToOwner) {
    const agent = await queryOne<{ name: string }>('SELECT name FROM users WHERE id = ?', [input.assignedUserId]);
    await withRetryingTransaction(async (tx) => {
      await bounceLead(tx, {
        opportunityId: input.opportunityId,
        contactId: input.contactId,
        agentUserId: input.assignedUserId,
        agentName: agent?.name ?? null,
      });
      await clearStickyOwner(tx, input.contactId, input.assignedUserId);
      await writeAudit(
        {
          actor: SYSTEM_ACTOR,
          action: 'lead.bounced',
          entityType: 'opportunity',
          entityId: input.opportunityId,
          before: { ownerUserId: input.assignedUserId },
          after: { ownerUserId: null, phase },
        },
        tx,
      );
      await tagOps(tx, input.contactId, 'sla-breach');
    });

    /*
     * After an outage the worker runs a queue of expired timers in seconds,
     * and every one of them is a real bounce wanting to tell somebody. Seven
     * buzzes in four seconds gets the phone silenced, and the next one — on a
     * normal Tuesday, about a lead that matters — is silenced with it.
     */
    const alert = recordBounceForAlerting();
    if (alert.tell === 'each') {
      await notifyManagers({
        type: 'lead_bounced',
        title: 'Lead bounced — needs reassigning',
        body: `${opportunity.title ?? 'A lead'} came back from ${agent?.name ?? 'an agent'}. It is waiting in Incoming.`,
        link: '/incoming',
        contactId: input.contactId,
        opportunityId: input.opportunityId,
        priority: 'high',
      }).catch((err) => logger.warn('bounce notification failed', errorContext(err)));
    } else if (alert.tell === 'summary') {
      await notifyManagers({
        type: 'lead_bounced',
        title: `${alert.count} leads came back at once`,
        body: 'They are waiting in Incoming. This usually means the CRM was offline for a while.',
        link: '/incoming',
        priority: 'high',
      }).catch((err) => logger.warn('bounce summary notification failed', errorContext(err)));
    }

    return { breached: true, bounced: true, reassignedTo: null };
  }

  const reassignedTo = await withRetryingTransaction(async (tx) => {
    await execute('UPDATE opportunities SET sla_breached = 1 WHERE id = ?', [input.opportunityId], tx);
    await queryOne('SELECT id FROM assignment_state WHERE id = ? FOR UPDATE', ['round_robin'], tx);

    const contact = await queryOne<{ language: string }>('SELECT language FROM contacts WHERE id = ?', [input.contactId], tx);
    const candidates = (await loadCandidates(tx)).filter((c) => c.id !== input.assignedUserId);
    const choice = chooseAgent(candidates, {
      language: contact?.language ?? null,
      projectName: null,
      dubaiMinutes: dubaiMinutesNow(),
    });

    if (choice.assigned) {
      await execute('UPDATE opportunities SET owner_user_id = ?, assigned_at = NOW(3) WHERE id = ?', [
        choice.userId,
        input.opportunityId,
      ], tx);
      // Reassign the sticky owner too, so the new agent owns the relationship.
      await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ?', [choice.userId, input.contactId], tx);
      await execute('UPDATE conversations SET assigned_user_id = ? WHERE contact_id = ?', [choice.userId, input.contactId], tx);
    }

    await addActivity(tx, {
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      type: 'sla.breached',
      title: 'Speed-to-lead SLA breached after 5 minutes',
      body: choice.assigned ? 'Reassigned to another available agent.' : 'No other agent was available to take it.',
      meta: { previousUserId: input.assignedUserId, newUserId: choice.assigned ? choice.userId : null },
    });
    await writeAudit(
      {
        actor: SYSTEM_ACTOR,
        action: 'sla.breached',
        entityType: 'opportunity',
        entityId: input.opportunityId,
        before: { ownerUserId: input.assignedUserId },
        after: { ownerUserId: choice.assigned ? choice.userId : input.assignedUserId, slaBreached: true },
      },
      tx,
    );

    await tagOps(tx, input.contactId, 'sla-breach');
    return choice.assigned ? choice.userId : null;
  });

  await pushToManagers({
    title: 'SLA breach — lead untouched for 5 minutes',
    body: `${opportunity.title ?? 'A lead'} was not picked up.${reassignedTo ? ' It has been reassigned.' : ' No other agent was available.'}`,
    link: `/contacts/${input.contactId}`,
    priority: 'high',
  }).catch((err) => logger.warn('manager SLA push failed', errorContext(err)));

  if (reassignedTo) {
    await notifyAgent(reassignedTo, input.contactId, input.opportunityId).catch(() => 0);
  }

  return { breached: true, reassignedTo };
}

async function tagOps(tx: PoolConnection, contactId: string, value: string): Promise<void> {
  await execute('INSERT IGNORE INTO tags (id, namespace, value, label) VALUES (?, ?, ?, ?)', [newId(), 'ops', value, value], tx);
  const tag = await queryOne<{ id: string }>('SELECT id FROM tags WHERE namespace = ? AND value = ?', ['ops', value], tx);
  if (tag) await execute('INSERT IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)', [contactId, tag.id], tx);
}
