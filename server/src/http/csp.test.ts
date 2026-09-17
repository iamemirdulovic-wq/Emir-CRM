import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildCsp, inlineScriptHashes } from './csp.js';

describe('content security policy', () => {
  it('hashes an inline script so the theme bootstrap still runs', () => {
    const body = "document.documentElement.setAttribute('data-theme', 'dark');";
    const expected = `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
    expect(inlineScriptHashes(`<html><head><script>${body}</script></head></html>`)).toEqual([expected]);
  });

  it('ignores scripts loaded from a file, which script-src self already covers', () => {
    expect(inlineScriptHashes('<script type="module" src="/assets/index.js"></script>')).toEqual([]);
  });

  it('locks down the directives an injection would use', () => {
    const csp = buildCsp([]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self'");
  });

  it('allows the one third party the app uses: Google Fonts', () => {
    const csp = buildCsp([]);
    expect(csp).toContain('style-src');
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('https://fonts.gstatic.com');
  });
});
