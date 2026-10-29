import { execute, queryOne, query, withRetryingTransaction } from '../db/client.js';
import { notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { writeAudit, diffFields, type AuditActor } from '../audit/audit.js';
import { addActivity } from '../ingestion/ingest.js';
import { cancelJobs, enqueue } from '../jobs/queue.js';
import { isPastAttemptedContact, type StageKey } from '../pipeline/stages.js';
import { qualityEventFor, validateMove, type MoveRequest } from '../pipeline/moves.js';
import type { Role } from '../auth/rbac.js';

export type OpportunityRow = {
  id: string;
  contact_id: string;
  stage_key: StageKey;
  sub_status: string | null;
  owner_user_id: string | null;
  status: 'open' | 'won' | 'lost';
  pipeline_id: string;
  project_name: string | null;
};

export async function getOpportunity(id: string): Promise<OpportunityRow | null> {
  return queryOne<OpportunityRow>(
    'SELECT id, contact_id, stage_key, sub_status, owner_user_id, status, pipeline_id, project_name FROM opportunities WHERE id = ?',
    [id],
  );
}

/**
 * `from` is not a caller input: the current stage is read under the row lock, so
 * a stale board cannot move a card from a stage it has already left.
 */
export type MoveStageInput = Omit<MoveRequest, 'from'> & {
  opportunityId: string;
  actor: AuditActor & { role: Role };
  /** Null for the automation account, which owns nothing. */
  actingUserId: string | null;
};

export type MoveStageResult = {
  opportunityId: string;
  from: StageKey;
  to: StageKey;
  subStatus: string | null;
  qualityEvent: string | null;
};

/**
 * Move a card. Every move writes an activity and an audit entry, and maps the
 * new stage onto a lead-quality event for the ad platforms.
 */
export async function moveStage(input: MoveStageInput): Promise<MoveStageResult> {
  return withRetryingTransaction(async (tx) => {
    const current = await queryOne<OpportunityRow & { contact_id: string }>(
      `SELECT id, contact_id, stage_key, sub_status, owner_user_id, status, pipeline_id, project_name
         FROM opportunities WHERE id = ? FOR UPDATE`,
      [input.opportunityId],
      tx,
    );
    if (!current) throw notFound('Opportunity not found');

    const move = validateMove(
      {
        from: current.stage_key,
        to: input.to,
        subStatus: input.subStatus ?? null,
        lostReason: input.lostReason ?? null,
        lostNote: input.lostNote ?? null,
      },
      {
        role: input.actor.role,
        ownsCard: Boolean(input.actingUserId && current.owner_user_id === input.actingUserId),
      },
    );

    const stage = await queryOne<{ id: string }>(
      'SELECT id FROM pipeline_stages WHERE pipeline_id = ? AND `key` = ?',
      [current.pipeline_id, move.to],
      tx,
    );
    if (!stage) throw notFound(`Stage "${move.to}" does not exist in this pipeline`);

    const before = {
      stage_key: current.stage_key,
      sub_status: current.sub_status,
      status: current.status,
    };
    const after = {
      stage_key: move.to,
      sub_status: move.subStatus,
      status: move.status,
    };

    await execute(
      `UPDATE opportunities
          SET stage_id = ?, stage_key = ?, sub_status = ?, status = ?,
              lost_reason = ?, lost_note = ?,
              stage_changed_at = NOW(3),
              closed_at = CASE WHEN ? IN ('won','lost') THEN NOW(3) ELSE NULL END,
              first_touch_at = COALESCE(first_touch_at, CASE WHEN ? <> 'new_lead' THEN NOW(3) ELSE NULL END)
        WHERE id = ?`,
      [
        stage.id,
        move.to,
        move.subStatus,
        move.status,
        move.lostReason,
        move.lostNote,
        move.status,
        move.to,
        input.opportunityId,
      ],
      tx,
    );

    await addActivity(tx, {
      contactId: current.contact_id,
      opportunityId: input.opportunityId,
      userId: input.actingUserId,
      type: 'stage.changed',
      title: `Stage moved from ${current.stage_key} to ${move.to}`,
      body: move.lostReason ? `Lost reason: ${move.lostReason}${move.lostNote ? ` — ${move.lostNote}` : ''}` : null,
      meta: { from: current.stage_key, to: move.to, subStatus: move.subStatus, backwards: move.isBackwards },
    });

    const diff = diffFields(before, after);
    await writeAudit(
      {
        actor: input.actor,
        action: 'opportunity.stage_changed',
        entityType: 'opportunity',
        entityId: input.opportunityId,
        before: diff.before,
        after: diff.after,
      },
      tx,
    );

    // Moving past Attempted Contact, or closing the card, stops the no-response
    // follow-up sequence.
    if (isPastAttemptedContact(move.to) || move.status !== 'open') {
      await cancelJobs(
        { contactId: current.contact_id, types: ['workflow.b.step'], reason: `stage moved to ${move.to}` },
        tx,
      );
      await execute(
        `UPDATE workflow_runs SET status = 'cancelled', finished_at = NOW(3), cancel_reason = ?
          WHERE contact_id = ? AND workflow_key = 'B_no_response_followup' AND status = 'running'`,
        [`stage moved to ${move.to}`, current.contact_id],
        tx,
      );
    }

    const qualityEvent = qualityEventFor(move.to, move.subStatus);
    if (qualityEvent) {
      await enqueue(
        'capi.send_event',
        { opportunityId: input.opportunityId, contactId: current.contact_id, eventName: qualityEvent },
        {
          priority: 6,
          // One report per (opportunity, event); a card that moves back and
          // forth must not inflate the ad platform's numbers.
          dedupeKey: `capi:${input.opportunityId}:${qualityEvent}`,
          contactId: current.contact_id,
        },
        tx,
      );
      await enqueue(
        'google.upload_conversion',
        { opportunityId: input.opportunityId, contactId: current.contact_id, eventName: qualityEvent },
        {
          priority: 6,
          dedupeKey: `gads:${input.opportunityId}:${qualityEvent}`,
          contactId: current.contact_id,
        },
        tx,
      );
    }

    logger.info('opportunity stage changed', {
      opportunityId: input.opportunityId,
      from: current.stage_key,
      to: move.to,
      qualityEvent,
    });

    return {
      opportunityId: input.opportunityId,
      from: current.stage_key,
      to: move.to,
      subStatus: move.subStatus,
      qualityEvent,
    };
  });
}

export type ReassignInput = {
  opportunityId: string;
  toUserId: string;
  actor: AuditActor & { role: Role };
  reason?: string | null;
  /** Also move the contact's sticky owner. Default true. */
  moveStickyOwner?: boolean;
};

/** Reassign a card. Managers and above only — enforced by the route. */
export async function reassign(input: ReassignInput): Promise<void> {
  await withRetryingTransaction(async (tx) => {
    const current = await queryOne<{ id: string; contact_id: string; owner_user_id: string | null }>(
      'SELECT id, contact_id, owner_user_id FROM opportunities WHERE id = ? FOR UPDATE',
      [input.opportunityId],
      tx,
    );
    if (!current) throw notFound('Opportunity not found');

    const target = await queryOne<{ id: string; name: string; is_active: number }>(
      'SELECT id, name, is_active FROM users WHERE id = ?',
      [input.toUserId],
      tx,
    );
    if (!target || target.is_active !== 1) throw notFound('That user does not exist or is not active');

    await execute('UPDATE opportunities SET owner_user_id = ?, assigned_at = NOW(3) WHERE id = ?', [
      input.toUserId,
      input.opportunityId,
    ], tx);

    if (input.moveStickyOwner !== false) {
      await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ?', [input.toUserId, current.contact_id], tx);
      await execute('UPDATE conversations SET assigned_user_id = ? WHERE contact_id = ?', [
        input.toUserId,
        current.contact_id,
      ], tx);
    }

    await addActivity(tx, {
      contactId: current.contact_id,
      opportunityId: input.opportunityId,
      userId: input.actor.userId,
      type: 'opportunity.reassigned',
      title: `Reassigned to ${target.name}`,
      body: input.reason ?? null,
      meta: { from: current.owner_user_id, to: input.toUserId },
    });

    await writeAudit(
      {
        actor: input.actor,
        action: 'opportunity.reassigned',
        entityType: 'opportunity',
        entityId: input.opportunityId,
        before: { owner_user_id: current.owner_user_id },
        after: { owner_user_id: input.toUserId, reason: input.reason ?? null },
      },
      tx,
    );
  });
}

/** Board data: one column per stage, cards scoped to what the viewer may see. */
export async function loadBoard(params: {
  visibleUserIds: string[] | null;
  pipelineKey: string;
  filters?: { search?: string | null; source?: string | null; ownerUserId?: string | null; projectName?: string | null };
  limitPerStage?: number;
}): Promise<
  Array<{
    stageKey: string;
    stageName: string;
    position: number;
    total: number;
    cards: Array<Record<string, unknown>>;
  }>
> {
  const stages = await query<{ key: StageKey; name: string; position: number }>(
    `SELECT s.\`key\`, s.name, s.position
       FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
      WHERE p.\`key\` = ? ORDER BY s.position`,
    [params.pipelineKey],
  );

  const where: string[] = ['o.pipeline_id = (SELECT id FROM pipelines WHERE `key` = ?)'];
  const args: Array<string | number> = [params.pipelineKey];

  if (params.visibleUserIds !== null) {
    if (params.visibleUserIds.length === 0) where.push('1=0');
    else {
      where.push(`o.owner_user_id IN (${params.visibleUserIds.map(() => '?').join(',')})`);
      args.push(...params.visibleUserIds);
    }
  }
  if (params.filters?.ownerUserId) {
    where.push('o.owner_user_id = ?');
    args.push(params.filters.ownerUserId);
  }
  if (params.filters?.source) {
    where.push('o.source = ?');
    args.push(params.filters.source);
  }
  if (params.filters?.projectName) {
    where.push('o.project_name = ?');
    args.push(params.filters.projectName);
  }
  if (params.filters?.search) {
    where.push('(c.full_name LIKE ? OR c.phone_e164 LIKE ? OR c.email LIKE ? OR o.project_name LIKE ?)');
    const like = `%${params.filters.search}%`;
    args.push(like, like, like, like);
  }

  const limit = Math.min(params.limitPerStage ?? 50, 200);
  const board = [];

  for (const stage of stages) {
    const stageArgs = [...args, stage.key];
    const cards = await query<Record<string, unknown>>(
      `SELECT o.id, o.title, o.stage_key, o.sub_status, o.status, o.owner_user_id, o.project_name,
              o.budget_min_aed, o.budget_max_aed, o.budget_band, o.unit_type, o.emirate, o.timeline,
              o.lead_score, o.source, o.campaign_name, o.created_at, o.stage_changed_at, o.sla_breached,
              c.id AS contact_id, c.full_name, c.phone_e164, c.wa_id, c.email, c.language,
              c.last_inbound_at, c.dnc,
              u.name AS owner_name
         FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id
         LEFT JOIN users u ON u.id = o.owner_user_id
        WHERE ${where.join(' AND ')} AND o.stage_key = ?
        ORDER BY o.lead_score DESC, o.created_at DESC
        LIMIT ${limit}`,
      stageArgs,
    );
    const counted = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities o JOIN contacts c ON c.id = o.contact_id
        WHERE ${where.join(' AND ')} AND o.stage_key = ?`,
      stageArgs,
    );
    board.push({
      stageKey: stage.key,
      stageName: stage.name,
      position: stage.position,
      total: Number(counted?.n ?? 0),
      cards,
    });
  }
  return board;
}
