/**
 * Sending a large document to Gemini.
 *
 * A `generateContent` request carrying the file inline is capped at 20 MB for
 * the whole encoded request, and base64 inflates a file by a third — so the
 * CRM refused anything over about 14 MB and told the owner to send a smaller
 * file. A developer's brochure is routinely bigger than that, and "send me
 * something else" is not an answer.
 *
 * Google's Files API is the way large documents are meant to go: upload once,
 * reference the result by URI, and the limit becomes 2 GB. Files there are
 * Google's copy and expire on their own after about two days; this deletes
 * them as soon as the answer comes back rather than leaving a brochure sitting
 * on someone else's disk.
 */
import { logger } from '../lib/logger.js';
import { badRequest } from '../lib/errors.js';
import { GEMINI_API_VERSION } from './models.js';

const BASE = 'https://generativelanguage.googleapis.com';

/**
 * Below this a file goes inline, which is one request instead of three.
 *
 * Comfortably under the 20 MB encoded ceiling: 8 MB of PDF is about 11 MB of
 * base64, leaving room for the prompt and the brokerage's own knowledge.
 */
export const INLINE_THRESHOLD_BYTES = 8 * 1024 * 1024;

/** What the CRM will read at all. Beyond this is a print-resolution master. */
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

export type UploadedFile = { uri: string; name: string };

/**
 * Upload a document and wait until Google says it is ready to read.
 *
 * Resumable in two steps because that is the protocol the Files API offers:
 * a start request that returns an upload address, then the bytes.
 */
export async function uploadToGemini(
  apiKey: string,
  file: { data: Buffer; mimeType: string; filename: string },
): Promise<UploadedFile> {
  const start = await fetch(`${BASE}/upload/${GEMINI_API_VERSION}/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(file.data.length),
      'X-Goog-Upload-Header-Content-Type': file.mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: file.filename.slice(0, 120) } }),
  });

  if (!start.ok) {
    logger.warn('could not start a gemini file upload', { status: start.status });
    throw badRequest(`Google would not accept the upload (${start.status}). Try a smaller file, or type it in.`);
  }

  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    logger.warn('gemini upload start returned no upload url');
    throw badRequest('Google did not say where to send the file. Try again in a moment.');
  }

  const sent = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(file.data.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: new Uint8Array(file.data),
  });

  if (!sent.ok) {
    logger.warn('gemini file upload failed', { status: sent.status });
    throw badRequest(`The upload to Google failed (${sent.status}). Try again, or send a smaller file.`);
  }

  const body = (await sent.json()) as { file?: { uri?: string; name?: string; state?: string } };
  const uri = body.file?.uri;
  const name = body.file?.name;
  if (!uri || !name) throw badRequest('Google accepted the file but did not say where it is. Try again.');

  // A PDF is processed before it can be read, so the URI is not usable yet.
  await waitUntilReady(apiKey, name, body.file?.state ?? 'PROCESSING');
  return { uri, name };
}

/** Poll until the file is ACTIVE, which for a large PDF takes a few seconds. */
async function waitUntilReady(apiKey: string, name: string, initialState: string): Promise<void> {
  let state = initialState;
  // Ten tries at a second and a half is fifteen seconds, which is longer than
  // a brochure has ever needed and short enough that nobody gives up first.
  for (let attempt = 0; attempt < 10 && state === 'PROCESSING'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const response = await fetch(`${BASE}/${GEMINI_API_VERSION}/${name}`, {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!response.ok) {
      logger.warn('could not check on an uploaded file', { status: response.status });
      break;
    }
    state = ((await response.json()) as { state?: string }).state ?? 'PROCESSING';
  }

  if (state === 'FAILED') throw badRequest('Google could not read that file. It may be damaged, or password-protected.');
  if (state === 'PROCESSING') throw badRequest('Google is still processing that file. Try again in a moment.');
}

/**
 * Remove our copy from Google.
 *
 * Best effort: the answer is already in hand, and a file left behind expires
 * on its own in about two days. A failure here must never fail the extraction.
 */
export async function deleteFromGemini(apiKey: string, name: string): Promise<void> {
  try {
    await fetch(`${BASE}/${GEMINI_API_VERSION}/${name}`, {
      method: 'DELETE',
      headers: { 'x-goog-api-key': apiKey },
    });
  } catch (err) {
    logger.debug('could not delete an uploaded file from google', {
      name, error: err instanceof Error ? err.message : String(err),
    });
  }
}
