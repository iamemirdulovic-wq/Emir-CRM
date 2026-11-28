import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

/**
 * The per-person report has to be reachable by pressing things.
 *
 * It was built, routed at `/v2/team/:id/report`, and linked from absolutely
 * nowhere: the only way to open it was to type the address. Emir asked where
 * it was, was told, and still could not find it, because there was nothing to
 * find. A screen nobody can navigate to is a screen that does not exist.
 */
describe('the per-person report', () => {
  it('is routed', () => {
    expect(read('../App.tsx')).toContain('path="/v2/team/:id/report"');
  });

  it('has a button on the team panel and on the person page', () => {
    const team = read('./Team.tsx');
    const links = [...team.matchAll(/\/v2\/team\/\$\{(?:one\.id|id)\}\/report/g)];
    expect(links.length, 'both ways in').toBeGreaterThanOrEqual(2);
  });

  it('is open to a manager, not only the owner', () => {
    /* The server lets a manager read their own team's reports, so hiding the
       button from them would be the nav disagreeing with the permission. */
    const team = read('./Team.tsx');
    expect(team).toContain("user?.role === 'manager'");
  });

  it('can be found by searching for the word report', () => {
    const nav = read('./nav.ts');
    const line = nav.split('\n').find((one) => one.includes("label: 'Reports on each person'"));
    expect(line, 'an entry in the palette').toBeTruthy();
    expect(line).toContain('report');
    expect(line).toContain('pdf');
  });
});
