import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * The content security policy for the app shell.
 *
 * We serve the SPA ourselves, so there is no CDN or edge in front of it to set
 * one — this is the only place it can come from.
 *
 * `index.html` carries one inline script: the theme bootstrap that runs before
 * first paint so a stored dark or reduced-glass choice does not flash the light
 * default. Rather than pin a hash in two places and watch them drift, the hash
 * is computed from the built file at boot. Change the bootstrap, rebuild, and
 * the policy follows.
 */
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const body = match[1];
    if (!body) continue;
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

export function buildCsp(scriptHashes: string[]): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // Fonts are the only third party the app talks to.
    'script-src': ["'self'", ...scriptHashes],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    // Agent-branded brochures and project photos can be hosted anywhere the
    // owner puts them; `img-src` is the one place that has to stay open.
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'connect-src': ["'self'"],
    'manifest-src': ["'self'"],
    'worker-src': ["'self'", 'blob:'],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/**
 * `style-src` keeps `'unsafe-inline'`: the design system animates through inline
 * `style` attributes (count-up numbers, charts that draw in), and React sets
 * those from JavaScript, where a nonce cannot reach them. Scripts, which is
 * where an injection would actually run, stay locked to self plus known hashes.
 */
export function cspForIndex(indexPath: string | null): string {
  let hashes: string[] = [];
  if (indexPath) {
    try {
      hashes = inlineScriptHashes(readFileSync(indexPath, 'utf8'));
    } catch {
      // No built shell yet (API-only deploy, or the build has not run). The
      // policy is still worth setting; it just allows no inline script.
    }
  }
  return buildCsp(hashes);
}
