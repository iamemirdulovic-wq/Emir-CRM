import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HomesAiOrb, openHomesAi, pageName, showHomesAiStatus,
  type HomesAiBrain, type HomesAiView,
} from './HomesAiOrb.js';

/**
 * The Homes AI orb and its panel.
 *
 * Half of these render it and half read the source, in the house style of
 * `phone.test.ts` and `design-classes.test.ts`, because the things most
 * likely to go wrong here are invisible when they break:
 *
 *  - a class name in the markup that no rule in the stylesheet matches, which
 *    looks right in the code and draws nothing;
 *  - a keyframe that animates `width` or `filter` instead of `transform`,
 *    which costs a repaint per frame on the exact phones this has to be
 *    smooth on and looks identical on a laptop;
 *  - a rule that escapes its media query, which is how three fixes written
 *    for the computer landed inside `@media (max-width:767px)` in
 *    `v2-shell.css` and did nothing, in silence, with a green suite.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), 'utf8');
const CSS = read('../styles/v2-homes-ai.css');
const TSX = read('./HomesAiOrb.tsx');

/* ── Rendering ───────────────────────────────────────────────────────────── */

let host: HTMLDivElement;
let root: Root;

function show(at: string, props: Parameters<typeof HomesAiOrb>[0] = {}) {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[at]}>
        {/* The shell puts the orb inside `.v2`; every rule is scoped to it. */}
        <div className="v2"><HomesAiOrb {...props} /></div>
      </MemoryRouter>,
    );
  });
}

/**
 * The orb, wherever it is.
 *
 * On the four full-attention phone screens it is not inside the host element
 * at all — it is portalled into that screen's own header — so a lookup scoped
 * to `host` would say the orb had vanished.
 */
const orb = () => document.querySelector('button.v2-ai-orb') as HTMLButtonElement;
const panel = () => host.querySelector('[role="dialog"]');
const field = () => host.querySelector('textarea.v2-ai-field') as HTMLTextAreaElement;
const text = () => host.textContent ?? '';

/**
 * Type into the field the way React notices.
 *
 * Setting `.value` and firing an `input` event is not enough: React keeps its
 * own value tracker on the node, sees no change and never calls `onChange`,
 * so the field stays empty, the Send button stays disabled and the test
 * passes or fails for the wrong reason. The native setter is what moves the
 * tracker too.
 */
function type_(what: string) {
  const node = field();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(node, what);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function press(key: string, mods: { ctrlKey?: boolean; metaKey?: boolean } = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ...mods, bubbles: true }));
  });
}

/** jsdom has no `matchMedia`; this says how wide the screen is. */
function screen(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone && query.includes('max-width'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  window.sessionStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  act(() => { root = createRoot(host); });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('the orb', () => {
  it('is there on every screen, and says what it is', () => {
    for (const at of ['/v2', '/v2/leads', '/v2/calling', '/v2/offers', '/v2/settings/team']) {
      show(at);
      expect(orb(), `no orb on ${at}`).toBeTruthy();
      expect(orb().getAttribute('aria-label')).toBe('Homes AI');
    }
  });

  it('knows which page it was opened from', () => {
    show('/v2/leads');
    act(() => orb().click());
    /* `nav.ts` calls it "My leads" for an agent, and this is what the person
       reads in the panel's head — the promise made visible. */
    expect(text()).toContain('This screen: My leads');
  });

  it('opens on a tap and closes again, flowing back into the orb', () => {
    show('/v2/leads');
    expect(panel()).toBeNull();

    act(() => orb().click());
    expect(panel()).toBeTruthy();
    expect(panel()?.className).toContain('v2-ai-panel-in');
    expect(orb().getAttribute('aria-expanded')).toBe('true');

    act(() => orb().click());
    /* Still mounted, playing the closing move — 220ms, as the CSS says. */
    expect(panel()?.className).toContain('v2-ai-panel-out');
    act(() => { vi.advanceTimersByTime(260); });
    expect(panel()).toBeNull();
  });

  it('opens on Ctrl+J and ⌘J, and closes on Escape', () => {
    show('/v2');
    press('j', { ctrlKey: true });
    expect(panel()).toBeTruthy();

    press('Escape');
    act(() => { vi.advanceTimersByTime(260); });
    expect(panel()).toBeNull();

    press('J', { metaKey: true });
    expect(panel()).toBeTruthy();
  });

  it('opens when something else asks it to', () => {
    show('/v2/tasks');
    act(() => openHomesAi());
    expect(panel()).toBeTruthy();
  });

  it('pulses when it has something to say, and stops once it is open', () => {
    show('/v2');
    act(() => showHomesAiStatus('speaking'));
    expect(orb().className).toContain('v2-ai-orb-say');
    expect(orb().getAttribute('aria-label')).toBe('Homes AI has something to say');

    /* A ring pulsing for attention while you are looking straight at it is
       noise, so opening it takes the pulse away. */
    act(() => orb().click());
    expect(orb().className).not.toContain('v2-ai-orb-say');
  });

  it('turns green for a second when a job is done', () => {
    show('/v2');
    act(() => showHomesAiStatus('done'));
    expect(orb().className).toContain('v2-ai-orb-done');
  });
});

describe('a phone screen with no bottom bar', () => {
  /*
   * The dialler, a chat and email hide the floating bar because they are one
   * job each. Two placements were tried for the orb on them and both were
   * wrong in a screenshot: the corner the bar would have used is where **Next
   * lead** is, and halfway down the right edge is on top of the lead's own
   * details while somebody is on a call.
   *
   * So on those the orb is not floating at all — it is a child of that
   * screen's own header, which means the header's flex row makes room for it
   * and nothing is covered. This renders one of those headers and checks the
   * orb moves into it.
   */
  afterEach(() => vi.unstubAllGlobals());

  it('puts the orb inside the screen’s own header', () => {
    screen(true);
    const header = document.createElement('div');
    header.className = 'd-ib-head';
    document.body.append(header);
    try {
      show('/v2/inbox');
      expect(orb(), 'no orb at all').toBeTruthy();
      expect(
        header.querySelector('button.v2-ai-orb'),
        'the orb is still floating — it should be in the header',
      ).toBeTruthy();
      /* The dock stays behind to hold the panel, and says it is docked. */
      expect(host.querySelector('.v2-ai-dock-docked')).toBeTruthy();
      /* And it still opens. */
      act(() => orb().click());
      expect(panel()).toBeTruthy();
    } finally {
      header.remove();
    }
  });

  it('keeps floating when the screen has no header to dock into', () => {
    screen(true);
    show('/v2/leads');
    expect(orb()).toBeTruthy();
    expect(host.querySelector('.v2-ai-dock-docked')).toBeNull();
    expect(host.querySelector('button.v2-ai-orb'), 'it should be in the dock').toBeTruthy();
  });
});

describe('the dialler', () => {
  /*
   * The one screen with no orb on it at all. Three placements were tried and
   * each cost that screen something — the reasons are written out in full
   * above `NO_ORB` in `HomesAiOrb.tsx`, because the thing most likely to
   * happen in six months is somebody putting it back without knowing what it
   * cost. Homes AI is in the ☰ sheet instead.
   */
  afterEach(() => vi.unstubAllGlobals());

  /** The dialler as the orb sees it: its root, and its ☰ sheet. */
  function dialler(sheetOpen: boolean) {
    const root = document.createElement('div');
    root.className = 'v2-a-dial p-calling';
    root.innerHTML = '<div class="v2-a-dial-top"><button class="v2-a-dial-list"></button></div>';
    if (sheetOpen) {
      root.insertAdjacentHTML('beforeend', '<div class="d-dialog d-open">'
        + '<div class="d-dialog-head"><button aria-label="Close"></button></div>'
        + '<div class="d-dialog-foot"><button class="d-btn d-primary">End session</button></div>'
        + '</div>');
    }
    document.body.append(root);
    return root;
  }

  it('shows no orb at all, floating or docked', () => {
    screen(true);
    const root = dialler(false);
    try {
      show('/v2/calling');
      expect(orb(), 'there must be no orb on the dialler').toBeNull();
      /* Not even docked into its header, which is the placement that cost
         that screen 25px and clipped the client's project name. */
      expect(root.querySelector('button.v2-ai-orb')).toBeNull();
    } finally {
      root.remove();
    }
  });

  it('puts "Ask Homes AI" in the ☰ sheet, and opening it works', () => {
    screen(true);
    const root = dialler(true);
    try {
      show('/v2/calling');
      const item = root.querySelector('.d-dialog-foot .v2-ai-menu') as HTMLButtonElement | null;
      expect(item, 'no Ask Homes AI in the sheet').toBeTruthy();
      expect(item?.textContent).toContain('Ask Homes AI');

      /* It shuts the sheet on the way through, by pressing the sheet's own
         close button — the sheet's state belongs to `Calling.tsx`. */
      let closed = 0;
      root.querySelector('[aria-label="Close"]')?.addEventListener('click', () => { closed += 1; });

      act(() => item?.click());
      expect(closed, 'the sheet was left open behind the panel').toBe(1);
      expect(panel(), 'the panel did not open').toBeTruthy();
    } finally {
      root.remove();
    }
  });

  it('rides above the dialler, which is an opaque layer at z-index 130', () => {
    /*
     * Found in a screenshot after the fact: with the dock at its usual 78 the
     * panel opened *underneath* the dialler and nothing appeared at all —
     * `phone-light-calling-panel-open.png` was a dialler with no panel on it,
     * and `elementFromPoint` in the middle of where the panel should have
     * been returned the dialler's own check-in banner.
     */
    screen(true);
    const root = dialler(false);
    try {
      show('/v2/calling');
      expect(host.querySelector('.v2-ai-dock-over'), 'the panel would open under the dialler')
        .toBeTruthy();
    } finally {
      root.remove();
    }
    const phone = CSS.slice(CSS.indexOf('@media (max-width: 767px)'));
    const over = phone.match(/\.v2\.v2-phone \.v2-ai-dock-over \{([^}]*)\}/)?.[1] ?? '';
    expect(Number(over.match(/z-index:\s*(\d+)/)?.[1] ?? 0)).toBeGreaterThan(130);
  });
});

describe('the stand-in, until the brain lands', () => {
  it('calls no API', () => {
    /* The brain is being built in `server/` by other hands. This file must
       not reach for it: a shell that fetches is a shell that breaks when the
       endpoint shape changes under it. */
    expect(TSX).not.toContain('api.get');
    expect(TSX).not.toContain('api.post');
    expect(TSX).not.toContain('fetch(');
  });

  it('works, answers, and never makes a number up', () => {
    show('/v2/leads');
    act(() => orb().click());

    /* Deliberately not one of the suggested questions, so that finding it on
       the screen means the turn was added and not that a chip says it. */
    type_('What happened here yesterday?');
    act(() => {
      (host.querySelector('button.v2-ai-send') as HTMLButtonElement).click();
    });

    /* Mine is on the page and the orb is working — not a spinner anywhere. */
    expect(host.querySelector('.v2-ai-turn-me')?.textContent).toBe('What happened here yesterday?');
    expect(orb().className).toContain('v2-ai-orb-work');
    expect(host.querySelectorAll('.v2-ai-wave')).toHaveLength(3);

    act(() => { vi.advanceTimersByTime(900); });
    const answer = host.querySelector('.v2-ai-turn-ai')?.textContent ?? '';
    expect(answer).toContain('My leads');
    expect(answer.toLowerCase()).toContain('still being built');
    /*
     * The one thing a placeholder must never do. CLAUDE.md: never invent
     * prices, counts or dates — a plausible mocked answer is how a stand-in
     * gets quoted back as fact.
     */
    expect(answer, 'the stand-in must not contain a number').not.toMatch(/\d/);

    /* Then green for a second, then breathing again. */
    expect(orb().className).toContain('v2-ai-orb-done');
    act(() => { vi.advanceTimersByTime(1100); });
    expect(orb().className).not.toContain('v2-ai-orb-done');
    expect(orb().className).not.toContain('v2-ai-orb-work');
  });

  it('suggests questions that fit the page, and nothing that is an answer', () => {
    show('/v2/pipeline');
    act(() => orb().click());
    const hints = [...host.querySelectorAll('.v2-ai-hint')].map((one) => one.textContent ?? '');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints).toContain('What is stuck here?');
    for (const hint of hints) {
      expect(hint, 'a suggestion is a question, not a figure').not.toMatch(/\d/);
    }
  });
});

describe('a brain of its own', () => {
  const view: HomesAiView = {
    status: 'working',
    greeting: 'Morning.',
    turns: [
      { id: 'a', who: 'me', body: 'How is Raj doing?' },
      { id: 'b', who: 'ai', body: 'Here is what I found.', tools: ['agent stats'] },
      { id: 'c', who: 'ai', body: 'That one failed.', failed: true },
    ],
    hints: [{ id: 'h', label: 'Try this', ask: 'the real question' }],
    prompt: 'Ask away…',
    footnote: 'Reads your CRM only.',
  };

  it('draws what it is handed, and asks with the page it was asked from', () => {
    const asked: { q: string; page: string; path: string }[] = [];
    const brain: HomesAiBrain = {
      view: { ...view, turns: [], status: 'idle' },
      ask: (q, place) => asked.push({ q, page: place.page, path: place.path }),
    };

    show('/v2/projects', { brain, startOpen: true });
    expect(text()).toContain('Morning.');

    act(() => { (host.querySelector('.v2-ai-hint') as HTMLButtonElement).click(); });
    expect(asked).toEqual([{ q: 'the real question', page: 'Projects', path: '/v2/projects' }]);
  });

  it('shows its turns, the tools behind an answer and a failure as a failure', () => {
    show('/v2', { brain: { view, ask: () => {} }, startOpen: true });
    expect(host.querySelectorAll('.v2-ai-turn')).toHaveLength(3);
    expect(host.querySelector('.v2-ai-turn-me')?.textContent).toBe('How is Raj doing?');
    expect(text()).toContain('Read agent stats');
    expect(host.querySelector('.v2-ai-turn-bad')?.textContent).toBe('That one failed.');
    /* Its status drives the orb, and the waves are drawn rather than a spinner. */
    expect(orb().className).toContain('v2-ai-orb-work');
    expect(host.querySelectorAll('.v2-ai-wave')).toHaveLength(3);
  });

  it('offers a stop only when the brain can be stopped', () => {
    show('/v2', { brain: { view, ask: () => {} }, startOpen: true });
    expect(host.querySelector('[aria-label="Stop"]')).toBeNull();

    let stopped = 0;
    show('/v2', { brain: { view, ask: () => {}, stop: () => { stopped += 1; } }, startOpen: true });
    act(() => { (host.querySelector('[aria-label="Stop"]') as HTMLButtonElement).click(); });
    expect(stopped).toBe(1);
  });
});

describe('the page it is on', () => {
  it('reads the name out of the menu, longest match first', () => {
    expect(pageName('/v2/leads', 'agent')).toBe('My leads');
    expect(pageName('/v2/leads', 'owner')).toBe('All leads');
    expect(pageName('/v2/leads/o-7', 'agent')).toBe('My leads');
    expect(pageName('/v2/settings/team', 'owner')).toBe('Team and roles');
    expect(pageName('/v2', 'agent')).toBe('My Day');
  });

  it('does not report an unknown screen as the dashboard', () => {
    /* `/v2` is the prefix of every route, so a careless `startsWith` makes
       every unnamed screen the dashboard. */
    expect(pageName('/v2/not-a-screen', 'agent')).toBe('Not a screen');
  });
});

/* ── The stylesheet, read rather than trusted ────────────────────────────── */

describe('v2-homes-ai.css', () => {
  it('is imported by the component that uses it', () => {
    /* A stylesheet imported nowhere styles nothing, in silence. It is
       imported here rather than from `index.css` on purpose — see the head of
       the file. */
    expect(TSX).toContain("import '../styles/v2-homes-ai.css'");
  });

  it('defines every class the markup uses', () => {
    const defined = new Set([...CSS.matchAll(/\.(v2-ai-[a-z0-9-]+)/g)].map((m) => m[1] as string));
    const used = new Set<string>();
    for (const match of TSX.matchAll(/'(v2-ai-[a-z0-9- ]+)'/g)) {
      for (const name of (match[1] as string).trim().split(/\s+/)) used.add(name);
    }
    for (const match of TSX.matchAll(/className="([^"]*)"/g)) {
      for (const name of (match[1] as string).split(/\s+/)) {
        if (name.startsWith('v2-ai-')) used.add(name);
      }
    }
    expect(used.size, 'the scan found no classes, so it is checking nothing').toBeGreaterThan(12);
    const missing = [...used].filter((name) => !defined.has(name)).sort();
    expect(missing, `these classes style nothing:\n${missing.join('\n')}`).toEqual([]);
  });

  it('takes no class name that already belongs to another screen', () => {
    /*
     * The one `css-collisions.test.ts` cannot catch here, because that check
     * only reads the stylesheets `index.css` imports and this one is imported
     * by its component.
     *
     * The panel's footer was `v2-ai-foot` — which is already the AI settings
     * screen's, in `v2-shell.css`, as `.v2 .p-ai-settings .v2-ai-foot`. A
     * two-class rule here (`.v2 .v2-ai-foot`) reaches that element on that
     * page and would have put a border, a background and a flex column on a
     * card nobody had touched. It is `v2-ai-compose` now.
     */
    /* Comments out first — the note above `v2-ai-compose` names the class it
       had to stop being, and a scan that counts it fails for ever. */
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const mine = new Set([...rules.matchAll(/\.(v2-ai-[a-z0-9-]+)/g)].map((m) => m[1] as string));
    expect(mine.size).toBeGreaterThan(20);

    const elsewhere = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(css|tsx?)$/.test(entry.name)) continue;
        if (full.endsWith('v2-homes-ai.css') || full.endsWith('HomesAiOrb.tsx')
          || full.endsWith('homes-ai-orb.test.tsx')) continue;
        for (const hit of readFileSync(full, 'utf8').matchAll(/v2-ai-[a-z0-9-]+/g)) {
          elsewhere.add(hit[0]);
        }
      }
    };
    walk(path.join(HERE, '..'));

    const taken = [...mine].filter((name) => elsewhere.has(name)).sort();
    expect(
      taken,
      `these names already belong to another screen — rename them:\n${taken.join('\n')}`,
    ).toEqual([]);
  });

  it('borrows only `d-` classes the design really defines', () => {
    /*
     * `design-classes.test.ts` fails on a `d-` class that is in no design
     * stylesheet, because it styles nothing while looking right in the code.
     * The orb is ours end to end and borrows exactly one: the ☰ menu item is
     * `d-btn` on purpose, so it is the dialler sheet's own button at the
     * sheet's own size rather than a lookalike.
     */
    const design = readFileSync(path.join(HERE, '..', 'styles', 'v2-ui.css'), 'utf8');
    const used = new Set<string>();
    for (const match of TSX.matchAll(/className="([^"]*)"/g)) {
      for (const name of (match[1] as string).split(/\s+/)) {
        if (name.startsWith('d-')) used.add(name);
      }
    }
    expect([...used]).toEqual(['d-btn']);
    for (const name of used) expect(design, `.${name} is in no design stylesheet`).toContain(`.${name}`);
  });

  it('scopes every rule under .v2, so no name can collide', () => {
    /*
     * `css-collisions.test.ts`: a bare class that sets layout and is also
     * somebody's modifier is what broke the pipeline board. Nothing here is a
     * bare class at all.
     */
    const stray: string[] = [];
    /* Comments first: a `{` inside one would read as a rule. */
    const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of bare.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
      for (const part of (match[2] as string).split(',')) {
        const selector = part.trim();
        if (selector.length === 0 || selector.startsWith('from') || selector.startsWith('to')
          || /^\d+%/.test(selector)) continue;
        /* `[dir="rtl"]` and `:root[data-glass="off"]` are scopes of their own
           and still carry `.v2` after them. */
        const scoped = selector.replace(/^(\[dir="rtl"\]|:root(\[[^\]]+\])?)\s+/, '');
        if (!scoped.startsWith('.v2')) stray.push(selector);
      }
    }
    expect(stray, `these are not scoped to .v2:\n${stray.join('\n')}`).toEqual([]);
  });

  it('animates only transform and opacity, which is what 60fps costs', () => {
    /*
     * The one rule that keeps this smooth on a mid-range Android: everything
     * that moves is composited. A keyframe that touches `filter`, `width`,
     * `top` or a shadow forces a paint — or worse, a layout — on every frame,
     * and on a laptop it looks exactly the same.
     */
    const bad: string[] = [];
    for (const block of CSS.matchAll(/@keyframes\s+([a-z0-9-]+)\s*\{([\s\S]*?)\n\}/g)) {
      const name = block[1] as string;
      for (const declaration of (block[2] as string).matchAll(/([a-z-]+)\s*:/g)) {
        const property = declaration[1] as string;
        if (property !== 'transform' && property !== 'opacity') bad.push(`${name}: ${property}`);
      }
    }
    expect(bad, `these keyframes animate something expensive:\n${bad.join('\n')}`).toEqual([]);
  });

  it('keeps the orb clear of the phone’s bottom bar, in the other corner', () => {
    /*
     * `v2-dialler.css` carries Emir's rule in full: "Nothing may cover the
     * bottom bar: Back, Skip, Next lead." The bar runs the full width of the
     * screen, so the orb rides a bar's height above it — and on the LEFT,
     * because the dial button is on the bar's right end and two orange
     * circles in one corner read as a mistake (Emir, 15 Nov).
     */
    const phone = CSS.slice(CSS.indexOf('@media (max-width: 767px)'));
    const dock = phone.match(/\.v2\.v2-phone \.v2-ai-dock\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(dock, 'no phone rule on the dock').not.toBe('');
    expect(dock, 'the dial button’s corner is the right one').toContain('right: auto');
    expect(dock).toMatch(/left:\s*var\(--bar-gap\)/);

    const lift = phone.match(/\.v2\.v2-phone\.v2-has-bar \.v2-ai-dock\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(lift, 'no has-bar rule on the dock').not.toBe('');
    expect(lift).toContain('var(--bar-h)');
    expect(lift).toContain('var(--safe-b)');
  });

  it('does not float at all on a full-attention screen', () => {
    /*
     * Two wrong answers before this one, both found in a screenshot and
     * neither visible in the code.
     *
     * First the orb went into the corner the hidden bar would have used, and
     * at 390px it landed on **Next lead** — the row `v2-dialler.css` says in
     * capital letters that nothing may cover. Then it floated half way down
     * the right edge, over the lead's own details. Emir, 15 Nov: *"on those
     * four full-attention screens it should not float at all."*
     *
     * So there is no floating placement for them any more: the orb is a child
     * of the screen's own header, and the dock keeps nothing but the panel.
     */
    const phone = CSS.slice(CSS.indexOf('@media (max-width: 767px)'));
    expect(
      phone.match(/\.v2\.v2-phone:not\(\.v2-has-bar\) \.v2-ai-dock\s*\{/),
      'a floating placement for the no-bar screens is back',
    ).toBeNull();

    const docked = phone.match(/\.v2\.v2-phone \.v2-ai-dock-docked\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(docked, 'no rule for the docked state').not.toBe('');
    expect(docked, 'the dock must stop being a corner').toContain('bottom: auto');

    /* And the panel hangs under the header it is docked in, measured. */
    const panel = phone.match(/\.v2\.v2-phone \.v2-ai-dock-docked \.v2-ai-panel\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(panel).toContain('var(--v2-ai-dock-y');
  });

  it('docks into headers that exist, and the orb sizes itself for them', () => {
    /*
     * The dock hosts are three other screens' class names. If one of them is
     * renamed, the orb quietly stops appearing on that screen — "never
     * hidden" broken in silence, which is exactly the kind of thing
     * `design-classes.test.ts` exists to catch for `d-` classes. So each one
     * is checked against the source that renders it.
     */
    const hosts: [string, string][] = [
      ['.d-ib-head', 'Inbox.tsx'],
      ['.v2-ptop-row', 'Shell.tsx'],
    ];
    const named = TSX.match(/const DOCK_HOSTS = \[([^\]]*)\]/)?.[1] ?? '';
    expect(named, 'DOCK_HOSTS is gone').not.toBe('');
    for (const [selector, file] of hosts) {
      expect(named, `${selector} is not in DOCK_HOSTS`).toContain(selector);
      expect(
        read(`./${file}`),
        `${file} no longer renders ${selector} — the orb would vanish from that screen`,
      ).toContain(selector.slice(1));
    }

    /* The dialler's two: the screen it stays off, and the sheet it lives in. */
    const calling = read('./Calling.tsx');
    expect(TSX).toContain("const NO_ORB = '.v2-a-dial'");
    expect(calling, 'the dialler no longer renders .v2-a-dial').toContain('v2-a-dial');
    expect(TSX).toContain("const MENU_HOST = '.v2-a-dial .d-dialog-foot'");
    expect(calling, 'the ☰ sheet no longer has a foot to add the item to')
      .toContain('d-dialog-foot');
    /* The item closes that sheet by pressing its own close button. */
    expect(calling, 'the sheet’s close button has been renamed — the item would leave it open')
      .toContain('aria-label="Close"');

    /*
     * `--v2-ai-size` is declared on the dock, and a declaration on the element
     * beats one inherited from an ancestor however many classes that
     * ancestor's selector carries. The phone override was written on
     * `.v2.v2-phone` once, changed nothing, and the orb measured 58px on a
     * phone while the stylesheet said 52. The docked orb is outside the dock
     * altogether, so it has to carry its own.
     */
    for (const selector of ['.v2.v2-phone .v2-ai-dock', '.v2.v2-phone .v2-ai-docked']) {
      const at = CSS.indexOf(`${selector} {`);
      expect(at, `${selector} is not in the stylesheet`).toBeGreaterThan(-1);
      const body = CSS.slice(at).match(/\{([^}]*)\}/)?.[1] ?? '';
      expect(body, `${selector} must set --v2-ai-size on the element itself`)
        .toContain('--v2-ai-size');
    }
  });

  it('steps aside on a computer when a control is under it', () => {
    /*
     * Emir, 15 Nov, on the leads table: *"Content is fine to overlap; a
     * control is not."* No single inset fixes it — measured over twelve
     * screens at 1440×900, the bottom-right corner is already clear on five
     * and what it takes to be clear runs from 22px to 280px — so it is
     * measured per screen and the dock is shifted by a variable.
     */
    expect(CSS).toMatch(/right:\s*calc\(22px \+ var\(--v2-ai-dodge, 0px\)\)/);
    expect(TSX).toContain('--v2-ai-dodge');
    expect(TSX, 'the dodge must stop somewhere short of the middle of the screen')
      .toMatch(/const DODGE_CAP = \d+/);
  });

  it('never lets the glow cross the edge of the screen', () => {
    /*
     * `e2e/polish.mjs` fails a screen when any element's box crosses the
     * right edge, and it skips only `position:fixed` elements — the glow is
     * absolute inside the fixed dock, so it counts. At its first size it hung
     * 23px past a 58px orb: 1px over the edge on a computer and 9px over on a
     * phone, on every one of the 48 screens at once.
     *
     * The sum below is the one that matters, done here so that changing
     * either number re-does it: the halo's reach must be less than the gap
     * the dock keeps from the edge. The wide part of the bloom is a
     * box-shadow, which paints outside the box without being in it.
     */
    const inset = Number(CSS.match(/\.v2 \.v2-ai-glow \{[^}]*inset:\s*-(\d+)%/)?.[1] ?? 0) / 100;
    expect(inset, 'no inset on the glow').toBeGreaterThan(0);
    /* The breath scales the glow, and `getBoundingClientRect` counts the
       transform, so the peak of the breath is the widest it ever is. */
    const bloom = CSS.match(/@keyframes v2-ai-bloom \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const peak = Math.max(1, ...[...bloom.matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1])));
    expect(peak, 'no peak on the bloom').toBeGreaterThan(1);
    /* Half the orb, grown by the glow and then by the breath, less half the
       orb again: how far past the button's edge the glow's box reaches. */
    const reach = ((1 + inset * 2) * peak - 1) / 2;

    const barGap = Number(
      read('../styles/v2-tokens.css').match(/--bar-gap:\s*(\d+)px/)?.[1] ?? 0,
    );
    const size = (selector: string) => Number(
      CSS.slice(CSS.indexOf(`${selector} {`)).match(/--v2-ai-size:\s*(\d+)px/)?.[1] ?? 0,
    );

    const cases: [string, number, number][] = [
      /* The computer's right-hand gutter, and the phone's left-hand one. */
      ['computer', size('.v2 .v2-ai-dock'), 22],
      ['phone', size('.v2.v2-phone .v2-ai-dock'), barGap],
      /*
       * Docked, the orb is inside a header row, and the narrowest of the
       * three starts 16px from the edge of the screen (`.v2-ptop-row`, which
       * the shell draws with a 16px gutter).
       */
      ['docked in a header', size('.v2.v2-phone .v2-ai-docked'), 16],
    ];
    for (const [where, orbSize, inset] of cases) {
      expect(orbSize, `${where}: no orb size`).toBeGreaterThan(0);
      expect(inset, `${where}: no inset`).toBeGreaterThan(0);
      expect(orbSize * reach, `${where}: the glow hangs off the edge`).toBeLessThan(inset);
    }
  });

  it('sits under the dialogs it must not cover, and over the dim it must', () => {
    /*
     * The numbers are the design's own: `.d-scrim` 70, `.d-panel` 80,
     * `.d-dialog` 90, `.d-cmdk` 95, `.d-menu` 100. The orb glows over a
     * dimmed page and never over something the person opened on purpose.
     */
    const z = Number(CSS.match(/\.v2 \.v2-ai-dock \{[^}]*z-index:\s*(\d+)/)?.[1] ?? 0);
    expect(z).toBeGreaterThan(70);
    expect(z).toBeLessThan(90);
  });

  it('has a way out of the heavy version for a slow phone and for less motion', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(CSS).toContain('v2-ai-lite');
    /* The "Reduce glass effect" setting puts `data-glass="off"` on <html>. */
    expect(CSS).toContain(':root[data-glass="off"]');
  });

  it('names a keyframe for every animation it starts', () => {
    const known = new Set([...CSS.matchAll(/@keyframes\s+([a-z0-9-]+)/g)].map((m) => m[1] as string));
    const used = new Set<string>();
    for (const match of CSS.matchAll(/animation(?:-name)?:\s*([^;}]+)/g)) {
      for (const word of (match[1] as string).split(/[\s,]+/)) {
        if (word.startsWith('v2-ai-')) used.add(word);
      }
    }
    const missing = [...used].filter((name) => !known.has(name));
    expect(missing, `these animations name no keyframe:\n${missing.join('\n')}`).toEqual([]);
    expect(used.size).toBeGreaterThan(5);
  });
});

describe('the shell mounts it', () => {
  it('once, outside the page, so no screen can forget it', () => {
    const shell = read('./Shell.tsx');
    expect(shell).toContain("import { HomesAiOrb } from './HomesAiOrb.js'");
    expect(shell.match(/<HomesAiOrb \/>/g) ?? []).toHaveLength(1);
    /* Inside `.v2` — every rule in the stylesheet is scoped to it — and after
       the phone bar, which is the element it has to stay clear of. */
    expect(shell.indexOf('<HomesAiOrb />')).toBeGreaterThan(shell.indexOf('<PhoneBar />'));
  });
});
