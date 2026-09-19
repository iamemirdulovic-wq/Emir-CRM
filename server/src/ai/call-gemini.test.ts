import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callGemini, candidateNames } from './call-gemini.js';
import { clearModelCache, type GeminiModel } from './models.js';

vi.mock('./usage.js', async () => {
  const actual = await vi.importActual<typeof import('./usage.js')>('./usage.js');
  return { ...actual, recordUsage: vi.fn(async () => undefined) };
});
const { recordUsage } = await import('./usage.js');

const model = (name: string): GeminiModel =>
  ({ name, displayName: name, description: '', inputTokenLimit: null });

/** Google's own shape for a refusal. */
const refuse = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { code: status, message, status: 'FAILED_PRECONDITION' } }), { status });

const answer = (text: string) =>
  new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
  }), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearModelCache();
  vi.mocked(recordUsage).mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const call = (candidates: string[]) =>
  callGemini({ apiKey: 'k', candidates, feature: 'test', userId: null, body: {} });

/** The model each fetch call was made against. */
const modelsCalled = () =>
  fetchMock.mock.calls.map(([url]) => String(url).split('/models/')[1]?.split(':')[0]);

describe('when Google refuses the model rather than the request', () => {
  /*
   * The exact failure the owner hit. Google's catalogue offered the key
   * `gemini-2.5-pro`, and using it came back: "This model models/gemini-2.5-pro
   * is no longer available to new users. Please update your code to use
   * models/gemini-3.1-pro-preview." A catalogue entry is an offer, not a
   * guarantee, so the only sensible answer is to try the next one.
   */
  it('moves on to the next model and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(refuse(400, 'This model models/gemini-2.5-pro is no longer available to new users. Please update your code to use models/gemini-3.1-pro-preview.'))
      .mockResolvedValueOnce(answer('{"ok":true}'));

    const result = await call(['gemini-2.5-pro', 'gemini-3.1-pro-preview']);

    expect(result.text).toBe('{"ok":true}');
    expect(result.model).toBe('gemini-3.1-pro-preview');
    expect(modelsCalled()).toEqual(['gemini-2.5-pro', 'gemini-3.1-pro-preview']);
  });

  it('moves on from a 404 too', async () => {
    fetchMock
      .mockResolvedValueOnce(refuse(404, 'models/gemini-2.0-flash-lite is not found for API version v1beta'))
      .mockResolvedValueOnce(answer('ok'));

    expect((await call(['gemini-2.0-flash-lite', 'gemini-2.5-flash-lite'])).model)
      .toBe('gemini-2.5-flash-lite');
  });

  /* A refused call never reached a model, so it must not be billed. */
  it('bills nothing for a model that was refused', async () => {
    fetchMock
      .mockResolvedValueOnce(refuse(404, 'not found'))
      .mockResolvedValueOnce(answer('ok'));

    await call(['a-gone', 'gemini-2.5-flash']);

    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordUsage).mock.calls[0]?.[0]).toMatchObject({ model: 'gemini-2.5-flash' });
  });

  it('gives up after three, and reports what Google last said', async () => {
    fetchMock.mockImplementation(async () => refuse(404, 'models/whatever is not found for API version v1beta'));

    await expect(call(['a', 'b', 'c', 'd'])).rejects.toThrow(/not found for API version/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('when Google objects to the request itself', () => {
  /*
   * Retrying a genuinely bad request on three models would spend three round
   * trips to be told the same thing, and would hide the real reason.
   */
  it('stops at the first model and passes the reason through', async () => {
    fetchMock.mockResolvedValueOnce(refuse(400, 'Invalid value at generation_config.response_mime_type'));

    await expect(call(['gemini-2.5-flash', 'gemini-2.5-pro']))
      .rejects.toThrow(/response_mime_type/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a bad key across models', async () => {
    fetchMock.mockResolvedValueOnce(refuse(403, 'API key not valid. Please pass a valid API key.'));

    await expect(call(['gemini-2.5-flash', 'gemini-2.5-pro'])).rejects.toThrow(/key/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('reading the answer', () => {
  it('joins an answer that came back in several parts', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }],
    }), { status: 200 }));

    expect((await call(['gemini-2.5-flash'])).text).toBe('{"a":1}');
  });

  /* A thinking model can spend its whole budget thinking and answer nothing.
     That is a real call, so it is billed, and reported as empty. */
  it('reports an empty answer rather than pretending it failed', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [] } }] }), { status: 200 }));

    expect((await call(['gemini-2.5-flash'])).text).toBeNull();
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });
});

describe('the order models are tried in', () => {
  it('puts what the owner chose first, then the rest as a fallback', () => {
    const ranked = [model('gemini-2.5-flash-lite'), model('gemini-2.5-flash'), model('gemini-2.5-pro')];

    expect(candidateNames(ranked, 'gemini-2.5-pro'))
      .toEqual(['gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.5-flash']);
  });

  it('uses the ranking as it stands when nothing is chosen', () => {
    const ranked = [model('gemini-2.5-flash-lite'), model('gemini-2.5-flash')];
    expect(candidateNames(ranked, null)).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
  });
});
