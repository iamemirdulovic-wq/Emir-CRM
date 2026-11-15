import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The installed app must open the CRM we meant, and a change to that must be
 * able to reach a phone that already has it.
 *
 * On 15 Nov Emir installed the CRM from `/v2` three times and got an app that
 * opened the old one. Two faults, one behind the other:
 *
 *  1. `start_url` was `/dashboard`, so every install opened v1 whatever
 *     address it was installed from.
 *  2. Once that was fixed and deployed, it still did — because `sw.js`
 *     precaches the manifest, serves it cache-first, and names its cache with
 *     a constant that had not changed since the file was written. Every phone
 *     that had ever opened the CRM was pinned to the manifest it saw first,
 *     permanently, and no deploy could correct it.
 *
 * The second is the dangerous one: it makes a whole class of change
 * undeliverable, silently, and it looks like the user doing it wrong.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const sw = readFileSync(join(HERE, '..', 'public', 'sw.js'), 'utf8');
const manifest = JSON.parse(
  readFileSync(join(HERE, '..', 'public', 'manifest.webmanifest'), 'utf8'),
) as { start_url: string; scope: string; theme_color: string; background_color: string };

describe('the installed app', () => {
  it('opens v2', () => {
    /* Emir chose this on 15 Nov, for everyone, not only himself. If v2 ever
       moves address, this is one of the two places that must change. */
    expect(manifest.start_url).toBe('/v2');
  });

  it('can still reach the old CRM, so nobody is locked out of it', () => {
    expect(manifest.scope).toBe('/');
  });

  it('wears v2 colours rather than the old design’s', () => {
    /* #F2F0EC is v2's own --bg token. The old pale blue (#EAF3F8) behind a v2
       screen is the giveaway that this file was forgotten. */
    expect(manifest.theme_color).toBe('#F2F0EC');
    expect(manifest.background_color).toBe('#F2F0EC');
  });
});

describe('the service worker', () => {
  it('never serves the manifest from cache first', () => {
    /* Without this the three assertions above are decoration: they would be
       true in the repository and false on every phone. */
    expect(sw).toMatch(/ALWAYS_FRESH/);
    const list = /const ALWAYS_FRESH = \[([^\]]*)\]/.exec(sw)?.[1] ?? '';
    expect(list).toContain('/manifest.webmanifest');
  });

  it('tries the network before the cache for those files', () => {
    const branch = sw.slice(sw.indexOf('ALWAYS_FRESH.includes'));
    const fetchAt = branch.indexOf('fetch(request)');
    const cacheAt = branch.indexOf('caches.match(request)');
    expect(fetchAt).toBeGreaterThan(-1);
    expect(cacheAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeLessThan(cacheAt);
  });

  it('still keeps a copy for when there is no network', () => {
    expect(sw.slice(sw.indexOf('ALWAYS_FRESH.includes'))).toMatch(/catch\(\(\) => caches\.match/);
  });

  it('has a cache name past the one that froze the manifest', () => {
    /* Not "it equals v3" — that would need editing every time somebody does
       the right thing. It must simply not be the version that was stuck. */
    const name = /const CACHE = '([^']+)'/.exec(sw)?.[1] ?? '';
    expect(name).not.toBe('emir-crm-v2');
    expect(name).toMatch(/^emir-crm-v\d+$/);
  });

  it('throws away every cache but the current one, which is what makes a bump work', () => {
    expect(sw).toMatch(/keys\.filter\(\(key\) => key !== CACHE\)\.map\(\(key\) => caches\.delete\(key\)\)/);
  });
});
