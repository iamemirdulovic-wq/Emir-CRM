/**
 * Reading a developer's own website into a developer record.
 *
 * The design's Add-developer drawer opens with one box — "Developer website or
 * name" — and a sparkle beside it, because the legal name, ORN and TRN are
 * exactly the fields nobody in a brokerage remembers and everybody needs: they
 * go on every offer sheet the client sees.
 *
 * The same two rules as `extract-project.ts`. Nothing is saved — the drawer
 * fills in, a person checks it and presses the button. And a field the site
 * does not state comes back null: an invented ORN on a client-facing document
 * is worse than a blank one, because a blank is obviously missing.
 */
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { withinCap } from './usage.js';
import { setting, secret } from '../config/secrets.js';
import { badRequest } from '../lib/errors.js';
import { cachedModels, rankModels, resolveModel } from './models.js';
import { callGemini, candidateNames } from './call-gemini.js';

/** Trimmed to the lengths POST /api/library/developers already accepts. */
const capped = (max: number) => z.string().transform((value) => value.trim().slice(0, max));

export const extractedDeveloperSchema = z.object({
  legalName: capped(200).nullable(),
  shortName: capped(120).nullable(),
  orn: capped(64).nullable(),
  trn: capped(64).nullable(),
  headOffice: capped(255).nullable(),
  escrowBank: capped(160).nullable(),
  website: capped(255).nullable(),
  trackRecord: capped(5_000).nullable(),
  /** 0–1 per field, so the drawer can mark what to check first. */
  confidence: z.record(z.number()).nullable(),
});

export type ExtractedDeveloper = z.infer<typeof extractedDeveloperSchema>;

const INSTRUCTION = `You look up UAE property developers for a Dubai and Abu Dhabi brokerage and
return their registration details as structured data.

Return ONLY JSON matching the shape you are given. No prose, no code fences.

The rules, in order of importance:

1. NEVER invent a value. An ORN or TRN you are not sure of goes on an offer sheet that a buyer
   reads and a regulator could ask about. Return null unless you actually know it. Null is always
   the right answer when you are not certain.
2. legalName is the registered company name including its suffix — "Emaar Properties PJSC",
   "Aldar Properties PJSC". shortName is what people call them — "Emaar", "Aldar".
3. orn is the Dubai ORN (Office Registration Number) or the Abu Dhabi equivalent, digits only as
   printed. trn is the 15-digit VAT Tax Registration Number. Return null for either unless you
   are confident.
4. headOffice is the street address of their head office.
5. escrowBank is the bank holding their project escrow accounts, only if you know it.
6. trackRecord is 1-3 plain sentences on what they have delivered: founded, projects handed over,
   the communities they are known for. Facts only, no selling language.
7. confidence: a number from 0 to 1 for each field you filled. Do not include fields you left null.`;

export type ExtractDeveloperResult = {
  extracted: ExtractedDeveloper;
  filled: string[];
  model: string;
};

/**
 * Ask Gemini what it knows about this developer.
 *
 * `query` is whatever the user typed in the one box: a website, a name, or
 * both. Deliberately not fetched server-side first — the page behind a
 * developer's domain is usually a JavaScript shell with no registration
 * details in the HTML, so a fetch would add a dependency and return less.
 */
export async function extractDeveloper(
  query: string,
  userId: string | null,
): Promise<ExtractDeveloperResult> {
  const apiKey = await secret('GEMINI_API_KEY');
  if (!apiKey) throw badRequest('Emir AI is not connected yet. Add the key in Settings → Emir AI.');
  if (!(await withinCap())) {
    throw badRequest("This month's AI budget is used up. Raise it in Settings → Emir AI.");
  }

  const available = await cachedModels(apiKey);
  const candidates = candidateNames(
    rankModels(available),
    resolveModel((await setting('AI_MODEL')) ?? null, available),
  );

  const { text: raw, model } = await callGemini({
    apiKey,
    candidates,
    feature: 'extract_developer',
    userId,
    body: {
      systemInstruction: { parts: [{ text: INSTRUCTION }] },
      contents: [{
        role: 'user',
        parts: [{
          text:
            `The developer is: ${query}\n\n`
            + 'Return what you know about this UAE property developer as JSON. '
            + 'If you do not recognise them, return nulls rather than guessing from the name.',
        }],
      }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 2048 },
    },
  });

  if (!raw) throw badRequest('Emir AI returned nothing. Try again, or type the details in.');

  const extracted = safeParseDeveloper(raw);
  if (!extracted) throw badRequest("Emir AI could not make sense of that. Type the details in instead.");

  return { extracted, filled: filledDeveloperFields(extracted), model };
}

/**
 * Parse the reply, tolerating fences and prose, and validating key by key so
 * one bad field does not discard the rest. See `fieldByField` in
 * extract-project.ts for why `.partial().safeParse` is not enough.
 */
export function safeParseDeveloper(raw: string): ExtractedDeveloper | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      value = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, schema] of Object.entries(extractedDeveloperSchema.shape)) {
    if (!(key in source) || source[key] === undefined) continue;
    const parsed = schema.safeParse(source[key]);
    if (parsed.success) out[key] = parsed.data;
    else logger.debug('developer lookup dropped a field that did not fit', { field: key });
  }

  const data = out as Partial<ExtractedDeveloper>;
  return {
    legalName: blankToNull(data.legalName),
    shortName: blankToNull(data.shortName),
    orn: blankToNull(data.orn),
    trn: blankToNull(data.trn),
    headOffice: blankToNull(data.headOffice),
    escrowBank: blankToNull(data.escrowBank),
    website: blankToNull(data.website),
    trackRecord: blankToNull(data.trackRecord),
    confidence: data.confidence ?? null,
  };
}

/** Trimming can leave an empty string, which is a missing field, not a value. */
function blankToNull(value: string | null | undefined): string | null {
  return value ? value : null;
}

/** The names of the fields that actually came back with something. */
export function filledDeveloperFields(extracted: ExtractedDeveloper): string[] {
  return Object.entries(extracted)
    .filter(([key, value]) => key !== 'confidence' && value !== null && value !== undefined)
    .map(([key]) => key);
}
