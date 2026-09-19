/**
 * Which Gemini model to call, and the one place the API version lives.
 *
 * This file exists because of a 404. The CRM shipped with two model names
 * written into it — `gemini-2.0-flash-lite` and `gemini-2.0-flash` — and the
 * owner's key answered "model not found" for both. Google retires and renames
 * models on its own schedule, so any name compiled into this codebase is a
 * guess with an expiry date on it.
 *
 * So the CRM asks instead. `listModels` reads what the key can actually use,
 * the Settings dropdown shows that list, and `pickDefault` chooses from it.
 * The constants below are only the ordering of preference and the last-resort
 * fallback for when Google cannot be reached at all.
 */
import { logger } from '../lib/logger.js';

/** The one place the Gemini API version is written down. */
export const GEMINI_API_VERSION = 'v1beta';
export const GEMINI_BASE = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}`;

/**
 * Google caps a `generateContent` request with inline data at 20 MB — and that
 * is the size of the *encoded* request, not of the file.
 *
 * Base64 inflates by about a third, so a 20 MB PDF arrives as roughly 27 MB
 * and Google answers 400. The route's own limit was set against the raw file,
 * which meant a large brochure was accepted by the CRM and then rejected by
 * Google with nothing useful said about why. 14 MB of PDF encodes to a little
 * under 19 MB, which leaves room for the prompt.
 */
export const GEMINI_INLINE_LIMIT_BYTES = 14 * 1024 * 1024;

/**
 * Which tier a model belongs to, and how new it is.
 *
 * A list of literal names was the second thing to age badly here: it knew
 * about 2.0 and 2.5 and nothing about the 3.x generation Google had already
 * moved on to, so the search fell through to "whatever came first", which was
 * a Pro model that the key was not allowed to call.
 *
 * Reading the tier and the generation out of the name instead means a
 * generation nobody here has heard of still sorts into the right place.
 */
export type ModelTier = 'flash-lite' | 'flash' | 'pro' | 'other';

const TIER_ORDER: Record<ModelTier, number> = {
  'flash-lite': 0,     // cheapest, and enough for almost everything
  flash: 1,
  pro: 2,              // capable and dear; a last resort, not a default
  other: 3,
};

export function parseModelName(name: string): { tier: ModelTier; generation: number; preview: boolean } {
  const lower = name.toLowerCase();

  const tier: ModelTier = lower.includes('flash-lite') ? 'flash-lite'
    : lower.includes('flash') ? 'flash'
      : lower.includes('pro') ? 'pro'
        : 'other';

  // `gemini-3.1-pro-preview` -> 3.1, `gemini-flash-latest` -> 0 (unversioned).
  const version = /gemini-(\d+(?:\.\d+)?)/.exec(lower);
  return {
    tier,
    generation: version?.[1] ? Number(version[1]) : 0,
    preview: lower.includes('preview') || lower.includes('-exp'),
  };
}

/**
 * Every usable model, best first.
 *
 * Cheapest tier first, because the owner asked for the spend to stay small and
 * Flash-Lite answers everything this CRM does. Within a tier, the newest
 * generation first, and a stable release ahead of a preview.
 */
export function rankModels(available: GeminiModel[], options: { forFile?: boolean } = {}): GeminiModel[] {
  return available
    .filter((row) => isTextModel(row.name))
    // A document needs more than the lite tier can do.
    .filter((row) => !(options.forFile && parseModelName(row.name).tier === 'flash-lite'))
    .map((row) => ({ row, meta: parseModelName(row.name) }))
    .sort((a, b) =>
      TIER_ORDER[a.meta.tier] - TIER_ORDER[b.meta.tier]
      || b.meta.generation - a.meta.generation
      || Number(a.meta.preview) - Number(b.meta.preview)
      || a.row.name.localeCompare(b.row.name))
    .map(({ row }) => row);
}

/**
 * Whether a failure means "not that model" rather than "not that request".
 *
 * Google's catalogue lists models a given key may not call — the owner's key
 * was offered `gemini-2.5-pro` and then told, on using it, that it "is no
 * longer available to new users". A catalogue entry is therefore an offer, not
 * a guarantee, and the only way to know is to try the next one.
 */
export function isModelUnavailable(status: number, detail: string | null): boolean {
  if (status === 404) return true;
  if (status !== 400 && status !== 403) return false;

  const text = (detail ?? '').toLowerCase();
  return [
    'no longer available',
    'not available',
    'is not found',
    'not found for api version',
    'does not have access',
    'not supported for',
    'is not supported',
    'deprecated',
    'update your code to use',
  ].some((phrase) => text.includes(phrase));
}

/** How many models to try before giving up and reporting the last failure. */
export const MAX_MODEL_ATTEMPTS = 3;

/**
 * Used only when the model list cannot be fetched. Deliberately a current
 * family name rather than a dated one — a bad guess here produces the same
 * 404 this file exists to fix, so the error message has to survive it.
 */
export const FALLBACK_MODEL = 'gemini-2.5-flash-lite';

/**
 * Models that answer with text, which is the only kind this CRM can use.
 *
 * Google's catalogue lists image-generation, speech and live-audio models
 * alongside the ordinary ones, and they all report `generateContent`. The
 * names are the giveaway, and the names also overlap: `gemini-2.5-flash-image`
 * starts with `gemini-2.5-flash`, so a prefix search for the flash family
 * could — and did — settle on an image generator. Asked for JSON, that answers
 * 400, which is exactly the "rejected as malformed" the owner saw.
 *
 * Excluded by suffix rather than by an allow-list, so a new text model shows
 * up on its own and only the special-purpose ones have to be named.
 */
const NON_TEXT_MARKERS = [
  '-image', '-tts', '-audio', '-live', '-dialog', '-vision-', 'embedding', 'aqa', 'imagen', 'veo',
];

export function isTextModel(name: string): boolean {
  const lower = name.toLowerCase();
  return !NON_TEXT_MARKERS.some((marker) => lower.includes(marker));
}

export type GeminiModel = {
  /** As the API wants it: no `models/` prefix. */
  name: string;
  displayName: string;
  description: string;
  inputTokenLimit: number | null;
};

/**
 * Ask the key what it can use.
 *
 * Returns only models that can actually answer a prompt — the list also holds
 * embedding and image models, which would 404 in a different way if someone
 * picked one out of the dropdown.
 */
export async function listModels(apiKey: string): Promise<GeminiModel[]> {
  const response = await fetch(`${GEMINI_BASE}/models?pageSize=200`, {
    headers: { 'x-goog-api-key': apiKey },
  });

  if (!response.ok) {
    logger.warn('could not list Gemini models', { status: response.status });
    throw new Error(String(response.status));
  }

  const json = (await response.json()) as {
    models?: {
      name?: string;
      displayName?: string;
      description?: string;
      inputTokenLimit?: number;
      supportedGenerationMethods?: string[];
    }[];
  };

  return (json.models ?? [])
    .filter((row) => (row.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((row) => ({
      name: (row.name ?? '').replace(/^models\//, ''),
      displayName: row.displayName ?? '',
      description: row.description ?? '',
      inputTokenLimit: row.inputTokenLimit ?? null,
    }))
    .filter((row) => row.name.startsWith('gemini-'))
    .filter((row) => isTextModel(row.name));
}

/*
 * The catalogue changes about as often as Google ships a model, so it is held
 * for a few minutes rather than fetched before every call. Keyed by the API
 * key so switching keys cannot serve the previous one's list.
 */
const CATALOGUE_TTL_MS = 10 * 60 * 1000;
const catalogue = new Map<string, { at: number; models: GeminiModel[] }>();

/** The models this key can use, cached, or an empty list if Google cannot be asked. */
export async function cachedModels(apiKey: string): Promise<GeminiModel[]> {
  const hit = catalogue.get(apiKey);
  if (hit && Date.now() - hit.at < CATALOGUE_TTL_MS) return hit.models;

  try {
    const models = await listModels(apiKey);
    catalogue.set(apiKey, { at: Date.now(), models });
    return models;
  } catch {
    // An empty list means "could not ask", and every caller treats it that way.
    return hit?.models ?? [];
  }
}

/** Test helper, and used when a key changes. */
export function clearModelCache(): void {
  catalogue.clear();
}

/**
 * The model a call should actually use.
 *
 * `configured ?? pickDefault(...)` is not enough: the owner's saved model was
 * `gemini-2.0-flash-lite`, their key did not have it, and a saved value beats
 * a default every time — so the 404 repeated on every attempt until someone
 * went into Settings and changed it. A configured name that Google does not
 * report is not a preference, it is a stale value, so it is replaced here and
 * the call goes through.
 *
 * An empty list means Google could not be asked; the configured name is then
 * honoured and the real call reports what happened.
 */
export function resolveModel(configured: string | null, available: GeminiModel[]): string {
  if (!configured) return pickDefault(available);
  if (available.length === 0) return configured;
  if (available.some((row) => row.name === configured && isTextModel(row.name))) return configured;

  logger.warn('configured model is not one this key has; falling back', { configured });
  return pickDefault(available);
}

/**
 * The cheapest capable model the key actually has.
 *
 * Falls back to the first Gemini the key reports rather than to a hard-coded
 * name, because a list that came back from Google is evidence and a constant
 * in this file is not.
 */
export function pickDefault(available: GeminiModel[]): string {
  return rankModels(available)[0]?.name ?? FALLBACK_MODEL;
}

/**
 * Reading a PDF needs more than the lite tier, so a lite model steps up to its
 * full sibling — but only if the key has one. Stepping up to a model that is
 * not there would turn a working call into the 404 this file exists to fix.
 */
export function stepUpForFiles(model: string, available: GeminiModel[]): string {
  if (parseModelName(model).tier !== 'flash-lite') return model;

  // No list means Google could not be asked, not that the key has nothing.
  if (available.length === 0) return model.replace(/-lite(-|$)/, '$1');

  return rankModels(available, { forFile: true })[0]?.name ?? model;
}

/**
 * Google's own explanation for a failed call.
 *
 * An error response is `{"error":{"code","message","status"}}` — it does not
 * echo the request, so reading it cannot leak the document that was sent. Only
 * the message is taken, and it is capped, so nothing else can ride along.
 *
 * Worth the trouble because the alternative is what shipped first: a generic
 * "rejected as malformed" that told the owner nothing and left me guessing.
 */
export async function readGeminiError(response: Response): Promise<string | null> {
  try {
    const json = (await response.json()) as { error?: { message?: string; status?: string } };
    const message = json.error?.message?.trim();
    if (!message) return null;
    return message.length > 400 ? `${message.slice(0, 400)}…` : message;
  } catch {
    return null;
  }
}

/**
 * What went wrong, in words that name the actual cause.
 *
 * The old message said "check the key has billing enabled" for every failure,
 * which sent the owner to the billing page for a problem that was a stale
 * model name. A wrong diagnosis costs more than no diagnosis — and a vague one
 * ("rejected as malformed") is barely better, which is why `detail` carries
 * Google's own sentence through to the screen.
 */
export function explainGeminiError(status: number, model: string, detail?: string | null): string {
  const because = detail ? ` Google said: ${detail}` : '';
  if (status === 404) {
    return `Google does not have a model called "${model}" for your key. `
      + 'Open Settings → Emir AI and pick one from the list — it now shows exactly '
      + `what your key can use.${because}`;
  }
  if (status === 400) {
    return `Google would not accept that request.${because}`;
  }
  if (status === 401 || status === 403) {
    return 'Google would not accept the key. Check it is correct in Settings → Emir AI, '
      + `that the Generative Language API is enabled on that project, and that billing is on.${because}`;
  }
  if (status === 429) {
    return `Google is rate-limiting the key right now. Wait a minute and try again.${because}`;
  }
  if (status >= 500) {
    return `Google had a problem on their side. Try again in a moment.${because}`;
  }
  return `Emir AI could not complete that (${status}).${because}`;
}
