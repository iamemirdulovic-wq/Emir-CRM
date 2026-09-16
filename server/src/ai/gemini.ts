import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { AiCompletionRequest, AiProvider } from './provider.js';

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';

  get enabled(): boolean {
    return Boolean(env().GEMINI_API_KEY);
  }

  async complete(request: AiCompletionRequest): Promise<string | null> {
    const cfg = env();
    if (!cfg.GEMINI_API_KEY) return null;
    const model = cfg.AI_MODEL ?? 'gemini-2.0-flash';

    const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const user = request.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.GEMINI_API_KEY },
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
