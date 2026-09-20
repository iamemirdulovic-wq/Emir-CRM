/**
 * Fetching a developer's project page so Emir AI can read it.
 *
 * This exists because "Paste a link" did nothing. The link was handed to
 * Gemini as a sentence — "read the page at this address" — and Gemini has no
 * browser. It did the right thing with an impossible instruction and returned
 * nulls, so the wizard filled in nothing and said nothing. The page has to be
 * fetched here and handed over as text.
 *
 * **The danger this creates.** A URL the CRM will fetch on request is a way to
 * make the server reach things the caller cannot: its own loopback interface,
 * the private network around it, a cloud metadata endpoint. Everything below
 * is about refusing that — the scheme, every resolved address, and every
 * redirect hop, each checked before a connection is made.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/** Long enough for a slow developer site, short enough that nobody gives up. */
const TIMEOUT_MS = 12_000;
/** A project page is text; anything larger is not one. */
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** What Gemini is given. Beyond this is navigation and footers. */
const MAX_TEXT_CHARS = 24_000;

export type FetchedPage = {
  url: string;
  title: string | null;
  text: string;
  /** Absolute image URLs, biggest-looking first, for the cover photo. */
  images: string[];
};

/**
 * Is this address one the caller should be able to reach through us?
 *
 * Refuses loopback, private ranges, link-local (which includes the cloud
 * metadata address 169.254.169.254), carrier-grade NAT, and the IPv6
 * equivalents including v4-mapped addresses.
 */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return false;

  if (version === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts as [number, number, number, number];
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    if (a === 0 || a === 10 || a === 127) return false;            // this host, private, loopback
    if (a === 169 && b === 254) return false;                       // link-local, incl. metadata
    if (a === 172 && b >= 16 && b <= 31) return false;              // private
    if (a === 192 && b === 168) return false;                       // private
    if (a === 192 && b === 0) return false;                         // protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return false;             // carrier-grade NAT
    if (a >= 224) return false;                                     // multicast and reserved
    return true;
  }

  const lower = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === '::' || lower === '::1') return false;              // unspecified, loopback
  if (lower.startsWith('fe80')) return false;                       // link-local
  if (/^f[cd]/.test(lower)) return false;                           // unique local
  if (lower.startsWith('ff')) return false;                         // multicast
  // ::ffff:10.0.0.1 and friends are IPv4 wearing a hat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return isPublicAddress(mapped[1]);
  return true;
}

/** Every address this hostname resolves to must be one we are willing to reach. */
async function assertReachable(target: URL): Promise<void> {
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw badRequest('Only http and https links can be read.');
  }

  const host = target.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw badRequest('That address is not one the CRM will fetch.');
    return;
  }

  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw badRequest(`Could not find ${host}. Check the address.`);
  }

  // Every one, not just the first: a name that resolves to both a public and a
  // private address must not be usable to reach the private one.
  if (addresses.length === 0 || !addresses.every((row) => isPublicAddress(row.address))) {
    throw badRequest('That address is not one the CRM will fetch.');
  }
}

/**
 * Fetch a page, following redirects by hand so each hop is checked.
 *
 * `redirect: 'manual'` on purpose: letting fetch follow them would mean a
 * public address could redirect to a private one after the check had passed.
 */
export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw badRequest('That does not look like a web address.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let response: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertReachable(target);

      response = await fetch(target, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // Named honestly. A site that would rather not be read can say so.
          'User-Agent': 'EmirCRM/1.0 (+project library importer)',
          Accept: 'text/html,application/xhtml+xml',
        },
      }).catch((err: Error) => {
        if (err.name === 'AbortError') throw badRequest('That page took too long to answer.');
        throw badRequest(`Could not open that page: ${err.message}`);
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) break;
        target = new URL(location, target);
        continue;
      }
      break;
    }

    if (!response) throw badRequest('Could not open that page.');
    if (!response.ok) {
      throw badRequest(
        response.status === 404
          ? 'That page was not found. Check the address.'
          : `That page answered ${response.status}.`,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html') && !contentType.includes('text/plain')) {
      throw badRequest('That link is not a web page. Paste the project page, or drop the PDF instead.');
    }

    const html = await readCapped(response);
    return { url: target.toString(), ...parseHtml(html, target) };
  } finally {
    clearTimeout(timer);
  }
}

/** Read the body, stopping at the cap rather than buffering whatever arrives. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * The readable content of a page, and its pictures.
 *
 * A deliberately small parser rather than a DOM library: what Gemini needs is
 * the words, and what the wizard needs is a handful of image addresses.
 */
export function parseHtml(html: string, base: URL): Omit<FetchedPage, 'url'> {
  const withoutCode = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(withoutCode)?.[1]?.trim() ?? null;

  /* Meta descriptions and og: tags carry the summary a page was written to
     show elsewhere, which is often the cleanest statement of the facts. */
  const meta: string[] = [];
  for (const match of withoutCode.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = /(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (!name || !content) continue;
    if (name === 'description' || name.startsWith('og:') || name.startsWith('twitter:')) {
      meta.push(`${name}: ${decodeEntities(content)}`);
    }
  }

  const body = decodeEntities(
    withoutCode
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

  const text = [title, meta.join('\n'), body].filter(Boolean).join('\n\n').slice(0, MAX_TEXT_CHARS);

  return { title, text, images: findImages(withoutCode, base) };
}

/** Image addresses worth offering as a cover, best guess first. */
function findImages(html: string, base: URL): string[] {
  const found: string[] = [];

  // What the page itself nominates as its picture.
  for (const match of html.matchAll(/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image|twitter:image)[^"']*["'][^>]*>/gi)) {
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1];
    if (content) found.push(content);
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    // Lazy-loaded pages put the real address in data-src.
    const src = /(?:data-src|data-original|src)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (src) found.push(src);
  }

  const absolute: string[] = [];
  for (const candidate of found) {
    try {
      const url = new URL(candidate, base);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      // Icons, spacers and tracking pixels are not project photography.
      if (/(sprite|icon|logo|favicon|pixel|spacer|placeholder|avatar)/i.test(url.pathname)) continue;
      if (/\.svg($|\?)/i.test(url.pathname)) continue;
      const href = url.toString();
      if (!absolute.includes(href)) absolute.push(href);
    } catch {
      // A malformed src is not worth a line in the log.
    }
  }

  if (absolute.length === 0) logger.debug('no usable images on the page', { url: base.toString() });
  return absolute.slice(0, 12);
}

/** The handful of entities that actually appear in prose. */
function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}
