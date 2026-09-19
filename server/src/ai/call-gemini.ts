/**
 * One Gemini `generateContent` call, retried across models when Google says
 * the problem is the model rather than the request.
 *
 * This exists because Google's catalogue is an offer, not a guarantee. The
 * owner's key was listed `gemini-2.5-pro` and then told, on using it, that the
 * model "is no longer available to new users" — so asking for the list is not
 * enough on its own. The only way to know a model works is to call it, and the
 * only sensible response to "not that one" is to try the next.
 *
 * A rejected call costs no tokens, so the retries are free; only a call that
 * actually ran is recorded against the monthly budget.
 */
import { logger } from '../lib/logger.js';
import { badRequest } from '../lib/errors.js';
import { estimateTokens, recordUsage } from './usage.js';
import {
  explainGeminiError, GEMINI_BASE, isModelUnavailable, MAX_MODEL_ATTEMPTS, readGeminiError,
  type GeminiModel,
} from './models.js';

export type GeminiCall = {
  apiKey: string;
  /** Models to try, best first. The first that is not refused outright wins. */
  candidates: string[];
  body: Record<string, unknown>;
  /** For the usage log, so spend can be read per feature. */
  feature: string;
  userId: string | null;
};

export type GeminiResult = { text: string | null; model: string };

export async function callGemini(call: GeminiCall): Promise<GeminiResult> {
  const tried = call.candidates.slice(0, MAX_MODEL_ATTEMPTS);
  if (tried.length === 0) throw badRequest('No usable Gemini model is configured.');

  let lastStatus = 0;
  let lastModel = tried[0] as string;
  /*
   * The most recent refusal that came with a reason, kept together with the
   * model it was about. A body that cannot be parsed must not throw away a
   * perfectly good explanation from an earlier attempt — that is the
   * difference between "Google said: use gemini-3.1-pro-preview" and a message
   * with nothing actionable in it.
   */
  let explained: { status: number; detail: string; model: string } | null = null;

  for (const model of tried) {
    lastModel = model;
    let text: string | null = null;
    let usage = { input: 0, output: 0 };
    let ran = false;

    try {
      const response = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': call.apiKey },
        body: JSON.stringify(call.body),
      });

      if (!response.ok) {
        /*
         * Google's `error.message` says precisely what it objected to. It does
         * not echo the request, so reading it cannot leak the document.
         */
        lastStatus = response.status;
        const detail = await readGeminiError(response);
        if (detail) explained = { status: response.status, detail, model };

        if (isModelUnavailable(response.status, detail)) {
          logger.warn('gemini refused the model; trying the next one', {
            model, status: response.status, detail,
          });
          continue;   // nothing ran, so nothing to record
        }

        logger.warn('gemini call failed', { model, status: response.status, detail });
        throw badRequest(explainGeminiError(response.status, model, detail));
      }

      const json = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      // Parts can be split, and a thinking model puts its answer in the last one.
      text = (json.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')
        .trim() || null;
      ran = true;
      usage = {
        input: json.usageMetadata?.promptTokenCount ?? estimateTokens(JSON.stringify(call.body)),
        output: json.usageMetadata?.candidatesTokenCount ?? estimateTokens(text ?? ''),
      };
    } finally {
      // Only a call that actually reached the model costs anything.
      if (ran) {
        await recordUsage({
          userId: call.userId,
          feature: call.feature,
          model,
          inputTokens: usage.input,
          outputTokens: usage.output,
          ok: Boolean(text),
        });
      }
    }

    return { text, model };
  }

  /*
   * Every candidate was refused. Report the last refusal, which carries
   * Google's own sentence — including, usually, the name of the model it wants
   * us to use instead.
   */
  if (explained) throw badRequest(explainGeminiError(explained.status, explained.model, explained.detail));
  throw badRequest(explainGeminiError(lastStatus || 404, lastModel, null));
}

/** The names to try, best first, from whatever the key reports. */
export function candidateNames(ranked: GeminiModel[], configured: string | null): string[] {
  const names = ranked.map((row) => row.name);
  if (!configured) return names;

  // What the owner chose goes first; the rest stay as the fallback order.
  return [configured, ...names.filter((name) => name !== configured)];
}
