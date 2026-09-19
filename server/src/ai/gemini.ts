import { logger } from '../lib/logger.js';
import type { AiCompletionRequest, AiProvider } from './provider.js';
import { cachedModels, FALLBACK_MODEL, rankModels, resolveModel } from './models.js';
import { callGemini, candidateNames } from './call-gemini.js';
import { withinCap } from './usage.js';

/**
 * Gemini, given its key and model at construction.
 *
 * Both are resolved before the provider is built — the environment first, then
 * what the owner saved in Settings — because reading them is a database call
 * and `enabled` has to be able to answer synchronously.
 *
 * The call itself goes through `callGemini`, which tries the next model when
 * Google refuses the one asked for. Google's catalogue is an offer rather than
 * a guarantee: this key was listed `gemini-2.5-pro` and then told, on using
 * it, that the model "is no longer available to new users".
 */
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  private readonly apiKey: string | null;
  readonly model: string;

  constructor(apiKey: string | null, model?: string | null) {
    this.apiKey = apiKey;
    this.model = model || FALLBACK_MODEL;
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(request: AiCompletionRequest): Promise<string | null> {
    if (!this.apiKey) return null;

    /*
     * The cap is enforced here rather than at each caller, because it was not
     * enforced at most of them: lead scoring, field extraction and import
     * mapping all spent money the owner's limit never counted. A feature over
     * budget degrades quietly, which is the contract every caller already
     * expects of this interface.
     */
    if (!(await withinCap())) {
      logger.warn('ai call skipped: monthly budget reached', { feature: request.feature });
      return null;
    }

    const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const user = request.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');

    const available = await cachedModels(this.apiKey);
    const candidates = candidateNames(
      rankModels(available),
      resolveModel(this.model, available),
    );

    try {
      const { text } = await callGemini({
        apiKey: this.apiKey,
        candidates,
        feature: request.feature,
        userId: null,
        body: {
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            temperature: request.temperature ?? 0.2,
            maxOutputTokens: request.maxOutputTokens ?? 512,
            ...(request.json ? { responseMimeType: 'application/json' } : {}),
          },
        },
      });
      return text;
    } catch (err) {
      /*
       * Null rather than a throw: every caller of this interface is written to
       * carry on without AI, and a failed summary must not take a contact page
       * down with it. The reason is logged, not swallowed.
       */
      logger.warn('gemini request failed', {
        feature: request.feature,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
