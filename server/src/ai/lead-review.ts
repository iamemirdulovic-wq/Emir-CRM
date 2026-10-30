import { execute, query, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { aiProvider } from './index.js';
import { parseJsonReply } from './provider.js';
import {
  buildNotesDigestPrompt, digestIsStale, packDigest, parseNotesDigest, unpackDigest,
  DIGEST_VERSION, type NoteForDigest,
} from './notes-digest.js';
import {
  parseVerdict, refineScore, REFINE_VERSION, shouldRescore, verdictFromRules, type AiVerdict,
} from '../scoring/refine.js';
import { bandFor, detectSpamSignals, scoreLead } from '../scoring/score.js';
import { suggestNextStep, dueAt, describeSuggestion, type LeadForAdvice, type NextStepType } from '../leads/next-step.js';
import { parsePhone } from '../lib/phone.js';
import type { StageKey } from '../pipeline/stages.js';

/**
 * The lead brief: what the notes say, what the AI makes of it, and what to do
 * next. One read for the panel at the top of the lead page.
 *
 * The split that matters: the next step comes from rules and is always there,
 * the digest and the verdict come from a model and may simply be absent. With
 * AI switched off the panel still tells an agent what to do today, which is
 * the part they would miss.
 */

export interface LeadBrief {
  /** Three lines from the notes, or none if there are no notes or no AI. */
  notes: { lines: string[]; watchOut: string | null; at: string | null; stale: boolean };
  /** The AI's verdict, or the rules' own, with where it came from. */
  verdict: { value: AiVerdict; why: string | null; source: 'ai' | 'rules'; at: string | null } | null;
  /** Always present: either a step, or the reason there is nothing to do. */
  advice: {
    type: NextStepType;
    at: string;
    note: string;
    why: string;
    urgency: string;
    headline: string;
  } | null;
  adviceWhy: string | null;
  /** True when the AI thinks this is junk and an agent should confirm it. */
  suggestInvalid: boolean;
}

interface LeadRow {
  id: string;
  contact_id: string;
  stage_key: StageKey;
  sub_status: string | null;
  status: string;
  next_step_at: Date | null;
  next_step_type: NextStepType | null;
  last_contact_at: Date | null;
  no_answer_count: number;
  created_at: Date;
  project_name: string | null;
  budget_band: string | null;
  budget_min_aed: number | null;
  budget_max_aed: number | null;
  unit_type: string | null;
  timeline: string;
  purpose: string;
  golden_visa_interest: number;
  notes_digest: string | null;
  notes_digest_at: Date | null;
  notes_digest_count: number;
  ai_verdict: AiVerdict | null;
  ai_verdict_at: Date | null;
  lead_score: number | null;
  full_name: string | null;
  phone_e164: string | null;
  email: string | null;
  contact_notes: string | null;
  language: string;
  dnc: number;
  last_inbound_at: Date | null;
}

const LEAD_SELECT = `
  SELECT o.id, o.contact_id, s.\`key\` AS stage_key, o.sub_status, o.status,
         o.next_step_at, o.next_step_type, o.last_contact_at, o.no_answer_count, o.created_at,
         o.project_name, o.budget_band, o.budget_min_aed, o.budget_max_aed, o.unit_type,
         o.timeline, o.purpose, o.golden_visa_interest,
         o.notes_digest, o.notes_digest_at, o.notes_digest_count,
         o.ai_verdict, o.ai_verdict_at, o.lead_score,
         c.full_name, c.phone_e164, c.email, c.notes AS contact_notes, c.language, c.dnc,
         c.last_inbound_at
    FROM opportunities o
    JOIN pipeline_stages s ON s.id = o.stage_id
    JOIN contacts c ON c.id = o.contact_id`;

/** The brief for one lead. Cheap: no model call, only what is already stored. */
export async function leadBrief(opportunityId: string, now: Date = new Date()): Promise<LeadBrief | null> {
  const lead = await queryOne<LeadRow>(`${LEAD_SELECT} WHERE o.id = ? AND o.deleted_at IS NULL`, [opportunityId]);
  if (!lead) return null;

  const noteCount = await countNotes(lead.contact_id, opportunityId);
  const unpacked = unpackDigest(lead.notes_digest);

  const advice = suggestNextStep(toAdviceInput(lead), now);

  const latest = await queryOne<{ verdict: AiVerdict; why: string | null; scored_at: Date; model: string | null }>(
    'SELECT verdict, why, scored_at, model FROM lead_ai_scores WHERE opportunity_id = ? ORDER BY scored_at DESC LIMIT 1',
    [opportunityId],
  );

  return {
    notes: {
      lines: unpacked.lines,
      watchOut: unpacked.watchOut,
      at: lead.notes_digest_at ? lead.notes_digest_at.toISOString() : null,
      stale: digestIsStale(
        { digest: lead.notes_digest, count: lead.notes_digest_count, at: lead.notes_digest_at },
        noteCount,
        now,
      ),
    },
    verdict: latest
      ? {
          value: latest.verdict,
          why: latest.why,
          source: latest.model ? 'ai' : 'rules',
          at: latest.scored_at.toISOString(),
        }
      : lead.ai_verdict
        ? {
            value: lead.ai_verdict,
            why: null,
            source: 'rules',
            at: lead.ai_verdict_at ? lead.ai_verdict_at.toISOString() : null,
          }
        : null,
    advice:
      advice.suggest === null
        ? null
        : {
            type: advice.suggest.type,
            at: dueAt(advice.suggest, now).toISOString(),
            note: advice.suggest.note,
            why: advice.suggest.why,
            urgency: advice.suggest.urgency,
            headline: describeSuggestion(advice.suggest),
          },
    adviceWhy: advice.suggest === null ? advice.why : null,
    suggestInvalid: lead.ai_verdict === 'junk',
  };
}

function toAdviceInput(lead: LeadRow): LeadForAdvice {
  return {
    stage: lead.stage_key,
    subStatus: lead.sub_status,
    status: lead.status,
    lastContactAt: lead.last_contact_at,
    lastInboundAt: lead.last_inbound_at,
    noAnswerCount: Number(lead.no_answer_count ?? 0),
    nextStepAt: lead.next_step_at,
    nextStepType: lead.next_step_type,
    dnc: lead.dnc === 1,
    createdAt: lead.created_at,
  };
}

async function countNotes(contactId: string, opportunityId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM lead_notes
      WHERE contact_id = ? AND deleted_at IS NULL AND (opportunity_id = ? OR opportunity_id IS NULL)`,
    [contactId, opportunityId],
  );
  return Number(row?.n ?? 0);
}

/**
 * Summarise the notes, if there is anything to summarise and the digest is out
 * of date. Returns null when there is nothing to do, which is the common case.
 */
export async function refreshNotesDigest(
  opportunityId: string,
  options: { force?: boolean } = {},
): Promise<{ lines: string[]; watchOut: string | null } | null> {
  const lead = await queryOne<LeadRow>(`${LEAD_SELECT} WHERE o.id = ? AND o.deleted_at IS NULL`, [opportunityId]);
  if (!lead) return null;

  const notes = await query<{ type: string; body: string; pinned: number; created_at: Date; author: string | null }>(
    `SELECT n.type, n.body, n.pinned, n.created_at, u.name AS author
       FROM lead_notes n
       LEFT JOIN users u ON u.id = n.author_id
      WHERE n.contact_id = ? AND n.deleted_at IS NULL AND (n.opportunity_id = ? OR n.opportunity_id IS NULL)
      ORDER BY n.created_at DESC`,
    [lead.contact_id, opportunityId],
  );
  if (notes.length === 0) return null;

  if (
    !options.force &&
    !digestIsStale(
      { digest: lead.notes_digest, count: lead.notes_digest_count, at: lead.notes_digest_at },
      notes.length,
    )
  ) {
    const cached = unpackDigest(lead.notes_digest);
    return { lines: cached.lines, watchOut: cached.watchOut };
  }

  const model = await aiProvider();
  if (!model.enabled) return null;

  const forDigest: NoteForDigest[] = notes.map((note) => ({
    type: note.type,
    body: note.body,
    pinned: note.pinned === 1,
    authorName: note.author,
    createdAt: note.created_at,
  }));

  const prompt = buildNotesDigestPrompt(
    {
      name: lead.full_name,
      stage: lead.stage_key,
      subStatus: lead.sub_status,
      project: lead.project_name,
      budgetBand: lead.budget_band,
      unitType: lead.unit_type,
    },
    forDigest,
  );

  const reply = await model.complete({
    feature: 'notes_digest',
    json: true,
    maxOutputTokens: 400,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
  });

  const digest = parseNotesDigest(parseJsonReply(reply), prompt.user);
  if (!digest) return null;

  if (digest.dropped.length > 0) {
    /* Worth a line in the log: a model inventing figures is a prompt problem,
       and the only way anybody finds out is if it is recorded. */
    logger.warn('dropped ungrounded figures from a notes digest', {
      opportunityId,
      figures: digest.dropped.slice(0, 5),
      version: DIGEST_VERSION,
    });
  }

  await execute(
    'UPDATE opportunities SET notes_digest = ?, notes_digest_at = NOW(3), notes_digest_count = ? WHERE id = ?',
    [packDigest(digest), notes.length, opportunityId],
  );

  return { lines: digest.lines, watchOut: digest.watchOut };
}

/**
 * The nightly second opinion on one lead.
 *
 * The rules run first and always. The model is asked only for a verdict and a
 * reason, and only moves the number within the limits in `refine.ts`. The row
 * is kept rather than overwritten, so "it said junk in March" stays a fact.
 */
export async function reviewLead(opportunityId: string, now: Date = new Date()): Promise<{
  verdict: AiVerdict;
  score: number;
  source: 'ai' | 'rules';
} | null> {
  const lead = await queryOne<LeadRow>(`${LEAD_SELECT} WHERE o.id = ? AND o.deleted_at IS NULL`, [opportunityId]);
  if (!lead) return null;

  const phone = parsePhone(lead.phone_e164);
  const inbound = await query<{ direction: string; body: string | null; created_at: Date }>(
    `SELECT direction, body, created_at FROM messages
      WHERE contact_id = ? AND body IS NOT NULL ORDER BY created_at DESC LIMIT 20`,
    [lead.contact_id],
  );
  const intents = await query<{ value: string }>(
    `SELECT t.value FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
      WHERE ct.contact_id = ? AND t.namespace = 'intent'`,
    [lead.contact_id],
  );
  const intentSet = new Set(intents.map((i) => i.value));
  const inquiries = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM opportunities WHERE contact_id = ?', [
    lead.contact_id,
  ]);

  const breakdown = scoreLead({
    hasValidPhone: phone.isValid,
    isMobile: phone.isMobile,
    hasEmail: Boolean(lead.email),
    budgetMinAed: lead.budget_min_aed,
    budgetMaxAed: lead.budget_max_aed,
    timeline: lead.timeline as never,
    purpose: lead.purpose as never,
    repliedOnWhatsApp: inbound.some((m) => m.direction === 'inbound'),
    requestedCall: intentSet.has('call_me') || intentSet.has('hot'),
    requestedPricing: intentSet.has('pricing'),
    requestedBrochure: intentSet.has('brochure'),
    inquiryCount: Number(inquiries?.n ?? 1),
    goldenVisaInterest: lead.golden_visa_interest === 1,
    spamSignals: detectSpamSignals({
      fullName: lead.full_name,
      email: lead.email,
      phoneValid: phone.isValid,
      notes: lead.contact_notes,
    }),
    invalidNumber: !phone.isValid,
  });

  const unreachable = !phone.isValid && !lead.email;
  const model = await aiProvider();

  let verdict: AiVerdict = verdictFromRules(breakdown);
  let why: string | null = breakdown.reason;
  let source: 'ai' | 'rules' = 'rules';
  let score = breakdown.score;
  let adjustment = 0;
  let suggestInvalid = false;

  if (model.enabled && inbound.length > 0) {
    const transcript = [...inbound]
      .reverse()
      .map((m) => `${m.direction === 'inbound' ? 'Lead' : 'Agent'}: ${m.body}`)
      .join('\n')
      .slice(0, 4000);

    const reply = await model.complete({
      feature: 'lead_verdict',
      json: true,
      maxOutputTokens: 200,
      messages: [
        {
          role: 'system',
          content:
            'You judge the quality of one real estate lead for a Dubai and Abu Dhabi off-plan brokerage. ' +
            'Reply with JSON only: {"verdict": "hot"|"good"|"weak"|"junk", "confidence": 0..1, "why": "one short line"}. ' +
            'Judge only what the person has written and done: how specific they are, whether they answer questions, ' +
            'whether they ask about price, payment or viewing, and whether the message reads like a real buyer or like ' +
            'a bot, a competitor or a wrong number. ' +
            'Use "junk" only for an obviously fake or mistaken enquiry, never for somebody who is simply slow or undecided. ' +
            'Never state a price, size, handover date or return. The "why" must be about their behaviour, not about figures.',
        },
        {
          role: 'user',
          content:
            `STAGE: ${lead.stage_key}${lead.sub_status ? ` / ${lead.sub_status}` : ''}\n` +
            `BUDGET AS STATED: ${lead.budget_band ?? 'not stated'}\n` +
            `CALLS WITH NO ANSWER: ${lead.no_answer_count}\n` +
            `RULE SCORE: ${breakdown.score} of 100\n\n` +
            `CONVERSATION:\n${transcript}`,
        },
      ],
    });

    const parsed = parseVerdict(parseJsonReply(reply));
    if (parsed) {
      const refined = refineScore({
        ruleScore: breakdown.score,
        verdict: parsed.verdict,
        confidence: parsed.confidence,
        unreachable,
      });
      verdict = refined.verdict;
      score = refined.score;
      adjustment = refined.adjustment;
      suggestInvalid = refined.suggestInvalid;
      why = parsed.why ?? breakdown.reason;
      source = 'ai';
    }
  }

  await execute(
    `INSERT INTO lead_ai_scores
       (id, opportunity_id, contact_id, verdict, why, rule_score, adjustment, score,
        next_step_type, next_step_in_days, next_step_note, signals, model, version, scored_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    [
      newId(),
      opportunityId,
      lead.contact_id,
      verdict,
      why,
      breakdown.score,
      adjustment,
      score,
      null,
      null,
      null,
      JSON.stringify({
        components: breakdown.components,
        unreachable,
        messages: inbound.length,
        suggestInvalid,
      }),
      source === 'ai' ? model.model : null,
      REFINE_VERSION,
    ],
  );

  await execute(
    `UPDATE opportunities
        SET lead_score = ?, score_reason = ?, score_band = ?, ai_verdict = ?, ai_verdict_at = NOW(3)
      WHERE id = ?`,
    [score, (why ?? breakdown.reason).slice(0, 255), bandFor(score), verdict, opportunityId],
  );
  await execute('UPDATE contacts SET lead_score = ? WHERE id = ?', [score, lead.contact_id]);

  return { verdict, score, source };
}

/**
 * Who the nightly pass should look at, newest evidence first, capped.
 *
 * The cap is the point. A thousand leads is a thousand model calls, and the
 * owner's monthly budget is a number in Settings, not a suggestion.
 */
export async function leadsToReview(limit: number, now: Date = new Date()): Promise<string[]> {
  const rows = await query<{
    id: string;
    status: string;
    created_at: Date;
    scored_at: Date | null;
    last_activity_at: Date | null;
  }>(
    `SELECT o.id, o.status, o.created_at,
            (SELECT MAX(scored_at) FROM lead_ai_scores WHERE opportunity_id = o.id) AS scored_at,
            GREATEST(
              COALESCE(o.last_contact_at, o.created_at),
              COALESCE(o.stage_changed_at, o.created_at),
              COALESCE(c.last_inbound_at, o.created_at)
            ) AS last_activity_at
       FROM opportunities o
       JOIN contacts c ON c.id = o.contact_id
      WHERE o.deleted_at IS NULL AND o.status = 'open'
      ORDER BY scored_at IS NOT NULL, scored_at ASC, o.created_at DESC
      LIMIT ?`,
    [Math.max(1, Math.min(1000, limit * 4))],
  );

  return rows
    .filter((row) =>
      shouldRescore(
        {
          scoredAt: row.scored_at,
          lastActivityAt: row.last_activity_at,
          status: row.status,
          createdAt: row.created_at,
        },
        now,
      ),
    )
    .slice(0, limit)
    .map((row) => row.id);
}
