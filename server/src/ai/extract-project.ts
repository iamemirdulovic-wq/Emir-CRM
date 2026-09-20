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
import { withinCap } from './usage.js';
import { setting, secret } from '../config/secrets.js';
import { cachedModels, rankModels, resolveModel } from './models.js';
import { callGemini, candidateNames } from './call-gemini.js';
import { fetchPage } from './fetch-page.js';
import { usefulImages } from './pdf-images.js';
import { deleteFromGemini, INLINE_THRESHOLD_BYTES, uploadToGemini } from './gemini-files.js';
import { readDocument, readWholeDocument, type StoredDocument } from './document-store.js';
import { extractPdfImagesFromFile } from './pdf-images.js';
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
   plainly and 0.5 means you inferred it from context. Do not include fields you left null.
9. When you are given the text of a web page, use only what that text says. Do not fill a field
   from what you happen to know about the project elsewhere — the page is the source.`;

export type ExtractInput =
  /*
   * A document arrives as a file on disk, not as bytes in hand. A 400 MB
   * brochure held in memory is 400 MB of a shared process, and two at once is
   * the CRM going down for everyone.
   */
  | { kind: 'file'; document: StoredDocument; mimeType: string; filename: string }
  | { kind: 'link'; url: string };

export type ExtractResult = {
  extracted: ExtractedProject;
  /** Which fields came back with something in them. */
  filled: string[];
  model: string;
  /** Pictures found on the page, for the wizard to offer as the cover. */
  images?: string[];
  /** Photographs lifted out of the PDF, as data URLs the wizard can show. */
  pdfImages?: { dataUrl: string; width: number | null; height: number | null }[];
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
   * Models to try, best first. Google's catalogue is an offer rather than a
   * guarantee — a key can be listed a model and then refused it on use — so
   * the caller falls through to the next one when that happens.
   */
  const available = await cachedModels(apiKey);
  const forFile = input.kind === 'file';
  const configured = resolveModel((await setting('AI_MODEL')) ?? null, available);
  const ranked = rankModels(available, { forFile });
  const candidates = candidateNames(
    ranked,
    // Flash-Lite cannot read a document, so a file skips whatever is saved if
    // that is what it is.
    forFile && !ranked.some((row) => row.name === configured) ? null : configured,
  );

  // The owner's own knowledge, so a description sounds like their brokerage.
  const knowledge = await buildKnowledge('draft');

  const parts: Record<string, unknown>[] = [];
  let page: Awaited<ReturnType<typeof fetchPage>> | null = null;
  let pdfImages: ReturnType<typeof usefulImages> = [];
  let uploaded: Awaited<ReturnType<typeof uploadToGemini>> | null = null;
  if (input.kind === 'file') {
    /*
     * The brochure's own photographs, taken out before it is sent. Gemini
     * reads the words; the renders are in the file already and do not need a
     * model to find them.
     */
    if (input.mimeType === 'application/pdf') {
      // Read from disk in windows, so the file is never held whole.
      pdfImages = usefulImages(await extractPdfImagesFromFile(input.document.filePath));
    }

    if (input.document.bytes > INLINE_THRESHOLD_BYTES) {
      /*
       * Too big to ride along in the request. Streamed to Google's Files API
       * and referenced by URI, which raises the ceiling from 20 MB to 2 GB —
       * and streamed, so a 400 MB brochure costs a file handle, not memory.
       */
      uploaded = await uploadToGemini(apiKey, {
        body: readDocument(input.document),
        bytes: input.document.bytes,
        mimeType: input.mimeType,
        filename: input.filename,
      });
      parts.push({ fileData: { mimeType: input.mimeType, fileUri: uploaded.uri } });
    } else {
      // Small enough that loading it is cheaper than a second round trip.
      const data = await readWholeDocument(input.document, INLINE_THRESHOLD_BYTES);
      parts.push({ inlineData: { mimeType: input.mimeType, data: data.toString('base64') } });
    }
    parts.push({ text: `Read this document (${input.filename}) and return the project as JSON.` });
  } else {
    /*
     * The page is fetched here and handed over as text. Gemini has no browser:
     * given a bare address it can only guess from the words in the URL, which
     * is exactly the invention this whole file exists to prevent — and in
     * practice it returned nulls and the wizard filled in nothing.
     */
    page = await fetchPage(input.url);
    if (page.text.trim().length < 80) {
      throw badRequest(
        'There was almost no text on that page — it is probably built in a way that needs a '
        + 'browser to read. Drop the developer\'s PDF instead, or type it in.',
      );
    }
    parts.push({
      text:
        `Read this developer project page and return the project as JSON.\n\n`
        + `Page address: ${page.url}\n\n${page.text}`,
    });
  }

  let answer: { text: string | null; model: string };
  try {
    answer = await callGemini({
      apiKey,
      candidates,
      feature: 'extract_project',
      userId,
      body: {
        systemInstruction: { parts: [{ text: `${INSTRUCTION}\n\n${knowledge}` }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          maxOutputTokens: 8192,
        },
      },
    });
  } finally {
    /*
     * Our copy on Google's disk is not needed once the answer is in hand.
     * Best effort: it expires there on its own in about two days, and a
     * failure to tidy up must never lose an extraction that succeeded.
     */
    if (uploaded) await deleteFromGemini(apiKey, uploaded.name);
  }

  const { text: raw, model } = answer;

  if (!raw) throw badRequest('Emir AI read the document but returned nothing. Try again.');

  const parsed = safeParse(raw);
  if (!parsed) throw badRequest('Emir AI could not make sense of that document. Try another file, or type it in.');

  return {
    extracted: parsed,
    filled: filledFields(parsed),
    model,
    images: page?.images ?? [],
    pdfImages: pdfImages.map((image) => ({
      dataUrl: `data:image/jpeg;base64,${image.data.toString('base64')}`,
      width: image.width,
      height: image.height,
    })),
  };
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
