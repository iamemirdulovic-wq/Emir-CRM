import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
import { placeIn, readWalk, rememberWalk } from './lead-walk.js';

/*
 * Emir, 17 Nov 2026: a "next lead" button so the team does not have to go
 * back out to the list. Next has to mean the next lead *on screen*, which is
 * why the list writes its order down and the page walks it.
 */
describe('lead walk', () => {
  beforeEach(() => sessionStorage.clear());

  it('the lead page finds its place in the list it came from', () => {
    rememberWalk('/v2/leads?tab=hot', [
      { id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }, { id: 'c', name: null },
    ]);
    const place = placeIn(readWalk(), 'b');
    expect(place).toEqual({
      at: 2, total: 3, next: { id: 'c', name: null }, prev: { id: 'a', name: 'Ann' }, list: '/v2/leads?tab=hot',
    });
  });

  it('the last lead has no next, and a lead opened from elsewhere has no bar', () => {
    rememberWalk('/v2/leads', [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }]);
    expect(placeIn(readWalk(), 'b')?.next).toBeNull();
    expect(placeIn(readWalk(), 'zzz')).toBeNull();
  });

  it('broken storage gives no walk rather than an error', () => {
    sessionStorage.setItem('v2.leadWalk', '{not json');
    expect(readWalk()).toBeNull();
  });

  it('the list remembers its order and both lead screens offer Next lead', () => {
    const list = readFileSync(path.join(HERE, 'Leads.tsx'), 'utf8');
    const page = readFileSync(path.join(HERE, 'Lead.tsx'), 'utf8');
    const panel = readFileSync(path.join(HERE, 'LeadPanel.tsx'), 'utf8');
    expect(list).toMatch(/rememberWalk\(listAt, drawn\.map/);
    expect(page).toMatch(/placeIn\(readWalk\(\), lead\.id\)/);
    expect(page).toContain('Next lead');
    expect(panel).toMatch(/onClick=\{onNext\}/);
  });
});
