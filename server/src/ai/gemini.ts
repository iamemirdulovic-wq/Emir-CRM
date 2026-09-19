import { logger } from '../lib/logger.js';
import type { AiCompletionRequest, AiProvider } from './provider.js';
import { FALLBACK_MODEL, GEMINI_BASE } from './models.js';

/**
 * Gemini, given its key and model at construction.
 *
 * Both are resolved before the provider is built — the environment first, then
 * what the owner saved in Settings — because reading them is a database call
 * and `enabled` has to be able to answer synchronously.
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
    const model = this.model;

    const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const user = request.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');

    try {
      const response = await fetch(
        `${GEMINI_BASE}/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: {
              temperature: request.temperature ?? 0.2,
              maxOutputTokens: request.maxOutputTokens ?? 512,
              ...(request.json ? { responseMimeType: 'application/json' } : {}),
            },
          }),
        },
      );
      if (!response.ok) {
        logger.warn('gemini request failed', { status: response.status });
        return null;
      }
      const json = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? null;
    } catch (err) {
      logger.warn('gemini request threw', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }
}
