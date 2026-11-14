import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FACETS_SHOWN, SEARCH_UNDERSTANDS, callNote, visibleFacets, type CountryFacet,
} from '../lib/facets.js';
import { flagOf, originOf } from '../lib/dialling.js';

/**
 * The country and language chips on the leads screens.
 *
 * Emir, 14 November 2026: *"we need to add also this option, like country
 * based leads, language based leads, add also with flag, so our agents can
 * see easily which country they can filter the leads easily"* — and over the
 * plain table that came first: *"it should be smooth... nice way... more cool
 * way, I don't like it anymore."*
 *
 * Two things are being held down here. One is the behaviour of the chips.
 * The other is where the numbers come from: the browser has fifty rows and
 * the book has two thousand, so anything counted here would be a lie. Three
 * numbers on this product have already shipped wrong in exactly that way.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(file, 'utf8');

/**
 * The code with its comments taken out.
 *
 * Every assertion below that says "this file does not do X" has to read the
 * code, not the prose around it: the comments in this screen explain at
 * length what it deliberately does *not* do, and matching on those would
 * make the check fail on its own documentation.
 */
const code = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/* ── 1. the numbers are the server's ───────────────────────────────────── */

describe('where the counts come from', () => {
  const text = read(path.join(HERE, 'Leads.tsx'));

  it('asks the server for them, over the same filters as the list', () => {
    expect(text).toContain("api.get(`/api/my-leads/facets?${qs}`)");
    /* The same `qs` the list is fetched with, so the chips cannot be counted
       over a different list from the one on screen. */
    expect(text).toContain("api.get(`/api/my-leads?${qs}`)");
  });

  it('counts nothing itself', () => {
    /*
     * No `rows.filter(...).length` behind a chip, ever. The browser holds one
     * page; "UAE 24" over a book of 2,041 is the kind of number this product
     * has been caught inventing twice — a tab reading 419 over a list of
     * thirty, a day band reading "50 leads" because fifty is the page size.
     */
    const facetRows = code(
      text.slice(text.indexOf('function FacetRows'), text.indexOf('function narrowedTo')),
    );
    expect(facetRows).not.toMatch(/\brows\b/);
    expect(facetRows).not.toMatch(/originOf|clockIn/);
  });

  it('sends the chips in the URL, so a refresh keeps them and a link carries them', () => {
    expect(text).toContain("const country = params.get('country') ?? ''");
    expect(text).toContain("const language = params.get('language') ?? ''");
    expect(text).toContain("if (country) next.set('country', country)");
    expect(text).toContain("if (language) next.set('language', language)");
    /* And "Clear all" takes them off with the rest. */
    expect(text).toMatch(/for \(const key of \[[^\]]*'country', 'language'\]\) next\.delete\(key\)/);
  });

  it('draws one chip row component for the computer and the phone', () => {
    /* Two copies of a chip row is two chances for one of them to stop
       agreeing with the counts. */
    expect(text.match(/function FacetRows/g) ?? []).toHaveLength(1);
    expect(text.match(/<FacetRows/g) ?? []).toHaveLength(2);
    /* The phone one is the same component with `phone` set. */
    expect(text).toMatch(/<FacetRows\s+phone/);
  });

  it('never looks a country name up locally for the chip', () => {
    /*
     * The name on a filter chip comes from the facet the server sent. Looking
     * it up here would mean inventing a name for a dialling code the server
     * could not read — which is the one thing `dialling.ts`'s header forbids.
     */
    expect(text).toContain('const one = facets.data?.countries.find((row) => row.iso2 === country)');
  });
});

/* ── 2. no flag is ever guessed ────────────────────────────────────────── */

describe('the flag', () => {
  it('is drawn only where the dialling code is one we know', () => {
    expect(originOf('+971501234567')?.iso2).toBe('AE');
    expect(flagOf('AE')).toBe('🇦🇪');
    /* +599 (Curaçao) is not in the table, so there is no origin and so no
       flag. Not a question mark, not a globe, not the nearest guess. */
    expect(originOf('+5999123456')).toBeNull();
    expect(originOf(null)).toBeNull();
    expect(flagOf('unknown')).toBe('');
  });

  it('is conditional on the origin in every place the row draws it', () => {
    const text = read(path.join(HERE, 'Leads.tsx'));
    /* The table cell and the phone card, both guarded by `origin &&`. */
    expect(text).toContain('{origin && (\n          <span className="v2-t-flag"');
    expect(text).toContain('{origin && <span className="v2-a-flag" aria-hidden>{flagOf(origin.iso2)}</span>}');
  });
});

/* ── 3. the chip that is picked never disappears ───────────────────────── */

describe('folding a long row of chips', () => {
  const country = (iso2: string, count: number): CountryFacet => ({
    iso2,
    name: iso2,
    flag: '',
    count,
    timeZone: null,
    zoneLabel: null,
    localTime: null,
    localHour: null,
    night: null,
  });
  const many = Array.from({ length: 20 }, (_, i) => country(`C${i}`, 100 - i));

  it('shows the first few and says how many are behind them', () => {
    const out = visibleFacets(many, { expanded: false, picked: () => false });
    expect(out.shown).toHaveLength(FACETS_SHOWN);
    expect(out.hidden).toBe(20 - FACETS_SHOWN);
  });

  it('shows everything once the row is opened', () => {
    const out = visibleFacets(many, { expanded: true, picked: () => false });
    expect(out.shown).toHaveLength(20);
    expect(out.hidden).toBe(0);
  });

  it('keeps the picked chip on screen however far down the list it is', () => {
    /*
     * Choose a small country from the opened row, collapse it, and the only
     * chip saying what the list is narrowed to would otherwise vanish.
     */
    const out = visibleFacets(many, { expanded: false, picked: (one) => one.iso2 === 'C17' });
    expect(out.shown.map((one) => one.iso2)).toContain('C17');
    expect(out.hidden).toBe(20 - FACETS_SHOWN - 1);
  });

  it('does not fold a row that fits', () => {
    const few = many.slice(0, 3);
    expect(visibleFacets(few, { expanded: false, picked: () => false }))
      .toEqual({ shown: few, hidden: 0 });
  });
});

/* ── 4. the clock on a chip ────────────────────────────────────────────── */

describe('what the chip says about the hour there', () => {
  const base: CountryFacet = {
    iso2: 'GB',
    name: 'United Kingdom',
    flag: '🇬🇧',
    count: 186,
    timeZone: 'Europe/London',
    zoneLabel: null,
    localTime: '03:12',
    localHour: 3,
    night: true,
  };

  it('says too early before the window and too late after it', () => {
    expect(callNote(base)).toBe('03:12 in United Kingdom — too early to call');
    expect(callNote({ ...base, localTime: '22:40', localHour: 22 }))
      .toBe('22:40 in United Kingdom — too late to call');
  });

  it('just says the time when it is a decent hour', () => {
    expect(callNote({ ...base, localTime: '14:05', localHour: 14, night: false }))
      .toBe('14:05 in United Kingdom');
  });

  it('names the city where a country spans zones', () => {
    /* "15:30 in Moscow" rather than implying Russia is on one clock. */
    expect(callNote({
      ...base, iso2: 'RU', name: 'Russia / Kazakhstan', zoneLabel: 'Moscow',
      localTime: '15:30', localHour: 15, night: false,
    })).toBe('15:30 in Moscow');
  });

  it('says nothing at all where there is no clock to read', () => {
    expect(callNote({
      ...base, iso2: 'unknown', name: 'Unknown', timeZone: null,
      localTime: null, localHour: null, night: null,
    })).toBeNull();
  });

  it('uses 24-hour times, like every other time in the CRM', () => {
    /* The server formats these, and `countries.test.ts` on that side holds
       the line. This is the browser's half: nothing here re-formats them. */
    expect(callNote(base)).not.toMatch(/AM|PM/);
    const source = read(path.join(HERE, '..', 'lib', 'facets.ts'));
    expect(source).not.toContain('hour12');
  });
});

/* ── 5. the search box says what it takes ─────────────────────────────── */

describe('the search box', () => {
  const text = read(path.join(HERE, 'Leads.tsx'));

  it('tells the reader the words it understands', () => {
    /* A box that quietly takes "asleep" is a box nobody types "asleep" into. */
    expect(SEARCH_UNDERSTANDS).toEqual(
      expect.arrayContaining(['country', 'language', 'awake', 'asleep']),
    );
    expect(text).toContain('{SEARCH_UNDERSTANDS.join');
    expect(text).toContain('placeholder="Name, phone, project, country, language, awake/asleep"');
  });

  it('leaves the matching to the server', () => {
    /*
     * The word appears in the placeholder, which is the point of it. What
     * must not appear is the browser deciding what it means: `searchClause`
     * on the server is the one place a typed word becomes a query, and a
     * second keyword list here would drift from it inside a week.
     */
    expect(code(text)).not.toMatch(/===\s*'asleep'|includes\('asleep'\)/);
    expect(code(text)).not.toMatch(/CALL_FROM|CALL_UNTIL/);
  });
});

/* ── 6. the chips are styled, and in the right half of the file ────────── */

describe('the stylesheets', () => {
  const STYLES = path.join(HERE, '..', 'styles');
  const shell = read(path.join(STYLES, 'v2-shell.css'));
  const phone = read(path.join(STYLES, 'v2-phone-a.css'));

  it('styles every class the chip rows use', () => {
    for (const name of [
      'v2-facets', 'v2-facet-row', 'v2-facet-label', 'v2-facet-pills', 'v2-facet',
      'v2-facet-n', 'v2-facet-flag', 'v2-facet-moon', 'v2-facet-more', 'v2-facet-note',
      'v2-search-hint', 'v2-t-flag', 'v2-t-moon',
    ]) {
      expect(shell, name).toContain(`.${name}`);
    }
    for (const name of ['v2-facets', 'v2-facet-pills', 'v2-facet', 'v2-a-flag']) {
      expect(phone, name).toContain(`.${name}`);
    }
  });

  it('puts the computer rules outside the phone media query', () => {
    /*
     * The bottom half of `v2-shell.css` is inside `@media (max-width:767px)`,
     * and three fixes written for the computer have already landed in there
     * and done nothing above 767px, in silence, with the suite green.
     *
     * So: everything from `.v2 .v2-facets` to the end of the file must be at
     * the base level — no media query opened after it that is still open.
     */
    const from = shell.indexOf('.v2 .v2-facets{');
    expect(from).toBeGreaterThan(0);
    const after = shell.slice(from);
    expect(after).not.toContain('@media');
    /* And nothing re-opens a block before it that our rules would fall into:
       the last `@media` in the file opens before our block and must close
       before it too. Counting braces from the last media query to our rules
       is the check. */
    const before = shell.slice(0, from);
    const lastMedia = before.lastIndexOf('@media');
    const between = before.slice(lastMedia);
    const opened = (between.match(/\{/g) ?? []).length;
    const closed = (between.match(/\}/g) ?? []).length;
    expect(opened, 'the last media query is closed before our rules').toBe(closed);
  });

  it('keeps every phone rule inside the phone media query', () => {
    const from = phone.indexOf('.v2.v2-phone .v2-facets');
    expect(from).toBeGreaterThan(0);
    const before = phone.slice(0, from);
    const lastMedia = before.lastIndexOf('@media (max-width: 767px)');
    expect(lastMedia).toBeGreaterThan(0);
    const between = before.slice(lastMedia);
    expect((between.match(/\{/g) ?? []).length).toBeGreaterThan((between.match(/\}/g) ?? []).length);
  });

  it('puts no flex on a table cell', () => {
    /*
     * `display:flex` on a `<td>` stops the cell drawing the row's border —
     * the bottom border draws at the height of the content instead, so every
     * name gets a short line under it that stops before the next column. It
     * cost an hour on 14 November. The flag goes in a `span`.
     */
    const ours = shell.slice(shell.indexOf('.v2 .v2-facets{'));
    expect(ours).not.toMatch(/td[^{]*\{[^}]*display:\s*flex/);
  });

  it('invents no colour: tokens only, and orange is var(--accent)', () => {
    const ours = shell.slice(shell.indexOf('.v2 .v2-facets{'));
    /* No hex, no rgb(), no named colour — every colour is a token. */
    expect(ours).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(ours).not.toMatch(/\brgba?\(/);
    expect(ours).toContain('var(--accent)');
  });
});
