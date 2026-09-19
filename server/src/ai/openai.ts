import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { estimateTokens, recordUsage, withinCap } from './usage.js';
import type { AiCompletionRequest, AiProvider } from './provider.js';

export class OpenAiProvider implements AiProvider {
  private readonly apiKey: string | null;
  readonly model: string;

  /** Same shape as Gemini: key and model resolved before construction. */
  constructor(apiKey?: string | null, model?: string | null) {
    this.apiKey = apiKey ?? env().OPENAI_API_KEY ?? null;
    this.model = model || env().AI_MODEL || 'gpt-4o-mini';
  }

  readonly name = 'openai';

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(request: AiCompletionRequest): Promise<string | null> {
    if (!this.apiKey) return null;
    // Same budget as Gemini: a provider swap must not quietly lift the cap.
    if (!(await withinCap())) {
      logger.warn('ai call skipped: monthly budget reached', { feature: request.feature });
      return null;
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxOutputTokens ?? 512,
          ...(request.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      if (!response.ok) {
        logger.warn('openai request failed', { status: response.status });
        return null;
      }
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content ?? null;

      // Recorded here, as Gemini's is, so the owner's cap sees every call.
      await recordUsage({
        userId: null,
        feature: request.feature,
        model: this.model,
        inputTokens: json.usage?.prompt_tokens
          ?? estimateTokens(request.messages.map((m) => m.content).join('\n')),
        outputTokens: json.usage?.completion_tokens ?? estimateTokens(text ?? ''),
        ok: Boolean(text),
      });

      return text;
    } catch (err) {
      logger.warn('openai request threw', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }
}
