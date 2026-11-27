import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

/**
 * Settings → Connections.
 *
 * The page exists because the CRM had been recording every webhook that
 * arrived and everything it sent back since the first week, and no screen
 * read either table. So these assertions guard the two things that would make
 * it worthless: a class that styles nothing, and a page an agent can open.
 */
describe('the Connections screen', () => {
  it('styles every class it uses', () => {
    const src = read('./Integrations.tsx');
    const css = read('../../styles/v2-integrations.css');
    const used = new Set(
      [...src.matchAll(/v2-int-[a-z-]+/g)].map((hit) => hit[0]),
    );
    expect(used.size).toBeGreaterThan(5);
    /* `v2-int-is-${one.state}` is built at runtime, so the four it can
       produce are checked by name rather than found in the source. */
    for (const name of ['v2-int-is-live', 'v2-int-is-quiet', 'v2-int-is-failing']) {
      used.add(name);
    }
    const missing = [...used].filter((name) => !css.includes(`.${name}`));
    expect(missing).toEqual([]);
  });

  it('is owner-only on the way in, not just hidden in the nav', () => {
    const app = read('../../App.tsx');
    expect(app).toContain(
      '<Route path="/v2/settings/integrations" element={<OwnerOnly><V2SettingsIntegrations /></OwnerOnly>} />',
    );
  });

  it('is reachable: left nav, the settings menu and the command palette', () => {
    expect(read('./Shell.tsx')).toContain("to: '/v2/settings/integrations'");
    expect(read('./General.tsx')).toContain("to: '/v2/settings/integrations'");
    expect(read('../nav.ts')).toContain("to: '/v2/settings/integrations'");
  });

  it('shows no key, token or secret', () => {
    /* The whole point is that it can be left open on a screen in the office.
       The server sends whether a thing is connected, never what with. */
    const src = read('./Integrations.tsx');
    expect(src).not.toMatch(/TOKEN|SECRET|_KEY\b/);
  });

  it('says plainly that a key is not the same as working', () => {
    /* The one sentence that stops somebody reading "Not connected" as "this
       page is broken" — and stops a green tick being trusted. */
    const src = read('./Integrations.tsx');
    expect(src).toContain('Having the key is not the same thing.');
    expect(src).toContain("quiet: 'Nothing yet'");
  });
});
