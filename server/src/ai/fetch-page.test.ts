import { describe, expect, it } from 'vitest';
import { isPublicAddress, parseHtml } from './fetch-page.js';

/**
 * A URL the CRM will fetch on request is a way to make the server reach things
 * the caller cannot — its own loopback, the private network around it, the
 * cloud metadata endpoint. These are the addresses it must refuse.
 */
describe('addresses the CRM will not fetch', () => {
  it('refuses loopback and the unspecified address', () => {
    for (const address of ['127.0.0.1', '127.1.2.3', '0.0.0.0', '::1', '::']) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('refuses the private ranges', () => {
    for (const address of ['10.0.0.1', '10.255.255.254', '172.16.0.1', '172.31.255.1', '192.168.1.1']) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  /* 169.254.169.254 is the cloud metadata endpoint: credentials, in plain
     text, to anything that can make one HTTP request. */
  it('refuses link-local, including the metadata address', () => {
    expect(isPublicAddress('169.254.169.254')).toBe(false);
    expect(isPublicAddress('169.254.0.1')).toBe(false);
    expect(isPublicAddress('fe80::1')).toBe(false);
  });

  it('refuses carrier-grade NAT and multicast', () => {
    expect(isPublicAddress('100.64.0.1')).toBe(false);
    expect(isPublicAddress('224.0.0.1')).toBe(false);
    expect(isPublicAddress('255.255.255.255')).toBe(false);
  });

  it('refuses IPv6 unique-local and loopback', () => {
    expect(isPublicAddress('fc00::1')).toBe(false);
    expect(isPublicAddress('fd12:3456::1')).toBe(false);
    expect(isPublicAddress('ff02::1')).toBe(false);
  });

  /* A private address written as IPv6 is still a private address. */
  it('sees through a v4-mapped IPv6 address', () => {
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:10.0.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:169.254.169.254')).toBe(false);
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
  });

  it('allows an ordinary public address', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('93.184.216.34')).toBe(true);
    expect(isPublicAddress('2606:2800:220:1::1')).toBe(true);
  });

  it('refuses anything that is not an address at all', () => {
    expect(isPublicAddress('')).toBe(false);
    expect(isPublicAddress('not-an-address')).toBe(false);
    expect(isPublicAddress('999.999.999.999')).toBe(false);
  });
});

/**
 * What Gemini gets is the words on the page, and what the wizard gets is a
 * handful of picture addresses.
 */
describe('reading a project page', () => {
  const base = new URL('https://developer.example/projects/sei-saadiyat');

  const page = `
    <html><head>
      <title>Sei Saadiyat — ALDAR</title>
      <meta name="description" content="Waterfront apartments on Saadiyat Island.">
      <meta property="og:image" content="/img/hero.jpg">
      <script>var tracking = "should not appear";</script>
      <style>.x { color: red }</style>
    </head><body>
      <nav><a href="/">Home</a></nav>
      <h1>Sei Saadiyat</h1>
      <p>Prices from AED 2,400,000. Handover Q4&nbsp;2030.</p>
      <img src="/img/pool.jpg"><img data-src="https://cdn.example/lobby.jpg">
      <img src="/img/logo.svg"><img src="/assets/facebook-icon.png">
    </body></html>`;

  it('keeps the words and drops the code', () => {
    const { text, title } = parseHtml(page, base);

    expect(title).toBe('Sei Saadiyat — ALDAR');
    expect(text).toContain('Waterfront apartments on Saadiyat Island.');
    expect(text).toContain('AED 2,400,000');
    expect(text).not.toContain('should not appear');
    expect(text).not.toContain('color: red');
  });

  it('turns entities back into the characters they stand for', () => {
    expect(parseHtml(page, base).text).toContain('Handover Q4 2030');
  });

  it('makes every picture address absolute', () => {
    const { images } = parseHtml(page, base);

    expect(images).toContain('https://developer.example/img/hero.jpg');
    expect(images).toContain('https://developer.example/img/pool.jpg');
    // A lazy-loaded page keeps the real address in data-src.
    expect(images).toContain('https://cdn.example/lobby.jpg');
  });

  /* A logo or a share icon is not project photography, and an SVG is a
     document that can carry script. */
  it('leaves out logos, icons and SVGs', () => {
    const { images } = parseHtml(page, base);

    expect(images.some((url) => url.includes('logo'))).toBe(false);
    expect(images.some((url) => url.includes('facebook-icon'))).toBe(false);
    expect(images.some((url) => url.endsWith('.svg'))).toBe(false);
  });

  it(`puts the page own nominated picture first`, () => {
    expect(parseHtml(page, base).images[0]).toBe('https://developer.example/img/hero.jpg');
  });

  it('copes with a page that has nothing in it', () => {
    const empty = parseHtml('<html><body></body></html>', base);
    expect(empty.text).toBe('');
    expect(empty.images).toEqual([]);
    expect(empty.title).toBeNull();
  });
});
