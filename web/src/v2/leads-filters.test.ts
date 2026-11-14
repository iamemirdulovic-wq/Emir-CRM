import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { callNote, type CountryFacet } from '../lib/facets.js';
import { flagOf, originOf } from '../lib/dialling.js';

/**
 * The computer leads table: the filter row, and the table under it.
 *
 * Emir looked at both on 14 November and wrote a numbered list against a
 * picture of each. The filtering he kept — *"country and language filter (it
 * is live)"* — and almost everything else he rejected: two rows of chips,
 * two grey help sentences, rows 130px tall with four leads on a screen, a
 * next-step column cut to "No ne…", buttons drawn over it, and a table
 * 1,411px wide inside 1,148px with a pinned column on top of two others.
 *
 * These tests hold down what replaced it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(file, 'utf8');
const LEADS = read(path.join(HERE, 'Leads.tsx'));
const SHELL = read(path.join(HERE, '..', 'styles', 'v2-shell.css'));
const PHONE_CSS = read(path.join(HERE, '..', 'styles', 'v2-phone-a.css'));

/**
 * The code with its comments taken out.
 *
 * Every assertion that says "this file does not do X" has to read the code,
 * not the prose around it: the comments in this screen explain at length what
 * it deliberately does not do, and matching on those would make the check
 * fail on its own documentation.
 */
const code = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** The same for a stylesheet, which has only block comments. */
const rules = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

/* ── 1. the numbers are the server's ───────────────────────────────────── */

describe('where the counts come from', () => {
  it('asks the server for them, over the same filters as the list', () => {
    expect(LEADS).toContain("api.get(`/api/my-leads/facets?${qs}`)");
    expect(LEADS).toContain("api.get(`/api/my-leads?${qs}`)");
  });

  it('counts nothing itself', () => {
    /*
     * No `rows.filter(...).length` behind a count, ever. The browser holds
     * one page; "UAE 24" over a book of 2,041 is the kind of number this
     * product has been caught inventing twice — a tab reading 419 over a list
     * of thirty, a day band reading "50 leads" because fifty is the page size.
     */
    const picker = code(
      LEADS.slice(LEADS.indexOf('function FilterPicker'), LEADS.indexOf('function narrowedTo')),
    );
    expect(picker).not.toMatch(/\brows\b/);
    expect(picker).not.toMatch(/originOf|clockIn/);
  });

  it('draws the black bar from real numbers, or not at all', () => {
    /*
     * Picture 01 point 9 asks for "18 of 40 calls today" with a progress
     * line. Both halves come back with the tab counts — `call_logs` and
     * `DAILY_GOALS.calls`. With no goal there is no rail, rather than an
     * empty one with an invented denominator.
     */
    expect(LEADS).toContain('counts.data?.callsToday ?? 0');
    expect(LEADS).toContain('counts.data?.callGoal ?? 0');
    expect(LEADS).toContain('{callGoal > 0 && (');
    expect(code(LEADS)).not.toMatch(/callGoal = \d/);
  });

  it('sends every filter in the URL, so a refresh keeps it and a link carries it', () => {
    for (const key of ['country', 'language', 'added']) {
      expect(LEADS, key).toContain(`const ${key} = params.get('${key}') ?? ''`);
      expect(LEADS, key).toContain(`if (${key}) next.set('${key}', ${key})`);
      expect(code(LEADS), key).toMatch(new RegExp(`for \\(const key of \\[[^\\]]*'${key}'`));
    }
  });
});

/* ── 2. one filter row, and the chips are gone ─────────────────────────── */

describe('the filter row Emir asked for', () => {
  it('has no chip rows left, in the markup or in either stylesheet', () => {
    /* §2.3 and §2.7: "Remove the chip rows, '+59 more' and all grey help
       sentences." Not hidden — gone. */
    expect(LEADS).not.toContain('FacetRows');
    expect(LEADS).not.toContain('v2-facet');
    expect(SHELL).not.toContain('v2-facet');
    expect(PHONE_CSS).not.toContain('v2-facet');
    expect(LEADS).not.toMatch(/\+\{[^}]*\} more/);
  });

  it('has no grey help sentences under the search box or the filters', () => {
    /* §2.4 "No help sentence", §2.5 "Clean search box only." */
    expect(LEADS).not.toContain('v2-search-hint');
    expect(LEADS).not.toContain('SEARCH_UNDERSTANDS');
    expect(LEADS).not.toContain('English is what the language field starts as');
    expect(SHELL).not.toContain('v2-search-hint');
    expect(LEADS).toContain('placeholder="Search in this list"');
  });

  it('puts Country and Language in the same row as Stage and Project', () => {
    const row = LEADS.slice(LEADS.indexOf('<div className="d-filters">'));
    const upTo = row.slice(0, row.indexOf('{leads.error'));
    for (const name of ['aria-label="Stage"', 'aria-label="Project"', 'label="Country"', 'label="Language"']) {
      expect(upTo, name).toContain(name);
    }
    /* §2.7's order: search, Stage, Project, Country, Language, then the
       count on the right. */
    expect(upTo.indexOf('aria-label="Stage"')).toBeLessThan(upTo.indexOf('aria-label="Project"'));
    expect(upTo.indexOf('aria-label="Project"')).toBeLessThan(upTo.indexOf('label="Country"'));
    expect(upTo.indexOf('label="Country"')).toBeLessThan(upTo.indexOf('label="Language"'));
    expect(upTo.indexOf('label="Language"')).toBeLessThan(upTo.indexOf('d-result-count'));
  });

  it('gives the dropdown a search box inside it, because there are 59 countries', () => {
    expect(LEADS).toContain('v2-filt-find');
    expect(LEADS).toContain('placeholder={searchHint}');
    expect(SHELL).toContain('.v2-filt-find');
    expect(SHELL).toContain('.v2-filt-list');
  });

  it('keeps the moon inside the dropdown row', () => {
    expect(LEADS).toContain('v2-filt-moon');
    expect(SHELL).toContain('.v2-filt-moon');
    /* And the hover that says which way — "too early" or "too late". */
    expect(LEADS).toContain('title={one.note ?? undefined}');
  });

  it('shows Export only to somebody who may export', () => {
    expect(LEADS).toContain("user.role === 'owner' || user.role === 'admin'");
    expect(LEADS).toContain('{canExport && (');
    expect(LEADS).toContain('/api/my-leads/export.csv?${qs}');
  });

  it('styles every class the dropdown uses', () => {
    for (const name of [
      'v2-filt', 'v2-filt-btn', 'v2-filt-panel', 'v2-filt-find', 'v2-filt-list',
      'v2-filt-row', 'v2-filt-name', 'v2-filt-n', 'v2-filt-flag', 'v2-filt-moon',
      'v2-filt-none', 'v2-callbar', 'v2-t-acts', 'v2-t-stage', 'v2-t-nophone',
    ]) {
      expect(SHELL, name).toContain(`.${name}`);
    }
  });

  it('leaves the phone its own shape, and a way out of a filtered link', () => {
    /*
     * §0: "Each phone screen is its own layout from its picture. Do not
     * squeeze the computer page." No dropdown row on the phone — but a link
     * carrying `?country=GB` still has to be undoable, so the filter shows as
     * one pill in the strip the design already draws.
     */
    const branch = LEADS.slice(LEADS.indexOf('if (isPhone) {'), LEADS.indexOf('<div className="d-filters">'));
    expect(branch).not.toContain('FilterPicker');
    expect(branch).toContain('v2-a-chip v2-a-chip-on');
    expect(branch).toContain('dropChip(chip.key)');
  });
});

/* ── 3. plain English, never a database code ───────────────────────────── */

describe('no raw codes in front of a person', () => {
  it('takes the language label from the server, which spells it out', () => {
    /*
     * §0: "Never show raw codes to people: no 'en', 'walk_in', 'csv_import',
     * file names, or database ids." `languageName` on the server turns "ar"
     * into "Arabic" and a blank into "Not known".
     */
    const options = LEADS.slice(LEADS.indexOf('function languageOptions'), LEADS.indexOf('function narrowedTo'));
    expect(options).toContain('label: one.label');
  });

  it('prints the label and never the value', () => {
    const picker = code(LEADS.slice(LEADS.indexOf('function FilterPicker'), LEADS.indexOf('function countryOptions')));
    expect(picker).toContain('{one.label}');
    /* `key={one.value}` is React's business; nothing is PRINTED from it. */
    expect(picker).not.toMatch(/>\s*\{one\.value\}/);
  });
});

/* ── 4. no flag is ever guessed ────────────────────────────────────────── */

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

  it('is conditional everywhere it is drawn', () => {
    expect(LEADS).toContain('{one.flag && <span className="v2-filt-flag"');
    expect(LEADS).toContain('{chosen?.flag && <span className="v2-filt-flag"');
    expect(LEADS).toContain('{origin && <span className="v2-a-flag" aria-hidden>{flagOf(origin.iso2)}</span>}');
  });

  it('is not in the phone column, where it was cutting the number', () => {
    /* 22px of a 160px column that has to hold "+971 50 123 4567" without
       ever cutting it. The flags are in the Country dropdown instead. */
    expect(LEADS).not.toContain('v2-t-flag');
    expect(SHELL).not.toContain('v2-t-flag');
  });
});

/* ── 5. the clock on a row ─────────────────────────────────────────────── */

describe('what the dropdown says about the hour there', () => {
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
    expect(callNote(base)).not.toMatch(/AM|PM/);
    expect(read(path.join(HERE, '..', 'lib', 'facets.ts'))).not.toContain('hour12');
  });
});

/* ── 6. the table fits; it does not scroll sideways ────────────────────── */

describe('the leads table fits the card', () => {
  it('makes the card scroll in neither direction', () => {
    /*
     * §2.9: "Must fit at 1280, 1440 and 1920 px. No cut column, no sideways
     * scroll, and NO column on top of another." The card scrolling sideways
     * is what made a sticky header resolve against the card, and a pinned
     * column is a column drawn on top of whatever is under it.
     */
    expect(SHELL).toMatch(/\.v2 \.p-all-leads \.d-table-wrap\{ overflow:visible; \}/);
    expect(SHELL).not.toMatch(/\.d-table-wrap\{ overflow:auto; \}/);
  });

  it('pins nothing to an edge', () => {
    const ours = SHELL.slice(SHELL.indexOf('── The leads table FITS'));
    expect(ours).not.toContain('position:sticky; left:0');
    expect(ours).not.toContain('position:sticky; right:0');
    /* And the old right-pinned last column is gone from the whole file. */
    expect(SHELL).not.toMatch(/d-id-leads td:last-child \{\s*position: sticky/);
  });

  it('leaves the header sticking to the page, at the design’s own offset', () => {
    expect(SHELL).not.toMatch(/d-table\.d-sticky th\{ top:0; \}/);
    expect(LEADS).not.toContain('useSheetHeight');
    expect(LEADS).not.toContain('maxHeight');
  });

  it('gives every column a width, and the name enough of it', () => {
    expect(SHELL).toMatch(/\.v2 \.d-id-leads\.v2-cols-book\{ table-layout:fixed; width:100%; \}/);
    /*
     * Keyed off the table's own class, not the page's: an agent on their own
     * All tab renders `p-all-leads` with eight columns, not the owner's ten,
     * and a ten-column budget would put the tick box's 30px on their Lead.
     */
    expect(LEADS).toContain("${book ? 'v2-cols-book' : 'v2-cols-mine'}");

    /*
     * The widths each column's content really needs, measured in a browser
     * at 1280px with a range over the cell's own contents so the column
     * could not hide them:
     *
     *   the longest name 122 ("Mariam Al Suwaidi"), a phone number 129,
     *   the longest next step 151 ("Overdue 14 Nov, 09:12"),
     *   the VIP tag 32, the face 34, 8px of padding each side.
     *
     * So a Lead cell wants 16 + 34 + 11 + 122 + 6 + 32 = 221px to hold the
     * worst case whole, and a next step wants 167. The first budget gave the
     * next step 262px at 1440 because §2.2 calls it the widest column, and
     * the names came out as "Sara …" — which is the complaint Emir opened
     * his list with, and it outranks the widest-column rule.
     */
    const NEED_NAME = 221;
    const NEED_NEXT = 167;

    for (const table of ['v2-cols-mine', 'v2-cols-book']) {
      const shares = new Map<string, number>();
      for (const found of SHELL.matchAll(
        new RegExp(`\\.v2 \\.d-id-leads\\.${table} th:nth-child\\((\\d+)\\)\\{ width:([\\d.]+)%; \\}`, 'g'),
      )) {
        if (!shares.has(found[1] as string)) shares.set(found[1] as string, Number(found[2]));
      }
      /* One width per column: the file also carries a narrow-window override
         for the buttons and the clock, and counting both would add two
         columns to an eight-column table. */
      const pixels = new Map<string, number>();
      for (const found of SHELL.matchAll(
        new RegExp(`\\.v2 \\.d-id-leads\\.${table} th:nth-child\\((\\d+)\\)\\{ width:(\\d+)px; \\}`, 'g'),
      )) {
        if (!pixels.has(found[1] as string)) pixels.set(found[1] as string, Number(found[2]));
      }
      expect(shares.size + pixels.size, `${table}: most columns have a width`).toBeGreaterThan(6);

      /* At the owner's own 1,440px the card is 1,148px wide. */
      const card = 1148;
      const used = [...pixels.values()].reduce((a, b) => a + b, 0)
        + [...shares.values()].reduce((a, b) => a + (b / 100) * card, 0);
      const next = card - used;
      expect(next, `${table}: the next step gets ${Math.round(next)}px of ${card}`)
        .toBeGreaterThanOrEqual(NEED_NEXT);

      /*
       * The Lead is the first column on the agent's list and the second on
       * the owner's, after the tick box — and it is in PIXELS, because its
       * need is fixed. A share gave it 198px at 1280 (a cut name) and 249 at
       * 1440 (28px more than the longest name wants, off the next step).
       */
      const lead = pixels.get(table === 'v2-cols-book' ? '2' : '1') ?? 0;
      expect(lead, `${table}: the lead column is ${lead}px at every width`)
        .toBeGreaterThanOrEqual(NEED_NAME);
    }
  });

  it('keeps a phone number in pixels, because it is one length', () => {
    /* A share of the card gave it 136px at 1440 and "+971 50 1…" came out of
       the column an agent dictates from. 148 is the 129 it measured plus the
       padding. */
    expect(SHELL).toMatch(/\.v2 \.d-id-leads\.v2-cols-mine th:nth-child\(2\)\{ width:148px; \}/);
    expect(SHELL).toMatch(/\.v2 \.d-id-leads\.v2-cols-book th:nth-child\(3\)\{ width:148px; \}/);
  });

  it('trims the padding rather than the name', () => {
    /* Eight columns × two sides × 4px is 64px, which is the difference
       between a name that fits at 1280 and one that does not. */
    expect(SHELL).toMatch(/padding-left:8px; padding-right:8px;/);
  });

  it('asks for 52px rows, and takes the two things that made them 130', () => {
    /* §2.6: "Rows about 52 px high. 12 leads fit on one screen." */
    expect(SHELL).toMatch(/height:52px; padding-top:6px; padding-bottom:6px;/);
    /* The source line under every name, and the Given date on three lines. */
    expect(LEADS).not.toContain('v2-t-from');
    expect(SHELL).toContain('.v2 .d-id-leads td.v2-given-cell .v2-given-ago::before{ content:" · "; }');
  });

  it('drops the row buttons’ words before it drops the next step', () => {
    expect(LEADS).toMatch(/const TIGHT = \d+;/);
    expect(LEADS).toContain("{tight ? '' : 'Call'}");
    expect(LEADS).toContain("{tight ? '' : 'WhatsApp'}");
    /* The word is still there for a screen reader and on hover. */
    expect(LEADS).toContain('title="Call"');
    expect(LEADS).toContain('title="WhatsApp"');
  });

  it('puts the row buttons at the end of the row, not over the text', () => {
    /* §2.8. The design's own page CSS positions them absolutely with a
       shadow over whatever is beneath. */
    const ours = SHELL.slice(SHELL.indexOf('── The leads table FITS'));
    expect(ours).toContain('.d-row-actions');
    expect(ours).toContain('position:static; transform:none; background:transparent; box-shadow:none;');
    expect(LEADS).toContain('<td className="v2-t-acts">{actions}</td>');
  });

  it('shows "No phone" in words and no Call button', () => {
    /* §2.4's seventh point. A dash is a character somebody has to interpret. */
    expect(LEADS).toContain('<span className="v2-t-nophone">No phone</span>');
    expect(LEADS).toContain('{phone && !book && (');
  });

  it('puts no flex on a table cell', () => {
    /*
     * `display:flex` on a `<td>` stops the cell drawing the row's border —
     * the bottom border draws at the height of the content instead, so every
     * name gets a short line under it that stops before the next column.
     */
    const ours = rules(SHELL.slice(SHELL.indexOf('.v2 .p-my-leads .d-table-wrap')));
    /* The selector has to END at the cell: `td.x .y{display:flex}` is a flex
       span inside a cell, which is the right way round and what the row's
       buttons are. */
    expect(ours).not.toMatch(/td[\w.-]*\s*[,{][^}]*display:\s*flex/);
  });

  it('invents no colour: tokens only, and orange is var(--accent)', () => {
    const from = SHELL.indexOf('.v2 .v2-filt{');
    const ours = rules(SHELL.slice(from, SHELL.indexOf('.v2 .d-localtime .v2-t-moon', from)));
    expect(ours).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(ours).toContain('var(--accent)');
  });

  it('keeps the computer rules out of the phone media query', () => {
    /*
     * The bottom half of `v2-shell.css` is inside `@media (max-width:767px)`,
     * and three fixes written for the computer have already landed in there
     * and done nothing above 767px, in silence, with the suite green.
     */
    /* The first RULE after the block's heading, not the heading itself:
       slicing inside a comment leaves `rules()` an unbalanced opener. */
    const from = SHELL.indexOf('.v2 .v2-filt{');
    expect(from).toBeGreaterThan(0);
    /* Every media query in our own region is a computer width on purpose —
       the 1399px one that takes the words off the row buttons. */
    const ours = rules(SHELL.slice(from));
    for (const found of ours.matchAll(/@media ([^{]+)\{/g)) {
      expect(found[1], 'a computer-width media query, not the phone one').not.toContain('767px');
    }
    /* And nothing before it has left a block open that our rules fall into. */
    const before = rules(SHELL.slice(0, from));
    const between = before.slice(before.lastIndexOf('@media'));
    expect((between.match(/\{/g) ?? []).length, 'the last media query is closed before our rules')
      .toBe((between.match(/\}/g) ?? []).length);
  });
});

/* ── 7. the owner's book ───────────────────────────────────────────────── */

describe('the owner’s All leads', () => {
  it('has the seven tabs §3.5 lists, Won included', () => {
    const tabs = LEADS.slice(LEADS.indexOf('export const OWNER_TABS'), LEADS.indexOf('export type TabKey'));
    for (const key of ['all', 'cold', 'overdue', 'no_next_step', 'vip', 'lost', 'won']) {
      expect(tabs, key).toContain(`key: '${key}'`);
    }
  });

  it('says "Back to Incoming" on the selection bar, as §3.4 words it', () => {
    expect(LEADS).toContain('Back to Incoming');
    expect(LEADS).toContain('selected</b>');
    expect(LEADS).toContain('Move to agent');
  });

  it('shows the agent’s first name beside their face, as picture 02 draws it', () => {
    expect(LEADS).toContain("String(movedTo ?? row.owner_name).split(' ')[0]");
    /* And the whole name on hover, since the column is 96px wide. */
    expect(LEADS).toContain('<span className="d-person" title={(movedTo ?? row.owner_name) as string}>');
  });

  it('marks a lead with no agent as Incoming, in red', () => {
    /* §3's eighth point. */
    expect(LEADS).toContain('<span className="d-chip d-red d-pip">Incoming</span>');
  });
});
