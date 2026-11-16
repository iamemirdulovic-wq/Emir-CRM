import { describe, expect, it } from 'vitest';
import { ASKS } from './ask.js';

/**
 * Homes AI answers from rules over our own database, and from nothing else.
 *
 * The thing worth holding is not the wording — it is that this file never
 * reaches outside. Emir's decision of 14 November was no outside AI, and the
 * easiest way for that to rot is one import added in a hurry.
 */
describe('Homes AI answers', () => {
  it('knows exactly the questions the orb offers', () => {
    expect([...ASKS]).toEqual(['call-first', 'going-cold', 'due-today', 'needs-me', 'awake-now']);
  });

  it('reads our own rules and calls no outside service', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('./ask.ts', import.meta.url), 'utf8');
    expect(src).toContain("from '../ai/rules.js'");
    for (const outside of ['fetch(', 'googleapis', 'openai', 'gemini', 'https://']) {
      expect(src.toLowerCase()).not.toContain(outside.toLowerCase());
    }
  });
});
