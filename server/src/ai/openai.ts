import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { AiCompletionRequest, AiProvider } from './provider.js';

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';

  get enabled(): boolean {
    return Boolean(env().OPENAI_API_KEY);
  }

  async complete(request: AiCompletionRequest): Promise<string | null> {
    const cfg = env();
    if (!cfg.OPENAI_API_KEY) return null;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.AI_MODEL ?? 'gpt-4o-mini',
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
      const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return json.choices?.[0]?.message?.content ?? null;
    } catch (err) {
      logger.warn('openai request threw', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }
}
