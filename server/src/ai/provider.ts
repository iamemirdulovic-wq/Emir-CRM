/**
 * Provider-agnostic AI interface. Gemini or OpenAI are chosen by environment
 * config; `none` disables AI entirely, and every caller must work without it.
 */

export type AiMessage = { role: 'system' | 'user'; content: string };

export type AiCompletionRequest = {
  messages: AiMessage[];
  /**
   * What this call is for, recorded against the monthly budget.
   *
   * Required in practice: until it existed only the Try box counted towards
   * the cap, so lead scoring, field extraction and import mapping all spent
   * money the owner's limit never saw.
   */
  feature: string;
  /** Ask the provider for strict JSON. */
  json?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
};

export interface AiProvider {
  readonly name: string;
  readonly enabled: boolean;
  /** The model this provider will actually call, for usage accounting. */
  readonly model: string;
  complete(request: AiCompletionRequest): Promise<string | null>;
}

/** Used when AI is switched off. Every feature degrades rather than fails. */
export class NullProvider implements AiProvider {
  readonly name = 'none';
  readonly enabled = false;
  readonly model = 'none';
  async complete(): Promise<string | null> {
    return null;
  }
}

/** Parse a model's JSON reply, tolerating the code fences models like to add. */
export function parseJsonReply<T>(raw: string | null): T | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Some models wrap the object in prose; take the outermost braces.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}
