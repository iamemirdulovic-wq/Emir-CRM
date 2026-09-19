import { env } from '../config/env.js';
import { secret, setting } from '../config/secrets.js';
import { logger } from '../lib/logger.js';
import { query, queryOne, execute } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { INTENTS, type IntentResult, isKnownIntent } from '../workflows/intent.js';
import { listVerifiedProjects } from '../services/projects.js';
import { GeminiProvider } from './gemini.js';
import { OpenAiProvider } from './openai.js';
import { NullProvider, parseJsonReply, type AiProvider } from './provider.js';

let override: AiProvider | null = null;

/**
 * The provider, with its key and model resolved.
 *
 * Async because the key may be one the owner saved in Settings rather than an
 * environment variable — managed hosting gives them no terminal, and a key that
 * can only be set through a control panel is a key that never gets set. The
 * environment still wins wherever it is present.
 */
export async function aiProvider(): Promise<AiProvider> {
  if (override) return override;

  const name = (await setting('AI_PROVIDER')) ?? 'none';
  const model = await setting('AI_MODEL');

  switch (name) {
    case 'gemini':
      return new GeminiProvider(await secret('GEMINI_API_KEY'), model);
    case 'openai':
      return new OpenAiProvider(await secret('OPENAI_API_KEY'), model);
    default:
      return new NullProvider();
  }
}

/**
 * The environment-only view, for the few paths that cannot await.
 *
 * Kept deliberately narrow: anything that actually sends a request should use
 * `aiProvider`, or a key saved in Settings will look like no key at all.
 */
export function ai(): AiProvider {
  if (override) return override;
  switch (env().AI_PROVIDER) {
    case 'gemini':
      return new GeminiProvider(env().GEMINI_API_KEY ?? null, env().AI_MODEL);
    case 'openai':
      return new OpenAiProvider();
    default:
      return new NullProvider();
  }
}

export function setAiProviderForTesting(next: AiProvider | null): void {
  override = next;
}

/**
 * Last-resort intent classification, used only after the button payload and the
 * keyword matcher have both failed.
 */
export async function classifyIntent(text: string): Promise<IntentResult | null> {
  const model = ai();
  if (!model.enabled) return null;

  const reply = await model.complete({
    feature: 'classify_intent',
    json: true,
    maxOutputTokens: 100,
    messages: [
      {
        role: 'system',
        content:
          'You classify short WhatsApp messages from real estate leads in Dubai and Abu Dhabi. ' +
          'Messages may be in English or Arabic. ' +
          `Reply with JSON only: {"intent": one of ${INTENTS.join('|')}, "confidence": 0..1}. ` +
          'Use UNKNOWN when you are not sure. Never guess STOP unless the person clearly asks to stop being contacted.',
      },
      { role: 'user', content: text.slice(0, 1000) },
    ],
  });

  const parsed = parseJsonReply<{ intent?: string; confidence?: number }>(reply);
  if (!parsed?.intent || !isKnownIntent(parsed.intent)) return null;

  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
  // An opt-out is destructive, so only accept a confident classification.
  if (parsed.intent === 'STOP' && confidence < 0.9) return null;
  if (confidence < 0.55) return null;

  return { intent: parsed.intent, source: 'ai', confidence };
}

/**
 * Extract structured fields from the conversation. Fills empty fields only and
 * records each one as a suggestion so the UI can show the "AI-filled" chip.
 */
export type ExtractedFields = {
  budget_min_aed?: number;
  budget_max_aed?: number;
  unit_type?: string;
  purpose?: 'investment' | 'end_use';
  timeline?: 'immediate' | '1_3_months' | '3_6_months' | '6_12_months' | '12_plus';
  language?: 'en' | 'ar';
  sentiment?: 'positive' | 'neutral' | 'negative';
};

export async function extractFields(contactId: string, opportunityId: string | null): Promise<ExtractedFields | null> {
  const model = ai();
  if (!model.enabled) return null;

  const messages = await query<{ direction: string; body: string | null; created_at: Date }>(
    `SELECT direction, body, created_at FROM messages
      WHERE contact_id = ? AND body IS NOT NULL AND channel IN ('whatsapp','email','sms')
      ORDER BY created_at DESC LIMIT 30`,
    [contactId],
  );
  if (messages.length === 0) return null;

  const transcript = [...messages]
    .reverse()
    .map((m) => `${m.direction === 'inbound' ? 'Lead' : 'Agent'}: ${m.body}`)
    .join('\n')
    .slice(0, 6000);

  const reply = await model.complete({
    feature: 'extract_fields',
    json: true,
    maxOutputTokens: 400,
    messages: [
      {
        role: 'system',
        content:
          'Extract structured facts from a Dubai/Abu Dhabi off-plan property conversation. ' +
          'Reply with JSON only. Include a key ONLY when the lead stated it explicitly; omit anything you would have to guess. ' +
          'Keys: budget_min_aed (number, AED), budget_max_aed (number, AED), unit_type (string such as "2 Bedroom"), ' +
          'purpose ("investment"|"end_use"), timeline ("immediate"|"1_3_months"|"3_6_months"|"6_12_months"|"12_plus"), ' +
          'language ("en"|"ar"), sentiment ("positive"|"neutral"|"negative").',
      },
      { role: 'user', content: transcript },
    ],
  });

  const parsed = parseJsonReply<ExtractedFields>(reply);
  if (!parsed) return null;

  await recordSuggestions(contactId, opportunityId, parsed, model.name);
  return parsed;
}

async function recordSuggestions(
  contactId: string,
  opportunityId: string | null,
  fields: ExtractedFields,
  modelName: string,
): Promise<void> {
  for (const [field, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === '') continue;
    await execute(
      `INSERT INTO ai_field_suggestions (id, contact_id, opportunity_id, field, value, model, status)
       VALUES (?, ?, ?, ?, ?, ?, 'suggested')`,
      [newId(), contactId, opportunityId, field, String(value).slice(0, 500), modelName],
    );
  }
}

/**
 * Apply extracted fields to the opportunity, filling empty columns only. Never
 * overwrite what an agent or the lead form already provided.
 */
export async function applyExtractedFields(opportunityId: string, fields: ExtractedFields): Promise<string[]> {
  const applied: string[] = [];

  const numeric: Array<['budget_min_aed' | 'budget_max_aed', number | undefined]> = [
    ['budget_min_aed', fields.budget_min_aed],
    ['budget_max_aed', fields.budget_max_aed],
  ];
  for (const [column, value] of numeric) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    const result = await execute(`UPDATE opportunities SET ${column} = ? WHERE id = ? AND ${column} IS NULL`, [
      Math.round(value),
      opportunityId,
    ]);
    if (result.affectedRows > 0) applied.push(column);
  }

  if (fields.unit_type) {
    const result = await execute('UPDATE opportunities SET unit_type = ? WHERE id = ? AND unit_type IS NULL', [
      fields.unit_type.slice(0, 64),
      opportunityId,
    ]);
    if (result.affectedRows > 0) applied.push('unit_type');
  }

  const enums: Array<['purpose' | 'timeline', string | undefined]> = [
    ['purpose', fields.purpose],
    ['timeline', fields.timeline],
  ];
  for (const [column, value] of enums) {
    if (!value) continue;
    const result = await execute(`UPDATE opportunities SET ${column} = ? WHERE id = ? AND ${column} = 'unknown'`, [
      value,
      opportunityId,
    ]);
    if (result.affectedRows > 0) applied.push(column);
  }

  if (applied.length) {
    await execute(
      `UPDATE ai_field_suggestions SET status = 'applied'
        WHERE opportunity_id = ? AND status = 'suggested' AND field IN (${applied.map(() => '?').join(',')})`,
      [opportunityId, ...applied],
    );
  }
  return applied;
}

/**
 * A three-line summary for Contact 360, plus suggested replies grounded only in
 * verified `projects` data.
 */
export async function summarizeContact(contactId: string): Promise<{ summary: string; suggestedReplies: string[] } | null> {
  const model = ai();
  if (!model.enabled) return null;

  const contact = await queryOne<{ full_name: string | null; language: string }>(
    'SELECT full_name, language FROM contacts WHERE id = ?',
    [contactId],
  );
  const opportunity = await queryOne<{ project_name: string | null; budget_band: string | null; stage_key: string; unit_type: string | null }>(
    'SELECT project_name, budget_band, stage_key, unit_type FROM opportunities WHERE contact_id = ? ORDER BY created_at DESC LIMIT 1',
    [contactId],
  );
  const messages = await query<{ direction: string; body: string | null }>(
    `SELECT direction, body FROM messages WHERE contact_id = ? AND body IS NOT NULL ORDER BY created_at DESC LIMIT 30`,
    [contactId],
  );
  if (messages.length === 0) return null;

  const transcript = [...messages]
    .reverse()
    .map((m) => `${m.direction === 'inbound' ? 'Lead' : 'Agent'}: ${m.body}`)
    .join('\n')
    .slice(0, 6000);

  // Suggested replies are grounded only in verified project data.
  const projects = await listVerifiedProjects();
  const facts = projects
    .slice(0, 40)
    .map((p) =>
      [
        p.name,
        p.developer,
        p.area ?? '',
        p.starting_price_aed ? `from AED ${p.starting_price_aed}` : '',
        p.payment_plan ?? '',
        p.handover_date ? `handover ${p.handover_date}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    )
    .join('\n');

  const reply = await model.complete({
    feature: 'summarize_contact',
    json: true,
    maxOutputTokens: 600,
    messages: [
      {
        role: 'system',
        content:
          'You brief a real estate agent on a lead. Reply with JSON only: ' +
          '{"summary": "exactly three short lines separated by \\n", "suggestedReplies": ["...", "...", "..."]}. ' +
          'CRITICAL: the suggested replies may only state prices, payment plans, handover dates or ROI that appear in the VERIFIED PROJECT DATA below. ' +
          'Never invent or estimate a figure. If the data does not cover something, write a reply that offers to confirm it instead. ' +
          `Write the replies in ${contact?.language === 'ar' ? 'Arabic' : 'English'}.`,
      },
      {
        role: 'user',
        content:
          `LEAD: ${contact?.full_name ?? 'unknown'}\n` +
          `STAGE: ${opportunity?.stage_key ?? 'unknown'}\n` +
          `PROJECT: ${opportunity?.project_name ?? 'not stated'}\n` +
          `BUDGET: ${opportunity?.budget_band ?? 'not stated'}\n` +
          `UNIT: ${opportunity?.unit_type ?? 'not stated'}\n\n` +
          `VERIFIED PROJECT DATA:\n${facts || '(none on file)'}\n\n` +
          `CONVERSATION:\n${transcript}`,
      },
    ],
  });

  const parsed = parseJsonReply<{ summary?: string; suggestedReplies?: string[] }>(reply);
  if (!parsed?.summary) return null;

  const summary = parsed.summary.split('\n').slice(0, 3).join('\n').slice(0, 1000);
  await execute('UPDATE contacts SET ai_summary = ?, ai_summary_at = NOW(3) WHERE id = ?', [summary, contactId]);

  logger.debug('generated an AI summary', { contactId });
  return {
    summary,
    suggestedReplies: (parsed.suggestedReplies ?? []).slice(0, 3).map((r) => String(r).slice(0, 500)),
  };
}

export { parseJsonReply };
