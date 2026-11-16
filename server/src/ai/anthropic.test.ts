import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { AnthropicProvider, CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, explain } from './anthropic.js';
import { estimateCostMicros } from './usage.js';

/**
 * The parts of the Claude move that fail silently if they are got wrong.
 *
 * Two of these are not style points. Claude Haiku 5.5 answers a non-default
 * `temperature` with a 400, and the models disagree about which `thinking`
 * settings they accept — so a request carrying either would fail on a key
 * that is perfectly good, and the owner would be told their key is bad.
 */
describe('Claude provider', () => {
  it('sends no temperature and no thinking, whatever the caller asks for', async () => {
    const src = await readFile(new URL('./anthropic.ts', import.meta.url), 'utf8');
    const call = src.slice(src.indexOf('client.messages.create({', src.indexOf('async complete')));
    expect(call.slice(0, call.indexOf('});'))).not.toMatch(/temperature|thinking/);
  });

  it('is off, and silent, with no key', async () => {
    const provider = new AnthropicProvider(null);
    expect(provider.enabled).toBe(false);
    expect(await provider.complete({ feature: 'test', messages: [] })).toBeNull();
  });

  it('defaults to the cheap everyday model, and takes one from Settings', () => {
    expect(new AnthropicProvider('k').model).toBe(DEFAULT_CLAUDE_MODEL);
    expect(new AnthropicProvider('k', 'claude-opus-5-5').model).toBe('claude-opus-5-5');
    expect(CLAUDE_MODELS[0].name).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it('prices every model it offers, cheapest first, and never guesses', () => {
    /* A model with no row of its own would be billed at a Gemini-era
       fallback that is cheaper than Opus — so the cap would let an expensive
       model spend past the owner's limit. Each one has its own price, and
       they come out in the order the list claims. */
    const costs = CLAUDE_MODELS.map((one) => estimateCostMicros(one.name, 1_000_000, 1_000_000));
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(new Set(costs).size).toBe(costs.length);

    // Even a Claude model nobody here has heard of is priced as a dear one.
    expect(estimateCostMicros('claude-something-new', 1_000_000, 1_000_000))
      .toBeGreaterThan(costs[costs.length - 1] as number);
  });

  it('says what went wrong in words a person can act on', () => {
    class Auth extends Error {}
    Object.setPrototypeOf(Auth.prototype, Error.prototype);
    // A plain error still gets a sentence rather than a stack.
    const plain = explain(new Error('socket hang up'), DEFAULT_CLAUDE_MODEL);
    expect(plain.say).not.toContain('socket hang up');
    expect(plain.detail).toBe('socket hang up');
  });
});
