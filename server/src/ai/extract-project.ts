/**
 * Reading a developer's document into a project.
 *
 * This is what the design means by "Emir AI can build the whole project from
 * one file". A brokerage receives a sales offer, a brochure or a price list as
 * a PDF; typing it into eighteen boxes is the reason a project library stays
 * empty, so the document is sent to Gemini and comes back as fields.
 *
 * Two rules shape everything here:
 *
 * **Nothing is saved.** The extraction is a suggestion. Every field carries a
 * confidence score, the wizard highlights what was filled, and a person presses
 * the button. The AI never writes to the library.
 *
 * **A missing field stays missing.** The model is told, repeatedly, to leave a
 * field null rather than guess it — because a guessed handover date or price
 * goes out to a buyer over WhatsApp with the brokerage's name on it.
 */
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { buildKnowledge } from './knowledge.js';
import { estimateTokens, recordUsage, withinCap } from './usage.js';
import { setting, secret } from '../config/secrets.js';
import {
  explainGeminiError, GEMINI_BASE, GEMINI_INLINE_LIMIT_BYTES, listModels, readGeminiError,
  resolveModel, stepUpForFiles,
} from './models.js';
import { badRequest } from '../lib/errors.js';

/** A unit row with every optional field present, so callers need no guards. */
function fillNulls(unit: {
  unitNo: string;
  bedrooms?: number | null; floor?: string | null; internalAreaSqft?: number | null;
  view?: string | null; priceAed?: number | null;
}) {
  return {
    unitNo: unit.unitNo,
    bedrooms: unit.bedrooms ?? null,
    floor: unit.floor ?? null,
    internalAreaSqft: unit.internalAreaSqft ?? null,
    view: unit.view ?? null,
    priceAed: unit.priceAed ?? null,
  };
}

/** A string trimmed to what the matching import endpoint stores. */
const capped = (max: number) => z.string().transform((value) => value.trim().slice(0, max));

/**
 * A number the import endpoints will accept: whole, in range, and clamped
 * rather than rejected — a price list that prints one absurd figure should
 * still import the other forty rows.
 */
const wholeNumber = (min: number, max: number) =>
  z.number().transform((value) => Math.min(Math.max(Math.round(value), min), max));

/** What the wizard's five steps need, and nothing more. */
export const extractedSchema = z.object({
  /* The caps are the ones POST /api/library already enforces, so anything the
     model returns is saveable as it stands. */
  name: capped(160).nullable(),
  developer: capped(160).nullable(),
  emirate: z.enum(['dubai', 'abu_dhabi', 'sharjah', 'ras_al_khaimah', 'ajman', 'fujairah', 'umm_al_quwain', 'other']).nullable(),
  community: capped(160).nullable(),
  propertyType: z.enum(['apartment', 'townhouse', 'villa', 'penthouse', 'plot', 'office', 'mixed']).nullable(),
  saleStatus: z.enum(['selling_now', 'coming_soon', 'sold_out']).nullable(),
  handoverDate: capped(48).nullable(),
  startingPriceAed: wholeNumber(0, 10_000_000_000).nullable(),
  paymentPlan: capped(255).nullable(),
  reraNo: capped(64).nullable(),
  serviceChargeSqft: z.number().min(0).nullable(),
  ownership: z.enum(['freehold', 'leasehold']).nullable(),
  description: capped(10_000).nullable(),
  amenities: z.array(capped(120)).max(200).nullable(),
  /*
   * Shaped to what POST /api/library/:id/units already accepts — whole
   * numbers, trimmed strings, the same length caps. A model that returns
   * 1790000.5 or a forty-character floor label would otherwise sail through
   * here and be rejected at import, and the units read from the brochure
   * would quietly not arrive.
   */
  units: z.array(z.object({
    unitNo: capped(64),
    bedrooms: wholeNumber(0, 20).nullish(),
    floor: capped(24).nullish(),
    internalAreaSqft: z.number().min(0).nullish(),
    view: capped(160).nullish(),
    priceAed: wholeNumber(0, 10_000_000_000).nullish(),
  }).transform(fillNulls)).nullable(),
  paymentMilestones: z.array(z.object({
    milestone: capped(200),
    percent: z.number().min(0).max(100),
    dueNote: capped(160).nullish(),
  }).transform((row) => ({ ...row, dueNote: row.dueNote ?? null }))).max(60).nullable(),
  /** 0–1 per field name, so the wizard can mark what to check first. */
  confidence: z.record(z.number()).nullable(),
});

export type ExtractedProject = z.infer<typeof extractedSchema>;

const INSTRUCTION = `You read real-estate developer documents for a Dubai and Abu Dhabi brokerage
and turn them into structured project data.

Return ONLY JSON matching the shape you are given. No prose, no code fences.

The rules, in order of importance:

1. NEVER invent a value. If the document does not state something, return null for it. A guessed
   price, handover date or payment plan is sent to a buyer over WhatsApp with the brokerage's name
   on it. Null is always the right answer when you are not certain.
2. Copy figures exactly as printed. Do not convert currencies, do not round, do not calculate a
   price per square foot that is not written down.
3. Prices are in AED as a plain number: "AED 1,790,000" becomes 1790000.
4. handoverDate is the developer's own wording — "Q4 2027", "December 2028".
5. paymentPlan is the headline only — "60 / 40", "80 / 20". The milestones go in
   paymentMilestones.
6. Put every unit you can read in units[]. A price list may hold dozens; include them all.
7. description: 2-4 plain sentences built ONLY from facts in this document. No selling language,
   no claims about returns or investment.
8. confidence: a number from 0 to 1 for each field you filled, where 1 means it was printed
   plainly and 0.5 means you inferred it from context. Do not include fields you left null.`;

/**
 * The models this key can use, or an empty list if Google cannot be asked.
 *
 * A failure here must not stop the extraction: an empty list simply means the
 * caller falls back to the configured name and finds out from the real call.
 */
export async function availableModels(apiKey: string): Promise<Awaited<ReturnType<typeof listModels>>> {
  try {
    return await listModels(apiKey);
  } catch {
    return [];
  }
}

export type ExtractInput =
  | { kind: 'file'; data: Buffer; mimeType: string; filename: string }
  | { kind: 'link'; url: string };

export type ExtractResult = {
  extracted: ExtractedProject;
  /** Which fields came back with something in them. */
  filled: string[];
  model: string;
};

/**
 * Ask Gemini to read the document.
 *
 * Called directly rather than through the `AiProvider` interface because this
 * one needs to send a file, and widening that interface for a single caller
 * would push multimodal concerns into every other provider.
 */
export async function extractProject(
  input: ExtractInput,
  userId: string | null,
): Promise<ExtractResult> {
  const apiKey = await secret('GEMINI_API_KEY');
  if (!apiKey) throw badRequest('Emir AI is not connected yet. Add the key in Settings → Emir AI.');
  if (!(await withinCap())) {
    throw badRequest("This month's AI budget is used up. Raise it in Settings → Emir AI.");
  }

  /*
   * Flash-Lite cannot read a PDF, so reading a document steps up to the full
   * model — but only to one the key actually has. Both the default and the
   * step-up are checked against Google's own list rather than a name written
   * into this file, because a stale name is a 404 the owner cannot fix.
   */
  const available = await availableModels(apiKey);
  const configured = resolveModel((await setting('AI_MODEL')) ?? null, available);
  const model = input.kind === 'file' ? stepUpForFiles(configured, available) : configured;

  // The owner's own knowledge, so a description sounds like their brokerage.
  const knowledge = await buildKnowledge('draft');

  const parts: Record<string, unknown>[] = [];
  if (input.kind === 'file') {
    /*
     * Checked here rather than only at the route, because the limit that
     * matters is Google's and it is about the encoded request. Refusing it
     * now gives the owner a sentence they can act on instead of a 400.
     */
    if (input.data.length > GEMINI_INLINE_LIMIT_BYTES) {
      throw badRequest(
        `That file is ${Math.round(input.data.length / (1024 * 1024))} MB. Google will not accept more `
        + `than about ${Math.round(GEMINI_INLINE_LIMIT_BYTES / (1024 * 1024))} MB in one go — send the `
        + 'price list or the offer rather than the full brochure.',
      );
    }
    parts.push({ inlineData: { mimeType: input.mimeType, data: input.data.toString('base64') } });
    parts.push({ text: `Read this document (${input.filename}) and return the project as JSON.` });
  } else {
    parts.push({
      text:
        `Read the developer project page at ${input.url} and return the project as JSON. `
        + 'If you cannot read the page, return nulls rather than guessing from the address.',
    });
  }

  const body = {
    systemInstruction: { parts: [{ text: `${INSTRUCTION}\n\n${knowledge}` }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
    },
  };

  let raw: string | null = null;
  let usage = { input: 0, output: 0 };

  try {
    const response = await fetch(
      `${GEMINI_BASE}/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      /*
       * Google's `error.message` says precisely what it objected to. It does
       * not echo the request, so taking it cannot leak the document — and
       * without it the owner sees only "rejected", which helps nobody.
       */
      const detail = await readGeminiError(response);
      logger.warn('project extraction failed', { status: response.status, model, detail });
      throw badRequest(explainGeminiError(response.status, model, detail));
    }

    const json = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    usage = {
      input: json.usageMetadata?.promptTokenCount ?? estimateTokens(JSON.stringify(body)),
      output: json.usageMetadata?.candidatesTokenCount ?? estimateTokens(raw ?? ''),
    };
  } finally {
    await recordUsage({
      userId,
      feature: 'extract_project',
      model,
      inputTokens: usage.input,
      outputTokens: usage.output,
      ok: Boolean(raw),
    });
  }

  if (!raw) throw badRequest('Emir AI read the document but returned nothing. Try again.');

  const parsed = safeParse(raw);
  if (!parsed) throw badRequest('Emir AI could not make sense of that document. Try another file, or type it in.');

  return { extracted: parsed, filled: filledFields(parsed), model };
}


/**
 * Validate one key at a time, keeping what fits and discarding what does not.
 *
 * Deliberately not `extractedSchema.partial().safeParse(value)`: zod fails the
 * whole object on a single bad key, so a model that answered `"emirate":
 * "riyadh"` would take a forty-row price list down with it. Here that one key
 * is dropped and the rest of the document survives.
 *
 * Returns null only when the reply is not an object at all.
 */
function fieldByField(value: unknown): Partial<ExtractedProject> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, schema] of Object.entries(extractedSchema.shape)) {
    if (!(key in source) || source[key] === undefined) continue;
    const parsed = schema.safeParse(source[key]);
    if (parsed.success) out[key] = parsed.data;
    else logger.debug('extraction dropped a field that did not fit', { field: key });
  }

  return out as Partial<ExtractedProject>;
}

/**
 * Parse the reply, tolerating a model that wrapped it in prose or fences, and
 * dropping any field that does not fit the schema rather than failing the lot —
 * one bad enum should not lose a whole price list. See fieldByField.
 */
export function safeParse(raw: string): ExtractedProject | null {
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

  const data = fieldByField(value);
  if (!data) return null;
  return {
    name: data.name ?? null,
    developer: data.developer ?? null,
    emirate: data.emirate ?? null,
    community: data.community ?? null,
    propertyType: data.propertyType ?? null,
    saleStatus: data.saleStatus ?? null,
    handoverDate: data.handoverDate ?? null,
    startingPriceAed: data.startingPriceAed ?? null,
    paymentPlan: data.paymentPlan ?? null,
    reraNo: data.reraNo ?? null,
    serviceChargeSqft: data.serviceChargeSqft ?? null,
    ownership: data.ownership ?? null,
    description: data.description ?? null,
    /*
     * Trimming can leave a row with nothing to identify it, and an unnamed
     * unit or amenity is rejected by the endpoint that stores it. Drop those
     * rows and keep the rest, rather than losing the whole list to one of
     * them.
     */
    amenities: keep(data.amenities?.map((name) => name.trim()).filter(Boolean)),
    units: keep(data.units?.filter((unit) => unit.unitNo.length > 0)),
    paymentMilestones: keep(data.paymentMilestones?.filter((row) => row.milestone.length > 0)),
    confidence: data.confidence ?? null,
  };
}

/** An array, unless there is nothing left in it — then null, meaning absent. */
function keep<T>(rows: T[] | undefined): T[] | null {
  return rows && rows.length > 0 ? rows : null;
}

/** The names of the fields that actually came back with something. */
export function filledFields(extracted: ExtractedProject): string[] {
  const filled: string[] = [];
  for (const [key, value] of Object.entries(extracted)) {
    if (key === 'confidence') continue;
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    filled.push(key);
  }
  return filled;
}
