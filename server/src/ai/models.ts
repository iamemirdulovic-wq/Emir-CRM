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
 * What to reach for, cheapest first.
 *
 * Matched as prefixes against whatever Google reports, so a dated release
 * (`gemini-2.5-flash-lite-preview-09-2025`) is picked up by the family name
 * without this list needing to know about it.
 */
export const PREFERRED_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-latest',
  'gemini-1.5-flash',
] as const;

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
  const text = available.filter((row) => isTextModel(row.name));
  for (const preferred of PREFERRED_MODELS) {
    const hit = text.find((row) => row.name.startsWith(preferred));
    if (hit) return hit.name;
  }
  return text[0]?.name ?? FALLBACK_MODEL;
}

/**
 * Reading a PDF needs more than the lite tier, so a lite model steps up to its
 * full sibling — but only if the key has one. Stepping up to a model that is
 * not there would turn a working call into the 404 this file exists to fix.
 */
export function stepUpForFiles(model: string, available: GeminiModel[]): string {
  if (!model.includes('lite')) return model;

  const full = model.replace(/-lite(-|$)/, '$1');
  if (available.some((row) => row.name === full)) return full;
  if (available.length === 0) return full;   // no list to check against; try anyway

  /*
   * Only the non-lite models are candidates, and they are filtered before the
   * prefix search rather than inside it: 'gemini-2.5-flash-lite' starts with
   * 'gemini-2.5-flash', so searching the whole list finds the very model we
   * are trying to step up from.
   */
  const fullModels = available.filter((row) => !row.name.includes('lite') && isTextModel(row.name));

  for (const preferred of PREFERRED_MODELS.filter((name) => !name.includes('lite'))) {
    const hit = fullModels.find((row) => row.name.startsWith(preferred));
    if (hit) return hit.name;
  }

  /*
   * Nothing from the preferred list, so take any non-lite model the key has —
   * Pro included. It costs more than Flash, but a document the CRM cannot read
   * is worth nothing at all, and the monthly cap is what bounds the spend.
   */
  return fullModels[0]?.name ?? model;
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
