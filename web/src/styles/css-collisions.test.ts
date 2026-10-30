import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A class name must not be both a component and somebody else's modifier.
 *
 * This has bitten four times. `.note` was the hint under a form field *and*
 * the modifier on an internal-note message bubble, so every note in the inbox
 * was nudged twelve pixels down and its icon greyed. `.unread` was the badge
 * on a conversation row *and* the modifier on an unread bell notification, so
 * the notifications that mattered most rendered at eleven pixels bold. Neither
 * showed up in a type check, a test or a glance at the screen.
 *
 * The pattern is exact: a selector that is one class on its own and sets
 * layout, size or colour, where that same class also appears after another
 * class in a compound selector. That is a collision; everything else is
 * ordinary composition.
 */

const STYLES = path.join(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Whatever `index.css` actually imports, in that order — not a list written
 * here that drifts from it. `books.css` is parked and unimported today; the
 * day somebody turns Books on, this check starts reading it and says so.
 */
const FILES = [...readFileSync(path.join(STYLES, 'index.css'), 'utf8').matchAll(/@import\s+'\.\/([^']+)'/g)]
  .map((match) => match[1] as string);

/** Properties that actually show when they leak onto the wrong element. */
const VISIBLE = ['display', 'margin', 'padding', 'font-size', 'color', 'position', 'width', 'height', 'flex'];

/**
 * Compositions that are meant: both names are components and the markup says
 * `class="pill due"` on purpose. Anything new has to be added here
 * deliberately, which is the point.
 */
const ALLOWED = new Set(['pill']);

/**
 * The layout properties that decide what a component *is*. Two files setting
 * these differently for the same class name are two different components
 * wearing one name — which is how the pipeline stopped being a board.
 */
const LAYOUT = ['display', 'flex-direction', 'position', 'grid-template-columns'];

interface Scan {
  /** Class → the visible properties its own bare rule sets. */
  components: Map<string, Set<string>>;
  /** Class → the base classes it is used as a modifier on. */
  modifiers: Map<string, Set<string>>;
  /** Class → file → the layout declarations that file's bare rules set. */
  layout: Map<string, Map<string, Map<string, string>>>;
}

/**
 * Every rule in the sheet, with the nesting depth it was written at.
 *
 * Depth 0 is the base layer. Anything deeper is inside an `@media` or
 * `@supports` block, where saying `display:none` on a phone is the point of
 * the query rather than two components sharing a name.
 */
function rules(css: string): Array<{ selector: string; body: string; depth: number; at: number }> {
  const out: Array<{ selector: string; body: string; depth: number; at: number }> = [];
  let depth = 0;
  let selectorStart = 0;
  let index = 0;
  let seq = 0;

  while (index < css.length) {
    const char = css[index];
    if (char === '{') {
      const selector = css.slice(selectorStart, index).trim();
      if (selector.startsWith('@')) {
        depth += 1;
        index += 1;
        selectorStart = index;
        continue;
      }
      /* A declaration block: read to its matching close. */
      let cursor = index + 1;
      let inner = 1;
      while (cursor < css.length && inner > 0) {
        if (css[cursor] === '{') inner += 1;
        else if (css[cursor] === '}') inner -= 1;
        cursor += 1;
      }
      seq += 1;
      out.push({ selector, body: css.slice(index + 1, cursor - 1), depth, at: seq });
      index = cursor;
      selectorStart = index;
      continue;
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1);
      index += 1;
      selectorStart = index;
      continue;
    }
    index += 1;
  }

  return out;
}

function scan(): Scan {
  const components = new Map<string, Set<string>>();
  const modifiers = new Map<string, Set<string>>();
  const layout = new Map<string, Map<string, Map<string, string>>>();

  for (const name of FILES) {
    const css = readFileSync(path.join(STYLES, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    for (const rule of rules(css)) {
      if (!rule.selector.includes('.')) continue;

      const visible = rule.body
        .split(';')
        .map((declaration) => (declaration.split(':')[0] ?? '').trim())
        .filter((property) => VISIBLE.some((risky) => property === risky || property.startsWith(`${risky}-`)));

      for (const raw of rule.selector.split(',')) {
        const part = raw.trim();
        const classes = [...part.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1] as string);

        /* A component rule: the whole selector is exactly one class, with no
           descendant, no pseudo-element and no state. `.card .f` cannot leak
           onto a `.f` elsewhere, and `.x:hover` is still `.x`. */
        const bare = /^\.[A-Za-z0-9_-]+$/.test(part);
        if (bare && visible.length > 0) {
          const set = components.get(classes[0] as string) ?? new Set<string>();
          for (const property of visible) set.add(property);
          components.set(classes[0] as string, set);

          /* What the base layer says this component's layout is. */
          if (rule.depth === 0) {
            for (const declaration of rule.body.split(';')) {
              const [rawProperty, ...rest] = declaration.split(':');
              const property = (rawProperty ?? '').trim();
              if (!LAYOUT.includes(property)) continue;
              const perRule = layout.get(classes[0] as string) ?? new Map<string, Map<string, string>>();
              const where = `${name}:${rule.at}`;
              const declarations = perRule.get(where) ?? new Map<string, string>();
              declarations.set(property, rest.join(':').trim());
              perRule.set(where, declarations);
              layout.set(classes[0] as string, perRule);
            }
          }
        }

        if (classes.length > 1) {
          for (const unit of part.split(/[\s>+~]+/)) {
            const inUnit = [...unit.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1] as string);
            for (const modifier of inUnit.slice(1)) {
              const set = modifiers.get(modifier) ?? new Set<string>();
              set.add(inUnit[0] as string);
              modifiers.set(modifier, set);
            }
          }
        }
      }
    }
  }

  return { components, modifiers, layout };
}

describe('CSS class collisions', () => {
  const { components, modifiers, layout } = scan();

  it('read the stylesheets index.css actually imports', () => {
    expect(FILES).toContain('components.css');
    expect(FILES).toContain('kit.css');
    expect(components.size).toBeGreaterThan(100);
    expect(modifiers.size).toBeGreaterThan(10);
  });

  it('no component name is also somebody else’s modifier', () => {
    const collisions: string[] = [];
    for (const [name, bases] of modifiers) {
      if (!components.has(name) || ALLOWED.has(name)) continue;
      collisions.push(
        `.${name} is a component (sets ${[...(components.get(name) as Set<string>)].join(', ')}) `
        + `and a modifier on ${[...bases].map((base) => `.${base}`).join(', ')}`,
      );
    }

    expect(
      collisions,
      `Rename one of them, or add it to ALLOWED if the composition is meant:\n${collisions.join('\n')}`,
    ).toEqual([]);
  });

  it('the two that already bit are fixed and stay fixed', () => {
    /* The hint under a field is `.hint`; `note` is only ever a modifier. */
    expect(components.has('note')).toBe(false);
    expect(modifiers.has('note')).toBe(true);
    /* The conversation badge is `.thread-unread`; `unread` is only a modifier. */
    expect(components.has('unread')).toBe(false);
    expect(modifiers.has('unread')).toBe(true);
  });

  it('no two rules give the same class name a different layout', () => {
    /*
     * `.board` was the pipeline's kanban in one file and the Team Wall's
     * leaderboard in another. The second said `flex-direction: column`, loads
     * later, and stacked every stage of the pipeline on top of the next — the
     * board had not been a board since.
     */
    const clashes: string[] = [];
    for (const [name, perFile] of layout) {
      if (perFile.size < 2) continue;
      const properties = new Set([...perFile.values()].flatMap((map) => [...map.keys()]));
      for (const property of properties) {
        const values = new Set(
          [...perFile.values()].map((map) => map.get(property)).filter((value): value is string => Boolean(value)),
        );
        if (values.size > 1) {
          clashes.push(
            `.${name} has ${property}: ${[...values].join(' and ')} — in ${[...perFile.keys()].join(' and ')}`,
          );
        }
      }
    }

    expect(clashes, `Two components are sharing a name:\n${clashes.join('\n')}`).toEqual([]);
  });

  it('the board is the pipeline’s alone', () => {
    const perFile = layout.get('board');
    expect(perFile?.size ?? 0).toBeLessThanOrEqual(1);
    expect(components.has('leaderboard')).toBe(true);
  });

  it('every name in the allowlist is still a real collision worth allowing', () => {
    for (const name of ALLOWED) {
      expect(components.has(name), `.${name} is in ALLOWED but is no longer a component`).toBe(true);
      expect(modifiers.has(name), `.${name} is in ALLOWED but is no longer a modifier`).toBe(true);
    }
  });
});
