import { describe, expect, it } from 'vitest';
import {
  explainGeminiError, FALLBACK_MODEL, GEMINI_BASE, pickDefault, resolveModel, stepUpForFiles,
  type GeminiModel,
} from './models.js';

const model = (name: string): GeminiModel =>
  ({ name, displayName: name, description: '', inputTokenLimit: null });

/**
 * These exist because of a real 404. The CRM had two model names written into
 * it, the owner's key had neither, and the error told them to check their
 * billing. The rules here are: never pick a model the key has not reported,
 * and never blame the wrong thing.
 */
describe('choosing a model', () => {
  it('takes the cheapest capable model the key actually has', () => {
    const chosen = pickDefault([
      model('gemini-2.5-pro'),
      model('gemini-2.5-flash'),
      model('gemini-2.5-flash-lite'),
    ]);
    expect(chosen).toBe('gemini-2.5-flash-lite');
  });

  it('matches a dated release by its family name', () => {
    const chosen = pickDefault([
      model('gemini-2.5-flash-lite-preview-09-2025'),
      model('gemini-2.5-pro'),
    ]);
    expect(chosen).toBe('gemini-2.5-flash-lite-preview-09-2025');
  });

  it('falls back to whatever Gemini the key does have, over a name from this file', () => {
    const chosen = pickDefault([model('gemini-3.0-something-we-have-never-heard-of')]);
    expect(chosen).toBe('gemini-3.0-something-we-have-never-heard-of');
  });

  it('uses the hard-coded name only when there is no list at all', () => {
    expect(pickDefault([])).toBe(FALLBACK_MODEL);
  });
});

describe('stepping up to read a PDF', () => {
  /* Flash-Lite cannot read a document, so a file needs the full model. */
  it('drops "lite" when the key has the full sibling', () => {
    const available = [model('gemini-2.5-flash-lite'), model('gemini-2.5-flash')];
    expect(stepUpForFiles('gemini-2.5-flash-lite', available)).toBe('gemini-2.5-flash');
  });

  /*
   * The whole point of this module: never step up to a model the key has not
   * reported, because that turns a working call into the 404 it exists to fix.
   */
  it('does not step up to a model the key does not have', () => {
    const available = [model('gemini-2.5-flash-lite'), model('gemini-2.5-pro')];
    expect(stepUpForFiles('gemini-2.5-flash-lite', available)).toBe('gemini-2.5-pro');
  });

  it('stays put when the key has nothing but lite models', () => {
    const available = [model('gemini-2.5-flash-lite')];
    expect(stepUpForFiles('gemini-2.5-flash-lite', available)).toBe('gemini-2.5-flash-lite');
  });

  it('leaves a model that is already full alone', () => {
    const available = [model('gemini-2.5-flash'), model('gemini-2.5-pro')];
    expect(stepUpForFiles('gemini-2.5-flash', available)).toBe('gemini-2.5-flash');
  });

  /* No list means Google could not be asked, not that nothing exists. */
  it('tries the obvious step-up when there is no list to check', () => {
    expect(stepUpForFiles('gemini-2.5-flash-lite', [])).toBe('gemini-2.5-flash');
  });
});

describe('saying what went wrong', () => {
  /*
   * The bug this replaces: every failure said "check the key has billing
   * enabled", which sent the owner to the billing page for a stale model name.
   */
  it('blames the model name on a 404, and names it', () => {
    const message = explainGeminiError(404, 'gemini-2.0-flash-lite');
    expect(message).toContain('gemini-2.0-flash-lite');
    expect(message).toContain('Settings');
    expect(message).not.toContain('billing');
  });

  it('blames the key on a 401 or 403', () => {
    for (const status of [401, 403]) {
      expect(explainGeminiError(status, 'any')).toContain('key');
      expect(explainGeminiError(status, 'any')).toContain('billing');
    }
  });

  it('says to wait on a 429', () => {
    expect(explainGeminiError(429, 'any')).toContain('rate-limiting');
  });

  it('blames Google on a 500', () => {
    expect(explainGeminiError(503, 'any')).toContain('their side');
  });

  it('still says something useful for a status it has never seen', () => {
    expect(explainGeminiError(418, 'any')).toContain('418');
  });
});

describe('the API version', () => {
  /* The hard rule: one config constant, not scattered through the code. */
  it('is written down exactly once', () => {
    expect(GEMINI_BASE).toBe('https://generativelanguage.googleapis.com/v1beta');
  });
});

/**
 * This is the exact bug the owner hit. Their saved model was
 * `gemini-2.0-flash-lite`, their key did not have it, and a saved value beats
 * a default — so the 404 came back every single time until someone opened
 * Settings. A stale name is not a preference.
 */
describe('a saved model the key does not have', () => {
  const available = [
    model('gemini-2.5-pro'),
    model('gemini-2.5-flash'),
    model('gemini-2.5-flash-lite'),
  ];

  it('is replaced with one the key does have', () => {
    expect(resolveModel('gemini-2.0-flash-lite', available)).toBe('gemini-2.5-flash-lite');
  });

  it('leaves a model the key does have exactly alone', () => {
    expect(resolveModel('gemini-2.5-pro', available)).toBe('gemini-2.5-pro');
  });

  it('picks one when nothing is saved', () => {
    expect(resolveModel(null, available)).toBe('gemini-2.5-flash-lite');
    expect(resolveModel('', available)).toBe('gemini-2.5-flash-lite');
  });

  /* An empty list means Google could not be asked, not that the key has
     nothing. Honour what is saved and let the real call report the truth. */
  it('honours the saved name when there is no list to check against', () => {
    expect(resolveModel('gemini-2.0-flash-lite', [])).toBe('gemini-2.0-flash-lite');
  });

  it('falls back to the hard-coded name only when there is nothing at all', () => {
    expect(resolveModel(null, [])).toBe(FALLBACK_MODEL);
  });
});
