/**
 * Writing a project's description.
 *
 * The one place in this CRM where a model is asked for prose rather than for
 * facts, and therefore the one place it is most tempted to invent. A
 * description is where "moments from the beach", "a short walk to the metro"
 * and "excellent rental yields" appear from nowhere — and that text goes out
 * to a buyer under the brokerage's name, and into an offer, and onto a website.
 *
 * So it is given the entered facts and nothing else, told in the strongest
 * terms to use only those, and told which claims are forbidden outright.
 */
import { withinCap } from './usage.js';
import { buildKnowledge } from './knowledge.js';
import { setting, secret } from '../config/secrets.js';
import { badRequest } from '../lib/errors.js';
import { cachedModels, rankModels, resolveModel } from './models.js';
import { callGemini, candidateNames } from './call-gemini.js';

export const REWRITE_TONES = ['plain', 'shorter', 'luxury', 'investor', 'family'] as const;
export type RewriteTone = (typeof REWRITE_TONES)[number];

const TONE_NOTE: Record<RewriteTone, string> = {
  plain: 'Plain and factual. Three or four sentences.',
  shorter: 'Two sentences at most. Cut everything that is not a fact.',
  luxury: 'Considered and understated. Never gaudy, never exclamation marks.',
  investor: 'For a buyer thinking about letting it out. Payment terms and handover matter most. '
    + 'Do NOT state or imply a yield, a return or a capital gain.',
  family: 'For a family who will live in it. Space, layout and the community matter most. '
    + 'Only mention schools, parks or hospitals if they are listed in the facts.',
};

export type DescribeInput = {
  name: string;
  developer?: string | null;
  emirate?: string | null;
  community?: string | null;
  propertyType?: string | null;
  handoverDate?: string | null;
  startingPriceAed?: number | null;
  paymentPlan?: string | null;
  amenities?: string[];
  tone?: RewriteTone;
  language?: 'en' | 'ar';
};

const INSTRUCTION = `You write short descriptions of off-plan property projects for a Dubai and
Abu Dhabi brokerage.

The rules, in order of importance:

1. Use ONLY the facts you are given below. Not one detail more. If the facts do not mention the
   beach, the metro, a school, a golf course or a view, then none of those exist as far as you are
   concerned. You are not describing a place you know; you are describing the facts on this list.
2. NEVER state or imply a return, a yield, a capital gain, a rental figure, or that a price will
   rise. This is regulated in the UAE and the brokerage is liable for it.
3. Never promise a handover date as certain. Write it as the developer states it.
4. No superlatives that cannot be checked: not "the best", not "the most exclusive", not
   "unrivalled", not "iconic".
5. Plain sentences. No exclamation marks. No estate-agent filler — "nestled", "boasts",
   "an oasis of", "a rare opportunity".
6. Return the description as plain text. No headings, no bullet points, no markdown, no quotes
   around it.`;

/** Facts as a list, so the model can see exactly how little it has been given. */
function factSheet(input: DescribeInput): string {
  const lines: string[] = [`Project name: ${input.name}`];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && String(value).trim()) lines.push(`${label}: ${value}`);
  };

  add('Developer', input.developer);
  add('Emirate', input.emirate?.replace(/_/g, ' '));
  add('Community', input.community);
  add('Property type', input.propertyType?.replace(/_/g, ' '));
  add('Handover, as the developer states it', input.handoverDate);
  add('Starting price', input.startingPriceAed ? `AED ${input.startingPriceAed.toLocaleString('en-AE')}` : null);
  add('Payment plan', input.paymentPlan);
  if (input.amenities?.length) lines.push(`Amenities listed: ${input.amenities.slice(0, 40).join(', ')}`);

  return lines.join('\n');
}

export async function describeProject(input: DescribeInput, userId: string | null): Promise<string> {
  const apiKey = await secret('GEMINI_API_KEY');
  if (!apiKey) throw badRequest('Emir AI is not connected yet. Add the key in Settings → Emir AI.');
  if (!(await withinCap())) {
    throw badRequest("This month's AI budget is used up. Raise it in Settings → Emir AI.");
  }

  const facts = factSheet(input);
  // Two lines of facts is not enough to write from, and asking anyway is how a
  // model ends up filling the gap itself.
  if (facts.split('\n').length < 3) {
    throw badRequest('Fill in a little more first — the developer, the community and the handover at least.');
  }

  const available = await cachedModels(apiKey);
  const candidates = candidateNames(
    rankModels(available),
    resolveModel((await setting('AI_MODEL')) ?? null, available),
  );

  const tone = input.tone ?? 'plain';
  const language = input.language === 'ar'
    ? 'Write in Arabic.'
    : 'Write in British English.';

  // The brokerage's own voice, so it does not read like a generic agent.
  const knowledge = await buildKnowledge('draft', input.language ?? 'en');

  const { text } = await callGemini({
    apiKey,
    candidates,
    feature: 'describe_project',
    userId,
    body: {
      systemInstruction: { parts: [{ text: `${INSTRUCTION}\n\n${knowledge}` }] },
      contents: [{
        role: 'user',
        parts: [{
          text: `${language}\n\nStyle: ${TONE_NOTE[tone]}\n\nThe facts, and nothing else:\n\n${facts}`,
        }],
      }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 700 },
    },
  });

  const description = (text ?? '').trim().replace(/^["'“]|["'”]$/g, '');
  if (!description) throw badRequest('Emir AI returned nothing. Try again.');
  return description;
}
