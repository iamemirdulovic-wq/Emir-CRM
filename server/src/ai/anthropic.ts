/**
 * Claude, through Anthropic's own SDK.
 *
 * This replaced Gemini on 16 November, on Emir's instruction. The seam is
 * unchanged — everything still goes through `AiProvider`, so the features that
 * use it (the ask box, the lead summary, best time to call, voice notes, the
 * morning brief) did not have to be touched to move provider.
 *
 * Two things about this model are not optional and are easy to get wrong:
 *
 *  - **No `temperature`.** Claude Haiku 5.5 rejects a non-default sampling
 *    value with a 400. The old Gemini call sent 0.2 on every request, so
 *    carrying that across would have failed every call with a key that was
 *    perfectly good.
 *  - **No `thinking` field.** Omitting it works on every Claude model; naming
 *    it does not (`disabled` is refused outright on some, accepted only at
 *    certain effort levels on others). A provider whose model is a setting
 *    must send only what every model accepts.
 */
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../lib/logger.js';
import { saveSetting, setting } from '../config/secrets.js';
import type { AiCompletionRequest, AiProvider } from './provider.js';
import { estimateTokens, recordUsage, withinCap } from './usage.js';

/**
 * The everyday model: fast and cheap, which is what these features are.
 *
 * A constant rather than a literal in the call, and overridable by the
 * `AI_MODEL` setting, so moving to a bigger model is a change in Settings and
 * not a deploy.
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-5-5';

/** The models offered in Settings, cheapest first. */
export const CLAUDE_MODELS = [
  { name: 'claude-haiku-5-5', label: 'Haiku 5.5 — fastest and cheapest (recommended)' },
  { name: 'claude-sonnet-5-5', label: 'Sonnet 5.5 — better at long answers, ~20× the price' },
  { name: 'claude-opus-5-5', label: 'Opus 5.5 — the most capable, ~40× the price' },
] as const;

/** Where the last failure is kept, so System health can name it. */
export const LAST_ERROR_SETTING = 'AI_LAST_ERROR';

/**
 * One failure, in two registers: what a person is told, and what really
 * happened.
 *
 * Emir asked for both and they are not the same audience. The owner pressing
 * "Test the key" needs the exact error to fix it; an agent who asked Homes AI
 * a question needs a sentence, never a stack of JSON.
 */
export interface AiFailure {
  /** Plain English. Safe to show anyone. */
  say: string;
  /** What the API actually said. Owner-only. */
  detail: string;
}

/**
 * Turn whatever was thrown into those two sentences.
 *
 * Typed SDK classes rather than string matching, which is what the SDK's own
 * guidance asks for and what survives a reworded error message.
 */
export function explain(err: unknown, model: string): AiFailure {
  const detail = err instanceof Error ? err.message : String(err);
  if (err instanceof Anthropic.AuthenticationError) {
    return { say: 'The Claude API key was not accepted. Check it was copied in full, then save it again.', detail };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { say: 'This key is not allowed to use the Claude API. Check the key has credit and is not restricted.', detail };
  }
  if (err instanceof Anthropic.NotFoundError) {
    return { say: `The model ${model} is not available to this key. Pick another model in Settings.`, detail };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { say: 'Claude is busy and asked us to slow down. Try again in a minute.', detail };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { say: 'The CRM could not reach Claude just now. It is usually back within a minute.', detail };
  }
  if (err instanceof Anthropic.APIError) {
    return { say: `Claude refused that request (error ${err.status ?? '?'}).`, detail };
  }
  return { say: 'Something went wrong talking to Claude.', detail };
}

/**
 * Remember, or forget, why the last call failed. Never the key.
 *
 * Written only when it changes. `saveSetting` writes an audit row, and a
 * CRM that scores every lead would otherwise fill `audit_log` with thousands
 * of identical "nothing is wrong" entries a day.
 */
async function remember(failure: AiFailure | null): Promise<void> {
  try {
    const next = failure ? failure.say : '';
    if (((await setting(LAST_ERROR_SETTING)) ?? '') === next) return;
    await saveSetting({ userId: null, role: 'automation' }, LAST_ERROR_SETTING, next);
  } catch {
    /* Health reporting must never be the reason a call fails. */
  }
}

/**
 * One small call, to answer "does this key work?".
 *
 * Deliberately separate from `complete`: the owner's test must report why it
 * failed, where every other caller wants a null and a working CRM.
 */
export async function testClaudeKey(
  apiKey: string,
  model: string = DEFAULT_CLAUDE_MODEL,
): Promise<{ ok: true } | { ok: false } & AiFailure> {
  try {
    const client = new Anthropic({ apiKey, maxRetries: 0 });
    const reply = await client.messages.create({
      model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    });
    const said = reply.content.some((b) => b.type === 'text' && b.text.trim().length > 0);
    if (!said) {
      await remember({ say: 'Claude answered, but said nothing.', detail: 'empty content' });
      return { ok: false, say: 'Claude answered, but said nothing. Try a different model.', detail: 'empty content' };
    }
    await remember(null);
    return { ok: true };
  } catch (err) {
    const failure = explain(err, model);
    await remember(failure);
    return { ok: false, ...failure };
  }
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'claude';
  private readonly apiKey: string | null;
  readonly model: string;

  /** Key and model resolved before construction, as the other providers are. */
  constructor(apiKey: string | null, model?: string | null) {
    this.apiKey = apiKey;
    this.model = model || DEFAULT_CLAUDE_MODEL;
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(request: AiCompletionRequest): Promise<string | null> {
    if (!this.apiKey) return null;

    /* The cap is enforced here, as it was for Gemini: a provider swap must
       never be the thing that quietly lifts the owner's monthly limit. */
    if (!(await withinCap())) {
      logger.warn('ai call skipped: monthly budget reached', { feature: request.feature });
      await remember({
        say: 'This month\'s AI budget is spent. It starts again on the 1st.',
        detail: 'monthly cap reached',
      });
      return null;
    }

    const system = request.messages
      .filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const user = request.messages
      .filter((m) => m.role === 'user').map((m) => m.content).join('\n');

    /* Claude has no "reply in JSON" switch that works across every model, so
       the instruction goes in the system text and `parseJsonReply` keeps
       tolerating a model that wraps its object in a code fence. */
    const instructions = request.json
      ? `${system}\n\nReply with the JSON object only. No explanation, no code fence.`.trim()
      : system;

    try {
      const client = new Anthropic({ apiKey: this.apiKey });
      const reply = await client.messages.create({
        model: this.model,
        max_tokens: request.maxOutputTokens ?? 512,
        ...(instructions ? { system: instructions } : {}),
        messages: [{ role: 'user', content: user }],
      });

      const text = reply.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();

      /* Counted from what Claude says it used, not from our own guess, so the
         owner's cap and the per-feature bars are the real numbers. */
      await recordUsage({
        userId: null,
        feature: request.feature,
        model: this.model,
        inputTokens: reply.usage.input_tokens ?? estimateTokens(`${instructions}\n${user}`),
        outputTokens: reply.usage.output_tokens ?? estimateTokens(text),
        ok: text.length > 0,
      });

      await remember(null);
      return text.length > 0 ? text : null;
    } catch (err) {
      /*
       * Null rather than a throw: every caller is written to carry on without
       * AI, and a failed summary must not take a contact page down with it.
       * The reason is kept for System health rather than swallowed.
       */
      const failure = explain(err, this.model);
      logger.warn('claude request failed', { feature: request.feature, error: failure.detail });
      await remember(failure);
      return null;
    }
  }
}
