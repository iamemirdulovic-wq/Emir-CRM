import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { barIsHiddenAt, tilesFrom, type Tile } from './phone.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), 'utf8');

/**
 * The phone shell.
 *
 * Three of these read the source rather than trusting it, in the house style
 * of `hook-order.test.ts` and `design-classes.test.ts`. They exist because the
 * thing they check is invisible when it breaks: a stylesheet rule that escapes
 * its media query changes every computer screen in the company and no test
 * that renders a phone would ever see it.
 */

describe('the four full-attention screens', () => {
  /*
   * `docs/v2/phone-shell.md` §1.2: "The four screens with no bottom bar are
   * full-attention modes: Login, Dialer, Chat, Email. Treat no bar as the
   * signal that the user is in a single task they should finish or explicitly
   * leave."
   */
  it('hides the bar on the dialler and on email', () => {
    expect(barIsHiddenAt('/v2/calling')).toBe(true);
    expect(barIsHiddenAt('/v2/email')).toBe(true);
  });

  it('keeps it everywhere else', () => {
    for (const route of [
      '/v2', '/v2/leads', '/v2/leads/o-1', '/v2/tasks', '/v2/calendar',
      '/v2/more', '/v2/inbox', '/v2/attendance', '/v2/settings',
    ]) {
      expect(barIsHiddenAt(route), `${route} should keep the bar`).toBe(false);
    }
  });

  it('is not fooled by a route that merely starts the same way', () => {
    /* A screen called "callings" or "emails" would otherwise lose its bar. */
    expect(barIsHiddenAt('/v2/callings')).toBe(false);
    expect(barIsHiddenAt('/v2/emailed')).toBe(false);
  });

  it('a chat and the sign-in page are not routes, so the shell asks them', () => {
    /*
     * The other two of the four are a state rather than an address: a chat is
     * a thread open inside the inbox, and sign-in is outside this shell
     * entirely. The inbox is what declares itself.
     */
    expect(read('Inbox.tsx')).toMatch(/useFullAttention\(openId !== null\)/);
  });
});

describe('nothing in the phone stylesheet escapes the phone', () => {
  /*
   * The owner's words: "Do not change the computer layout (768 px and wider)."
   * Every rule in `v2-phone.css` has to be inside its media query. A rule that
   * slips outside would land on every computer screen in the company, and the
   * only way anyone would find out is by looking at all of them.
   */
  const css = read('../styles/v2-phone.css');

  it('has every rule inside @media (max-width: 767px)', () => {
    /* Strip comments, then the one allowed outside: the keyframes, which
       style nothing on their own, and the reduce-motion block, which only
       switches the phone's own animations off. */
    let rest = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const at of ['@media (max-width: 767px)', '@media (prefers-reduced-motion: reduce)']) {
      let from = rest.indexOf(at);
      while (from !== -1) {
        let depth = 0;
        let i = rest.indexOf('{', from);
        const open = i;
        for (; i < rest.length; i += 1) {
          if (rest[i] === '{') depth += 1;
          else if (rest[i] === '}') { depth -= 1; if (depth === 0) break; }
        }
        rest = rest.slice(0, from) + rest.slice(i + 1);
        void open;
        from = rest.indexOf(at);
      }
    }
    rest = rest.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');

    const stray = rest.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    expect(stray, `these lines are outside the phone's media query:\n${stray.join('\n')}`)
      .toEqual([]);
  });

  it('turns dialogs and panels into sheets, with a handle', () => {
    expect(css).toMatch(/\.v2\.v2-phone \.d-dialog[\s\S]{0,400}bottom: 0/);
    expect(css).toMatch(/border-radius: 28px 28px 0 0/);
    /* §1.5: a 44 x 5px grab handle as the first child. */
    expect(css).toMatch(/width: 44px; height: 5px/);
  });

  it('leaves the scroller clear of the floating bar, and only then', () => {
    /* §1.1: "The 108px bottom padding on the scroller is what keeps content
       clear of the floating bar. Nothing else does." And with no bar it is
       wasted screen, so it is tied to the class the shell sets. */
    expect(css).toMatch(/padding-bottom: calc\(108px/);
    expect(css).toMatch(/\.v2\.v2-phone:not\(\.v2-has-bar\) \.v2-page/);
  });

  it('writes every rule with enough weight to beat a page style', () => {
    /*
     * The ported page styles are `.v2 .p-calendar .d-cal-layout` — three
     * classes. A phone rule written `.v2-phone .d-cal-layout` is two, so it
     * loses, and the calendar grid computes to 26 pixels wide at 390px with
     * nothing in the code looking wrong. The audit found exactly that on the
     * calendar. So every selector here carries `.v2.v2-phone`, which ties at
     * three and wins on source order because this file loads last.
     */
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const weak = [];
    for (const line of body.split('\n')) {
      const sel = line.trim();
      if (!sel.startsWith('.')) continue;
      for (const one of sel.replace(/[,{].*$/, '').split(',')) {
        const part = one.trim();
        if (part.length === 0) continue;
        if (!part.startsWith('.v2.v2-phone')) weak.push(part);
      }
    }
    expect(weak, `these would lose to a page style:\n${weak.join('\n')}`).toEqual([]);
  });

  it('gives a thumb 44px', () => {
    /* The owner's number, and Apple's. */
    expect(css).toMatch(/min-height: 44px/);
  });
});

describe('the shell reads its own state', () => {
  const shell = read('Shell.tsx');

  it('only draws the bar when the screen is not a single task', () => {
    expect(shell).toMatch(/!oneJob && !barIsHiddenAt\(pathname\) && <PhoneBar \/>/);
  });

  it('marks the page so the stylesheet knows whether a bar is there', () => {
    expect(shell).toMatch(/'v2-has-bar'/);
  });

  it('replays the rise-in on every screen, not only the first', () => {
    /* CSS plays an animation once per element, and React keeps elements
       across a route change often enough that the second screen would appear
       with no movement — which reads as a page that failed to load. */
    expect(shell).toMatch(/key=\{isPhone \? run : 'wide'\}/);
  });
});

describe('the More screen holds every tool once', () => {
  const tile = (to: string, label: string): Tile => ({ to, label, icon: 'circle' });

  it('drops a tool that two menus both offer', () => {
    const out = tilesFrom(
      [{ label: 'Leads', items: [tile('/v2/leads', 'My leads')] }],
      [tile('/v2/settings', 'Settings')],
      [tile('/v2/leads', 'My leads'), tile('/v2/card', 'My business card')],
      [tile('/v2/inbox', 'Inbox')],
    );
    const all = out.flatMap((b) => b.items.map((i) => i.to));
    expect(all.filter((x) => x === '/v2/leads')).toHaveLength(1);
    expect(all).toContain('/v2/card');
  });

  it('leaves out a block that ends up empty', () => {
    const out = tilesFrom([{ label: 'Leads', items: [] }], [], [], []);
    expect(out).toEqual([]);
  });

  it('keeps the menu order, then messages, then the rest', () => {
    const out = tilesFrom(
      [{ label: 'Leads', items: [tile('/a', 'A')] }],
      [tile('/b', 'B')],
      [],
      [tile('/c', 'C')],
    );
    expect(out.map((b) => b.label)).toEqual(['Leads', 'Messages', 'Everything else']);
  });
});
