import { describe, expect, it } from 'vitest';
import {
  explainGeminiError, FALLBACK_MODEL, GEMINI_BASE, GEMINI_INLINE_LIMIT_BYTES, isModelUnavailable,
  isTextModel, parseModelName, pickDefault, rankModels, readGeminiError, resolveModel,
  stepUpForFiles, type GeminiModel,
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

/**
 * The second failure the owner hit: a 400, "rejected as malformed".
 *
 * Google's catalogue lists image, speech and live-audio models next to the
 * ordinary ones, and every one of them reports `generateContent`. Their names
 * overlap too — `gemini-2.5-flash-image` starts with `gemini-2.5-flash` — so a
 * prefix search for the flash family could settle on an image generator, and
 * asking an image generator for JSON is a 400.
 */
describe('keeping non-text models out of the choice', () => {
  it('recognises the ones that cannot answer with text', () => {
    for (const name of [
      'gemini-2.5-flash-image',
      'gemini-2.5-flash-preview-tts',
      'gemini-2.5-flash-native-audio-preview',
      'gemini-live-2.5-flash-preview',
      'gemini-embedding-001',
      'imagen-4.0-generate-001',
      'veo-3.0-generate-preview',
    ]) {
      expect(isTextModel(name), name).toBe(false);
    }
  });

  it('leaves the ordinary ones alone', () => {
    for (const name of [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash-lite-preview-09-2025',
      'gemini-2.0-flash',
    ]) {
      expect(isTextModel(name), name).toBe(true);
    }
  });

  it('never defaults to an image model, however the list is ordered', () => {
    const chosen = pickDefault([
      model('gemini-2.5-flash-image'),
      model('gemini-2.5-flash-preview-tts'),
      model('gemini-2.5-flash-lite'),
    ]);
    expect(chosen).toBe('gemini-2.5-flash-lite');
  });

  /* The precise path that produced the 400: stepping up from lite for a PDF,
     with an image model sitting first in the catalogue. */
  it('never steps up to an image model to read a document', () => {
    const available = [
      model('gemini-2.5-flash-image'),
      model('gemini-2.5-flash-lite'),
      model('gemini-2.5-pro'),
    ];
    expect(stepUpForFiles('gemini-2.5-flash-lite', available)).toBe('gemini-2.5-pro');
  });

  it('replaces a saved model that turns out to be an image generator', () => {
    const available = [model('gemini-2.5-flash-image'), model('gemini-2.5-flash-lite')];
    expect(resolveModel('gemini-2.5-flash-image', available)).toBe('gemini-2.5-flash-lite');
  });
});

describe('what Google will accept in one request', () => {
  /*
   * Google's ceiling is 20 MB for the *encoded* request. Base64 inflates by a
   * third, so the raw file has to be well under that — the first cap was set
   * against the raw size and let through files Google then refused.
   */
  it('leaves room for base64 to inflate the file', () => {
    const encoded = GEMINI_INLINE_LIMIT_BYTES * 4 / 3;
    expect(encoded).toBeLessThan(20 * 1024 * 1024);
  });
});

describe('carrying Google\'s own words through', () => {
  it('appends what Google said to a 400', () => {
    const message = explainGeminiError(400, 'gemini-2.5-flash', 'Invalid value at generation_config.response_mime_type');
    expect(message).toContain('Google said');
    expect(message).toContain('response_mime_type');
  });

  it('still reads properly when Google said nothing', () => {
    expect(explainGeminiError(400, 'gemini-2.5-flash')).not.toContain('Google said');
    expect(explainGeminiError(400, 'gemini-2.5-flash')).toContain('would not accept');
  });
});

describe('reading what Google actually said', () => {
  const errorBody = (message: string) =>
    new Response(JSON.stringify({ error: { code: 400, message, status: 'INVALID_ARGUMENT' } }), { status: 400 });

  it('pulls the message out of a Gemini error', async () => {
    const detail = await readGeminiError(errorBody('Invalid value at generation_config.response_mime_type'));
    expect(detail).toBe('Invalid value at generation_config.response_mime_type');
  });

  it('caps a very long message rather than pasting an essay into the screen', async () => {
    const detail = await readGeminiError(errorBody('x'.repeat(2000)));
    expect(detail).toHaveLength(401);        // 400 characters plus the ellipsis
    expect(detail?.endsWith('…')).toBe(true);
  });

  it('returns nothing when the body is not the shape we expect', async () => {
    expect(await readGeminiError(new Response('<html>502 Bad Gateway</html>', { status: 502 }))).toBeNull();
    expect(await readGeminiError(new Response('{}', { status: 400 }))).toBeNull();
    expect(await readGeminiError(new Response('', { status: 400 }))).toBeNull();
  });
});

/**
 * A list of literal model names was the second thing here to age badly: it
 * knew 2.0 and 2.5, and Google had already moved to 3.x. Reading the tier and
 * the generation out of the name means a generation nobody here has heard of
 * still sorts into the right place.
 */
describe('reading a model name', () => {
  it('finds the tier and the generation', () => {
    expect(parseModelName('gemini-3.1-pro-preview')).toMatchObject({ tier: 'pro', generation: 3.1, preview: true });
    expect(parseModelName('gemini-2.5-flash-lite')).toMatchObject({ tier: 'flash-lite', generation: 2.5, preview: false });
    expect(parseModelName('gemini-2.0-flash')).toMatchObject({ tier: 'flash', generation: 2, preview: false });
  });

  it('copes with an unversioned name', () => {
    expect(parseModelName('gemini-flash-latest')).toMatchObject({ tier: 'flash', generation: 0 });
  });
});

describe('ranking what the key has', () => {
  const catalogue = [
    model('gemini-3.1-pro-preview'),
    model('gemini-2.5-pro'),
    model('gemini-2.5-flash'),
    model('gemini-3.1-flash'),
    model('gemini-2.5-flash-lite'),
    model('gemini-3.1-flash-lite'),
    model('gemini-2.5-flash-image'),
  ];

  /* Cheapest tier first, because the owner asked for the spend to stay small
     and Flash-Lite answers everything this CRM does. */
  it('puts the cheapest tier first and the newest of it at the top', () => {
    expect(rankModels(catalogue).map((row) => row.name)).toEqual([
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash-lite',
      'gemini-3.1-flash',
      'gemini-2.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-2.5-pro',
    ]);
  });

  it('drops the lite tier when a document has to be read', () => {
    const forFile = rankModels(catalogue, { forFile: true }).map((row) => row.name);
    expect(forFile[0]).toBe('gemini-3.1-flash');
    expect(forFile.some((name) => name.includes('lite'))).toBe(false);
  });

  it('never ranks an image model at all', () => {
    expect(rankModels(catalogue).some((row) => row.name.includes('image'))).toBe(false);
  });

  /* A generation this file has never heard of must still sort sensibly. */
  it('prefers a generation nobody here has heard of', () => {
    const chosen = pickDefault([model('gemini-2.5-flash-lite'), model('gemini-9.9-flash-lite')]);
    expect(chosen).toBe('gemini-9.9-flash-lite');
  });

  it('prefers a stable release over a preview of the same generation', () => {
    const chosen = pickDefault([model('gemini-3.1-flash-lite-preview'), model('gemini-3.1-flash-lite')]);
    expect(chosen).toBe('gemini-3.1-flash-lite');
  });
});

/**
 * The owner's key was offered gemini-2.5-pro by the catalogue and then told,
 * on using it, that the model "is no longer available to new users". A
 * catalogue entry is an offer, not a guarantee.
 */
describe('telling "not that model" from "not that request"', () => {
  it('recognises the refusals that mean try another model', () => {
    expect(isModelUnavailable(404, 'models/x is not found for API version v1beta')).toBe(true);
    expect(isModelUnavailable(400, 'This model models/gemini-2.5-pro is no longer available to new users. Please update your code to use models/gemini-3.1-pro-preview.')).toBe(true);
    expect(isModelUnavailable(403, 'Your project does not have access to this model')).toBe(true);
  });

  it('does not treat a bad request as a bad model', () => {
    expect(isModelUnavailable(400, 'Invalid value at generation_config.response_mime_type')).toBe(false);
    expect(isModelUnavailable(400, 'Request payload size exceeds the limit')).toBe(false);
    expect(isModelUnavailable(403, 'API key not valid. Please pass a valid API key.')).toBe(false);
    expect(isModelUnavailable(429, 'Resource has been exhausted')).toBe(false);
    expect(isModelUnavailable(500, 'Internal error')).toBe(false);
  });

  /* A 404 is about the model whether or not Google explained itself. */
  it('trusts a bare 404 with no message', () => {
    expect(isModelUnavailable(404, null)).toBe(true);
    expect(isModelUnavailable(400, null)).toBe(false);
  });
});
