import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { AI_FEATURES } from './features.js';
import { estimateCostMicros } from './usage.js';

const read = (name: string) => readFile(new URL(name, import.meta.url), 'utf8');

/**
 * Homes AI may look at the web. What it may not do is let the web become our
 * prices.
 *
 * That is the one way this feature could cost the brokerage something real:
 * an agent repeats a figure from a portal to a buyer, as ours, because the
 * answer did not say where it came from. So these checks are about the seam
 * between the two sources, not about search itself.
 */
describe('the web', () => {
  it('is a switch the owner can turn off, like every other feature', () => {
    expect(AI_FEATURES.web.name).toBe('AI_CAN_WEB');
    expect(AI_FEATURES.web.title).toMatch(/web/i);
  });

  it('is asked for only when that switch is on', async () => {
    const src = await read('./ask.ts');
    const where = src.indexOf("aiFeatureOn('web')");
    expect(where).toBeGreaterThan(0);
    // The tool is pushed inside the `if`, not beside it.
    expect(src.slice(where, src.indexOf('}', src.indexOf('tools.push', where))))
      .toContain('web_search_20250305');
  });

  it('uses the variant that works without programmatic tool calling', async () => {
    /*
     * From `web_search_20260209` the tool defaults to being callable only
     * from inside code execution, and a model without that answers 400. The
     * model is a setting here, so the tool has to be the one that works on
     * all of them.
     */
    const src = await read('./ask.ts');
    /* The declaration, not the prose around it: the comment above it names
       the newer variant to explain why we are not using it. */
    const declared = src.slice(src.indexOf('tools.push('), src.indexOf('});', src.indexOf('tools.push(')));
    expect(declared).toContain('web_search_20250305');
    expect(declared).not.toMatch(/web_search_2026\d+/);
  });

  it('tells the model the web is never a price of ours, and never enters a draft', async () => {
    const src = await read('./ask.ts');
    const rules = src.slice(src.indexOf('const INSTRUCTION'), src.indexOf('export type AskResult'));
    expect(rules).toMatch(/NEVER one you found on the web/);
    expect(rules).toMatch(/Never put a web figure into a message you draft/);
    expect(rules).toMatch(/name the source/);
  });

  it('charges a search to the monthly cap, which counts tokens and would miss it', async () => {
    /*
     * $10 per 1,000 searches, billed whatever comes back. One search costs
     * more than a whole Haiku answer, so a cap that counted only tokens
     * would let this run past the owner's limit without ever showing up.
     */
    const src = await read('./usage.ts');
    expect(src).toContain('const SEARCH_MICROS = 10_000;');
    expect(src).toContain('(input.searches ?? 0) * SEARCH_MICROS');
    expect(estimateCostMicros('claude-haiku-5-5', 1000, 1000)).toBeLessThan(10_000);
  });

  it('hands a paused turn straight back instead of answering half of it', async () => {
    const src = await read('./ask.ts');
    expect(src).toContain("reply.stop_reason === 'pause_turn'");
  });

  it('never lets the web tool take the whole chat down', async () => {
    /*
     * The first hour this shipped, every question came back "Claude refused
     * that request (error 400)" -- including the ones that had nothing to do
     * with the market. Which models accept which search variant is
     * Anthropic's to change and ours to survive: the tool comes off and the
     * question is asked again without it.
     */
    const src = await read('./ask.ts');
    expect(src).toContain('err instanceof Anthropic.BadRequestError && onTheWeb');
    expect(src).toContain('dropTheWeb()');
    /* And it is remembered, or every later question pays the same failed
       round trip before working. */
    expect(src).toContain('webSearchRefused.add(model)');
    expect(src).toContain('!webSearchRefused.has(model)');
  });

  it('tells an owner what the API actually said, and an agent nothing of the sort', async () => {
    const src = await read('./ask.ts');
    expect(src).toContain("asker.role === 'owner' || asker.role === 'admin'");
    expect(src).toContain('canFixIt ? `${failure.say} ${failure.detail}` : failure.say');
  });

  it('says "the web" under an answer that used it', async () => {
    const src = await read('./ask.ts');
    expect(src).toContain("toolsUsed.push('the web')");
  });
});
