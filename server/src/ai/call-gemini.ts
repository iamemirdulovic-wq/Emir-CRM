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
  BUSY_BACKOFF_MS, explainGeminiError, GEMINI_BASE, isModelBusy, isModelUnavailable,
  MAX_MODEL_ATTEMPTS, readGeminiError, type GeminiModel,
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

export type GeminiResult = {
  text: string | null;
  model: string;
  /**
   * The raw parts of the reply.
   *
   * Needed by function calling, where the interesting content is a
   * `functionCall` rather than text, and where the model's own turn has to go
   * back into the conversation exactly as it came out.
   */
  parts: Record<string, unknown>[];
};

export async function callGemini(call: GeminiCall): Promise<GeminiResult> {
  const candidates = call.candidates.slice(0, MAX_MODEL_ATTEMPTS);
  if (candidates.length === 0) throw badRequest('No usable Gemini model is configured.');

  /*
   * The most recent refusal that came with a reason, kept together with the
   * model it was about. A body that cannot be parsed must not throw away a
   * perfectly good explanation from an earlier attempt — that is the
   * difference between "Google said: use gemini-3.1-pro-preview" and a message
   * with nothing actionable in it.
   */
  let explained: { status: number; detail: string; model: string } | null = null;
  let lastStatus = 0;
  let lastModel = candidates[0] as string;

  // Models that answered "busy", worth asking again after a pause.
  let queue = candidates;

  for (let pass = 0; pass <= BUSY_BACKOFF_MS.length; pass++) {
    if (pass > 0) {
      /*
       * Every model was busy at once, which a spike in demand does. Waiting a
       * moment and asking again is what the owner would otherwise have to do
       * by hand, and someone is watching the reading panel while it happens.
       */
      logger.warn('every gemini model was busy; waiting before another pass', {
        pass, waitMs: BUSY_BACKOFF_MS[pass - 1], models: queue.length,
      });
      await sleep(BUSY_BACKOFF_MS[pass - 1] as number);
    }

    const busy: string[] = [];

    for (const model of queue) {
      lastModel = model;
      const outcome = await attempt(call, model);

      if (outcome.kind === 'answered') return { text: outcome.text, parts: outcome.parts, model };

      lastStatus = outcome.status;
      if (outcome.detail) explained = { status: outcome.status, detail: outcome.detail, model };

      // Busy is about this model at this moment, so it is worth asking again.
      if (outcome.kind === 'busy') busy.push(model);
      // Unavailable is about the model for good; drop it and move on.
    }

    if (busy.length === 0) break;   // nothing left that a pause would help
    queue = busy;
  }

  /*
   * Everything was refused. Report the last refusal that came with a reason,
   * which carries Google's own sentence — including, usually, the name of the
   * model it wants us to use instead.
   */
  if (explained) throw badRequest(explainGeminiError(explained.status, explained.model, explained.detail));
  throw badRequest(explainGeminiError(lastStatus || 404, lastModel, null));
}

type Attempt =
  | { kind: 'answered'; text: string | null; parts: Record<string, unknown>[] }
  | { kind: 'busy'; status: number; detail: string | null }
  | { kind: 'unavailable'; status: number; detail: string | null };

/**
 * One call to one model.
 *
 * Throws for a failure that is about the request rather than the model — a
 * malformed body, a bad key, a quota — because retrying those on another model
 * spends round trips to be told the same thing again.
 */
async function attempt(call: GeminiCall, model: string): Promise<Attempt> {
  let text: string | null = null;
  let parts: Record<string, unknown>[] = [];
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
      const detail = await readGeminiError(response);

      if (isModelBusy(response.status, detail)) {
        logger.warn('gemini model is busy', { model, status: response.status, detail });
        return { kind: 'busy', status: response.status, detail };
      }

      if (isModelUnavailable(response.status, detail)) {
        logger.warn('gemini refused the model; trying the next one', {
          model, status: response.status, detail,
        });
        return { kind: 'unavailable', status: response.status, detail };
      }

      logger.warn('gemini call failed', { model, status: response.status, detail });
      throw badRequest(explainGeminiError(response.status, model, detail));
    }

    const json = (await response.json()) as {
      candidates?: { content?: { parts?: Record<string, unknown>[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    parts = json.candidates?.[0]?.content?.parts ?? [];
    // Parts can be split, and a thinking model puts its answer in the last one.
    text = parts
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
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

  return { kind: 'answered', text, parts };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The names to try, best first, from whatever the key reports. */
export function candidateNames(ranked: GeminiModel[], configured: string | null): string[] {
  const names = ranked.map((row) => row.name);
  if (!configured) return names;

  // What the owner chose goes first; the rest stay as the fallback order.
  return [configured, ...names.filter((name) => name !== configured)];
}
