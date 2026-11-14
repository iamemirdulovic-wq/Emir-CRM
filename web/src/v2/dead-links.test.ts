import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { v2Path } from './links.js';

/**
 * Every address a v2 screen links to is one the router knows.
 *
 * A link to a path with no route does not fail, throw or show a red line. It
 * opens "That page does not exist" — in the *old* shell, because the catch-all
 * route is the live CRM's — so the agent is thrown out of v2 and has to find
 * their way back. Nothing in the build says a word about it.
 *
 * That is exactly what `/v2/contacts/c-1` did: the search endpoint answers
 * with the live CRM's own paths and v2 wrote `/v2` in front of them, so every
 * lead in the search results and every notification about a lead was a dead
 * link. It was live for a fortnight with a green test suite. Emir found it by
 * clicking one.
 *
 * So, two halves, because the links come from two places:
 *
 *  1. **Written in a screen** — `to="/v2/leads"`. Read out of the source here
 *     and matched against the real route table.
 *  2. **Written by the server** — a notification's `link`, a search hit's
 *     `to`. Those arrive as data, so what is checked is the one function that
 *     moves them into v2 (`links.ts`) against the shapes the server really
 *     writes, read out of the server's own source so the two cannot drift.
 *
 * If this fails, the link is wrong or the route is missing. Never "fix" it by
 * adding the path to a list here.
 */

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WEB_SRC = path.join(HERE, '..');
const SERVER_SRC = path.join(HERE, '../../../server/src');

/* ── the route table ───────────────────────────────────────────────────── */

/**
 * Every `path` the app's `<Route>`s declare, minus the catch-all.
 *
 * `path="*"` is the "does not exist" screen. Counting it as a route would
 * make every address in the CRM "known" and this whole file worthless.
 */
function routes(): string[] {
  const source = readFileSync(path.join(WEB_SRC, 'App.tsx'), 'utf8');
  return [...source.matchAll(/<Route\s[^>]*path="([^"]+)"/g)]
    .map((m) => m[1] as string)
    .filter((one) => one !== '*');
}

/** Does the router know this address? `:id` matches exactly one segment. */
function known(table: string[], link: string): boolean {
  const want = link.split(/[?#]/)[0] as string;
  const asked = want.split('/').filter(Boolean);
  return table.some((route) => {
    const parts = route.split('/').filter(Boolean);
    if (parts.length !== asked.length) return false;
    return parts.every((part, i) => part.startsWith(':') || part === asked[i]);
  });
}

/* ── the links written into the screens ────────────────────────────────── */

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

/**
 * The addresses one file links to.
 *
 * `to="/v2/leads"`, `to={`/v2/leads/${id}`}` and `navigate('/v2/tasks')` are
 * the three shapes the screens use. An interpolation stands for one segment —
 * a lead's id — which is what the route's `:id` is there to match.
 */
export function linksIn(source: string): string[] {
  const found: string[] = [];
  const add = (raw: string): void => {
    const link = raw.replace(/\$\{[^}]*\}/g, 'x');
    /* Only addresses in this app. A mailto:, a tel: or an https:// is
       somebody else's to route. */
    if (link.startsWith('/') && !link.startsWith('//')) found.push(link);
  };

  for (const m of source.matchAll(/\bto=(?:"([^"]*)"|\{\s*`([^`]*)`\s*\}|\{\s*'([^']*)'\s*\})/g)) {
    add((m[1] ?? m[2] ?? m[3] ?? '').trim());
  }
  for (const m of source.matchAll(/\bnavigate\(\s*(?:`([^`]*)`|'([^']*)')/g)) {
    add((m[1] ?? m[2] ?? '').trim());
  }
  return found;
}

/* ── the links the server writes ───────────────────────────────────────── */

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts') && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

/**
 * Every address shape the server hands the front end.
 *
 * `link:` is a notification's; `to:` is a search hit's. An interpolated id
 * becomes one segment, the same way as above.
 */
export function serverLinksIn(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/\b(?:link|to):\s*(?:`([^`]*)`|'([^']*)')/g)) {
    const raw = (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, 'x');
    if (raw.startsWith('/') && !raw.startsWith('//')) out.push(raw);
  }
  /* `link: a ? '/x' : '/y'` — both arms, which is how `/my-leads` is written
     and how it was missed the first time this was looked at by eye. */
  for (const m of source.matchAll(/\blink:\s*[^,\n]*\?\s*[^:,\n]*:\s*'([^']*)'/g)) {
    const raw = (m[1] as string);
    if (raw.startsWith('/') && !raw.startsWith('//')) out.push(raw);
  }
  return out;
}

/* ── the checks ────────────────────────────────────────────────────────── */

describe('the addresses v2 links to', () => {
  const table = routes();

  it('reads the route table', () => {
    expect(table.length).toBeGreaterThan(40);
    expect(table).toContain('/v2/leads/:id');
  });

  it('knows a dead address when it sees one', () => {
    expect(known(table, '/v2/leads/o-7')).toBe(true);
    expect(known(table, '/v2/tasks?tab=follow-ups')).toBe(true);
    /* The one this file was written for. */
    expect(known(table, '/v2/contacts')).toBe(false);
    expect(known(table, '/v2/nowhere')).toBe(false);
  });

  it('finds the links in a screen', () => {
    expect(linksIn('<Link to="/v2/leads">x</Link>')).toEqual(['/v2/leads']);
    expect(linksIn('<Link to={`/v2/leads/${id}`}>x</Link>')).toEqual(['/v2/leads/x']);
    expect(linksIn("navigate('/v2/search?q=1')")).toEqual(['/v2/search?q=1']);
    expect(linksIn('<a href="https://homes.me">x</a>')).toEqual([]);
  });

  it.each(tsxFiles(path.join(WEB_SRC, 'v2')).map((f) => [path.relative(WEB_SRC, f), f]))(
    'are all routes the router knows, in %s',
    (name, file) => {
      const dead = [...new Set(linksIn(readFileSync(file as string, 'utf8')))]
        .filter((link) => !known(table, link));
      expect(
        dead.sort(),
        `${name as string} links to an address no <Route> matches, so it opens\n`
        + '"That page does not exist" in the old shell. Point it at the screen\n'
        + 'that shows the record, or add the route:\n',
      ).toEqual([]);
    },
  );
});

describe('the addresses the server hands v2', () => {
  const table = routes();
  const shapes = [...new Set(tsFiles(SERVER_SRC).flatMap((f) => serverLinksIn(readFileSync(f, 'utf8'))))];

  it('reads the server source', () => {
    expect(shapes.length).toBeGreaterThan(10);
    /* The two that matter: a notification about a lead, and a search hit. */
    expect(shapes).toContain('/contacts/x');
    expect(shapes).toContain('/contacts/x?lead=x');
  });

  it('moves a lead to its own page rather than to a contact page v2 has not got', () => {
    expect(v2Path('/contacts/c-1?lead=o-7')).toBe('/v2/leads/o-7');
    expect(v2Path('/contacts/c-1')).toBe('/v2/contacts/c-1');
    expect(v2Path('/my-leads')).toBe('/v2/leads');
    /* Already a v2 address: left alone, down to the query string. */
    expect(v2Path('/v2/leads?tab=new')).toBe('/v2/leads?tab=new');
    /* A screen whose name did not change keeps the prefix. */
    expect(v2Path('/incoming')).toBe('/v2/incoming');
    expect(v2Path(null)).toBe('/v2');
  });

  it.each(shapes.sort().map((one) => [one]))('land on a real screen: %s', (shape) => {
    const moved = v2Path(shape as string);
    expect(
      known(table, moved),
      `The server writes "${shape as string}". In v2 that becomes "${moved}",\n`
      + 'which no <Route> matches, so the notification or the search result\n'
      + 'opens "That page does not exist". Add the move to web/src/v2/links.ts:\n',
    ).toBe(true);
  });
});
