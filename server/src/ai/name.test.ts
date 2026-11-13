import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_NAME, AI_SETTINGS } from './name.js';
import { explainGeminiError } from './models.js';

/**
 * The assistant is called Homes AI on the server too.
 *
 * The screens were renamed and the server was not, so on 13 Nov the owner's
 * own health page listed a service called "Emir AI" beside a menu row called
 * "Homes AI", and every failure the assistant could produce sent him to
 * "Settings → Emir AI", which is not a menu item that exists anywhere in the
 * CRM. The right one is Settings → Homes AI.
 *
 * So: a test that reads the source. A name is exactly the kind of thing that
 * drifts back in one string at a time, and no behavioural test would notice.
 */

const SRC = join(import.meta.dirname, '..');

/** Every non-test TypeScript file the server actually runs. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    if (!path.endsWith('.ts') || path.endsWith('.test.ts')) return [];
    /* `name.ts` is where the old name is written down on purpose, to explain
       what happened and why these two constants exist. */
    return path.endsWith(join('ai', 'name.ts')) ? [] : [path];
  });
}

describe('what the assistant is called', () => {
  it('is Homes AI, and its settings are where the menu says', () => {
    expect(AI_NAME).toBe('Homes AI');
    expect(AI_SETTINGS).toBe('Settings → Homes AI');
  });

  it('is not called Emir AI anywhere the server runs', () => {
    const guilty = sources(SRC)
      .filter((path) => readFileSync(path, 'utf8').includes('Emir AI'))
      .map((path) => path.slice(SRC.length + 1));
    expect(guilty, 'use AI_NAME from ai/name.js').toEqual([]);
  });

  it('sends nobody to a menu item that does not exist', () => {
    const guilty = sources(SRC)
      .filter((path) => /Settings → (?!Homes AI|Attendance|Company|General)/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(SRC.length + 1));
    expect(guilty, 'the AI settings row is called Homes AI').toEqual([]);
  });
});

/**
 * The messages the owner actually sees when Google refuses the key. These are
 * the four the task named, and each one has to name the assistant and the
 * place to go and fix it.
 */
describe('what a failed Gemini call says', () => {
  it('sends a wrong model name to the right settings page', () => {
    const said = explainGeminiError(404, 'gemini-1.0-pro');
    expect(said).toContain('Settings → Homes AI');
    expect(said).not.toContain('Emir AI');
  });

  it('sends a refused key to the right settings page', () => {
    for (const status of [401, 403]) {
      const said = explainGeminiError(status, 'gemini-2.5-flash');
      expect(said).toContain('Settings → Homes AI');
      expect(said).not.toContain('Emir AI');
    }
  });

  it('names Homes AI when Google is busy and when it cannot say why', () => {
    expect(explainGeminiError(503, 'gemini-2.5-flash', 'The model is overloaded.'))
      .toContain('Homes AI tried the others');
    expect(explainGeminiError(418, 'gemini-2.5-flash')).toContain('Homes AI could not complete that');
  });

  /* Google's own sentence is carried through to the screen on purpose — a
     vague diagnosis cost a day once. It must survive the rename. */
  it('still carries Google\u2019s own explanation', () => {
    expect(explainGeminiError(400, 'gemini-2.5-flash', 'API key not valid'))
      .toContain('Google said: API key not valid');
  });
});
