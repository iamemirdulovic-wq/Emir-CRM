import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteFromGemini, INLINE_THRESHOLD_BYTES, MAX_DOCUMENT_BYTES, uploadToGemini,
} from './gemini-files.js';

/**
 * The owner dropped a real developer brochure and was told it was "larger than
 * 14 MB — send the price list rather than the full brochure". That limit was
 * mine, not Google's: a request carrying a file inline is capped at 20 MB, but
 * the Files API takes 2 GB. Refusing the brochure was putting my limit on
 * their desk.
 */
describe('the size at which a file stops going inline', () => {
  it('leaves room for base64 and the prompt under the 20 MB request cap', () => {
    // Base64 inflates by a third.
    expect(INLINE_THRESHOLD_BYTES * 4 / 3).toBeLessThan(20 * 1024 * 1024);
  });

  /* A brochure is routinely bigger than the inline ceiling, which is the whole
     reason the upload path exists. */
  it('is far below what the CRM will read in total', () => {
    expect(MAX_DOCUMENT_BYTES).toBeGreaterThan(INLINE_THRESHOLD_BYTES * 8);
  });
});

describe('uploading a document to Google', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const started = (uploadUrl: string | null) =>
    new Response('{}', { status: 200, headers: uploadUrl ? { 'x-goog-upload-url': uploadUrl } : {} });

  const finished = (state: string) =>
    new Response(JSON.stringify({ file: { uri: 'https://g/files/abc', name: 'files/abc', state } }), { status: 200 });

  const file = { body: Buffer.alloc(32), bytes: 32, mimeType: 'application/pdf', filename: 'brochure.pdf' };

  it('starts, sends the bytes, and hands back the reference', async () => {
    fetchMock
      .mockResolvedValueOnce(started('https://upload/here'))
      .mockResolvedValueOnce(finished('ACTIVE'));

    const uploaded = await uploadToGemini('k', file);

    expect(uploaded).toEqual({ uri: 'https://g/files/abc', name: 'files/abc' });
    // The bytes go to the address the start step named, not to the API root.
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://upload/here');
  });

  it('asks for a resumable upload and declares the length up front', async () => {
    fetchMock
      .mockResolvedValueOnce(started('https://upload/here'))
      .mockResolvedValueOnce(finished('ACTIVE'));

    await uploadToGemini('k', { ...file, body: Buffer.alloc(1234), bytes: 1234 });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['X-Goog-Upload-Protocol']).toBe('resumable');
    expect(headers['X-Goog-Upload-Command']).toBe('start');
    expect(headers['X-Goog-Upload-Header-Content-Length']).toBe('1234');
    expect(headers['X-Goog-Upload-Header-Content-Type']).toBe('application/pdf');
  });

  /* A PDF is processed before it can be read, so the URI is not usable the
     moment the upload finishes. */
  it('waits while Google is still processing the file', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(started('https://upload/here'))
      .mockResolvedValueOnce(finished('PROCESSING'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'PROCESSING' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'ACTIVE' }), { status: 200 }));

    const pending = uploadToGemini('k', file);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toMatchObject({ name: 'files/abc' });
    vi.useRealTimers();
  });

  it('says so when Google could not read the file at all', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(started('https://upload/here'))
      .mockResolvedValueOnce(finished('PROCESSING'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'FAILED' }), { status: 200 }));

    const pending = uploadToGemini('k', file);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(pending).rejects.toThrow(/damaged, or password-protected/);
    vi.useRealTimers();
  });

  it('reports a refused start rather than carrying on', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 403 }));
    await expect(uploadToGemini('k', file)).rejects.toThrow(/403/);
  });

  it('reports a start that named no address', async () => {
    fetchMock.mockResolvedValueOnce(started(null));
    await expect(uploadToGemini('k', file)).rejects.toThrow(/did not say where/);
  });

  it('reports a failed upload of the bytes', async () => {
    fetchMock
      .mockResolvedValueOnce(started('https://upload/here'))
      .mockResolvedValueOnce(new Response('nope', { status: 500 }));

    await expect(uploadToGemini('k', file)).rejects.toThrow(/failed \(500\)/);
  });
});

describe('tidying up afterwards', () => {
  /* The answer is already in hand. A failure to delete must never surface. */
  it('never throws, whatever Google answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network gone')));
    await expect(deleteFromGemini('k', 'files/abc')).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});
