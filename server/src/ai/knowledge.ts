/**
 * What Emir AI knows about this brokerage.
 *
 * The owner writes this once in Settings and it is put in front of the model on
 * every request. That is grounding, not training: the model is never reshaped,
 * so a change takes effect on the next answer rather than after a retraining
 * run, and it costs nothing to change your mind.
 *
 * **Why `uses` exists.** Every character here is an input token on every call.
 * Sending the whole knowledge base to every feature is precisely how a cheap
 * model runs up an expensive bill — the owner asked for this to stay cheap, so
 * each section declares which features it is relevant to and a request carries
 * only those. A lead verdict does not need the FAQ; a drafted reply does not
 * need the pipeline process.
 */
import { execute, getPool, query, queryOne, type Executor } from '../db/client.js';
import { badRequest } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';

/** The features that read this knowledge. */
export type AiFeature = 'verdict' | 'draft' | 'ask' | 'brief';

export type SectionKey =
  | 'company' | 'what_we_sell' | 'tone' | 'never_say' | 'faq' | 'how_we_work';

export type SectionDef = {
  key: SectionKey;
  label: string;
  /** Shown above the box, in the owner's words rather than a developer's. */
  help: string;
  placeholder: string;
  /** Which AI features include this section. */
  uses: AiFeature[];
  /** Arabic gets its own text where the wording itself matters. */
  bilingual: boolean;
  /** Where the live counter turns amber. Short and specific beats long and vague. */
  softLimit: number;
};

/**
 * The sections, in the order they appear on screen.
 *
 * `softLimit` is guidance rather than a wall — the hard cap is per request, in
 * `buildKnowledge`. Six sections at roughly 1,500 characters is about 2,000
 * tokens if every one were sent at once, and none of them are.
 */
export const SECTIONS: SectionDef[] = [
  {
    key: 'company',
    label: 'About us',
    help: 'Who the company is. Stops the AI inventing details about you.',
    placeholder: 'Emir Real Estate LLC, Dubai. ORN 12345, TRN 100123456700003.\nOffice in Business Bay. Trading since 2019. Eight agents.',
    uses: ['ask', 'draft'],
    bilingual: false,
    softLimit: 800,
  },
  {
    key: 'what_we_sell',
    label: 'What we sell',
    help: 'Which developers, which areas, which kind of buyer. Used when the AI judges whether a lead is a good fit.',
    placeholder: 'Off-plan only, Dubai and Abu Dhabi.\nStrongest with Emaar, Aldar and Sobha.\nMost of our buyers are investors from India, the UK and Russia.',
    uses: ['ask', 'verdict', 'draft'],
    bilingual: false,
    softLimit: 1000,
  },
  {
    key: 'tone',
    label: 'How we talk to clients',
    help: 'How a message from us should sound. This is what makes a draft sound like your brokerage instead of a generic estate agent.',
    placeholder: 'Warm but brief. Never pushy.\nOpen with the client’s first name.\nSign off with the agent’s name, never "the team".\nNo exclamation marks.',
    uses: ['draft'],
    bilingual: true,
    softLimit: 1000,
  },
  {
    key: 'never_say',
    label: 'Things we never say',
    help: 'Words and promises that get a broker in trouble. The AI will refuse to write these.',
    placeholder: 'Never say "guaranteed returns" or "guaranteed rental".\nNever promise a handover date as certain.\nNever say we are the cheapest or the best.',
    uses: ['draft'],
    bilingual: false,
    softLimit: 800,
  },
  {
    key: 'faq',
    label: 'Questions clients always ask',
    help: 'Your approved answer to each one, so the AI uses your wording rather than its own.',
    placeholder: 'Can a foreigner buy? Yes, freehold areas, full ownership.\nGolden Visa? From AED 2M in property.\nMissed instalment? The developer issues a notice; talk to us first.',
    uses: ['draft', 'ask'],
    bilingual: true,
    softLimit: 2000,
  },
  {
    key: 'how_we_work',
    label: 'How we work',
    help: 'What actually happens at each stage in your office. Makes "what should I do with this lead?" match your real process.',
    placeholder: 'New lead: call within 5 minutes, WhatsApp if no answer.\nQualified: send a shortlist of 3 units.\nAppointment: sales centre or video call.\nEOI before any unit is held.',
    uses: ['verdict', 'ask'],
    bilingual: false,
    softLimit: 1200,
  },
];

const BY_KEY = new Map(SECTIONS.map((section) => [section.key, section]));

/**
 * Rules the owner cannot edit, because they are the ones that keep the company
 * out of trouble. Always sent, on every feature, last — so they are the final
 * word after anything written above.
 */
export const HARD_RULES = [
  'Never state a price, size, handover date or payment plan that was not given to you in this request. If you do not have it, say you will check.',
  'Never promise or imply a return, a yield, or that a property will rise in value.',
  'Never invent a fact about a project, a developer or the company.',
  'If you are not sure, say so plainly instead of guessing.',
].join('\n');

export type KnowledgeRow = {
  section_key: SectionKey;
  language: 'en' | 'ar';
  content: string | null;
  updated_at: string | null;
  updated_by_name?: string | null;
};

export async function loadKnowledge(exec: Executor = getPool()): Promise<KnowledgeRow[]> {
  return query<KnowledgeRow>(
    `SELECT k.section_key, k.language, k.content, k.updated_at, u.name AS updated_by_name
       FROM ai_knowledge k LEFT JOIN users u ON u.id = k.updated_by_user_id`,
    [],
    exec,
  );
}

/**
 * The text to put in front of the model for one feature.
 *
 * Only the sections that declare this feature, only the language asked for, and
 * capped — an owner who pastes their entire website into one box should get a
 * truncated prompt rather than a surprise bill.
 */
export async function buildKnowledge(
  feature: AiFeature,
  language: 'en' | 'ar' = 'en',
  exec: Executor = getPool(),
): Promise<string> {
  const rows = await loadKnowledge(exec);
  const parts: string[] = [];

  for (const section of SECTIONS) {
    if (!section.uses.includes(feature)) continue;
    // Fall back to English when a bilingual section has no Arabic text yet:
    // half a prompt is worse than one in the wrong language.
    const row =
      rows.find((r) => r.section_key === section.key && r.language === language) ??
      rows.find((r) => r.section_key === section.key && r.language === 'en');
    const content = row?.content?.trim();
    if (!content) continue;
    parts.push(`## ${section.label}\n${content}`);
  }

  const knowledge = parts.join('\n\n');
  /*
   * 6,000 characters is roughly 1,500 tokens — generous for six short sections
   * and firm enough that one runaway paste cannot multiply the cost of every
   * call for the rest of the month.
   */
  const capped = knowledge.length > 6000 ? `${knowledge.slice(0, 6000)}\n…` : knowledge;

  return [capped, `## Rules you must follow\n${HARD_RULES}`].filter(Boolean).join('\n\n');
}

export async function saveSection(
  actor: AuditActor,
  sectionKey: string,
  language: 'en' | 'ar',
  content: string,
  exec: Executor = getPool(),
): Promise<void> {
  const section = BY_KEY.get(sectionKey as SectionKey);
  if (!section) throw badRequest('That is not a section of the AI knowledge');
  if (language === 'ar' && !section.bilingual) {
    throw badRequest(`${section.label} does not have an Arabic version`);
  }
  // A hard ceiling well above the soft limit: the counter on screen nudges,
  // this stops a paste of a whole brochure.
  if (content.length > 8000) throw badRequest('That section is too long. Keep it short and specific.');

  const previous = await queryOne<{ content: string | null }>(
    'SELECT content FROM ai_knowledge WHERE section_key = ? AND language = ?',
    [sectionKey, language],
    exec,
  );

  // Keep the old text before overwriting — this is the whole undo story.
  if (previous?.content) {
    await execute(
      'INSERT INTO ai_knowledge_versions (id, section_key, language, content, updated_by_user_id) VALUES (?, ?, ?, ?, ?)',
      [newId(), sectionKey, language, previous.content, actor.userId],
      exec,
    );
  }

  await execute(
    `INSERT INTO ai_knowledge (id, section_key, language, content, updated_by_user_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE content = VALUES(content), updated_by_user_id = VALUES(updated_by_user_id)`,
    [newId(), sectionKey, language, content.trim() || null, actor.userId],
    exec,
  );

  await writeAudit(
    {
      actor,
      action: 'ai.knowledge_saved',
      entityType: 'ai_knowledge',
      entityId: sectionKey,
      // The text itself is not audited: it is long, it changes often, and the
      // previous version is already kept in full next door.
      before: { length: previous?.content?.length ?? 0 },
      after: { language, length: content.trim().length },
    },
    exec,
  );
}

export type VersionRow = {
  id: string;
  section_key: string;
  language: string;
  content: string | null;
  created_at: string;
  updated_by_name: string | null;
};

export async function sectionHistory(
  sectionKey: string,
  language: 'en' | 'ar',
  exec: Executor = getPool(),
): Promise<VersionRow[]> {
  return query<VersionRow>(
    `SELECT v.id, v.section_key, v.language, v.content, v.created_at, u.name AS updated_by_name
       FROM ai_knowledge_versions v LEFT JOIN users u ON u.id = v.updated_by_user_id
      WHERE v.section_key = ? AND v.language = ?
      ORDER BY v.created_at DESC LIMIT 20`,
    [sectionKey, language],
    exec,
  );
}

/** Put an earlier version back. The current text is kept first, so this undoes. */
export async function restoreVersion(
  actor: AuditActor,
  versionId: string,
  exec: Executor = getPool(),
): Promise<void> {
  const version = await queryOne<VersionRow>(
    'SELECT id, section_key, language, content, created_at, NULL AS updated_by_name FROM ai_knowledge_versions WHERE id = ?',
    [versionId],
    exec,
  );
  if (!version) throw badRequest('That version does not exist');
  await saveSection(actor, version.section_key, version.language as 'en' | 'ar', version.content ?? '', exec);
}

/** How much of the knowledge is filled in, for the bar on the screen. */
export function completeness(rows: KnowledgeRow[]): { filled: number; total: number; chars: number } {
  let filled = 0;
  let chars = 0;
  for (const section of SECTIONS) {
    const row = rows.find((r) => r.section_key === section.key && r.language === 'en');
    if (row?.content?.trim()) filled += 1;
    for (const r of rows.filter((x) => x.section_key === section.key)) chars += r.content?.length ?? 0;
  }
  return { filled, total: SECTIONS.length, chars };
}
