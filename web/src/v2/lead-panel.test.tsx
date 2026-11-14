import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadPanel } from './LeadPanel.js';
import type { Row } from './Leads.js';
import type { CallActions } from './call.js';

/**
 * The leads quick panel — §4 of the owner's fix list, 14 Nov 2026.
 *
 * It renders the real component in jsdom against stubbed endpoints, so what
 * is asserted is what an agent reads and presses rather than the shape of a
 * props object.
 *
 * §4.9 is the reason this file exists at all. The list's selection lives in
 * `Leads.tsx`, so the panel can only say which way the reader went — and a
 * keyboard handler is exactly the kind of thing that looks right in the code
 * and answers nothing on the screen. Three things have to hold: up and down
 * move, they do **not** close the panel, and they are left alone inside the
 * note box, where up and down move the caret and taking them over would throw
 * away a half-written note.
 *
 * The microphone is not asserted here: jsdom has no `MediaRecorder`, so
 * `canRecord()` is false and the button is correctly not drawn. It is checked
 * in a real browser instead — `docs/v2/proof/quick-panel-*.png`.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(HERE, 'LeadPanel.tsx'), 'utf8');
/** The same file with its prose removed — a word in a comment is not code. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROW: Row = {
  id: 'o-1',
  contact_id: 'c-1',
  full_name: 'Marco Bellini',
  phone_e164: '+971501234567',
  project_name: 'Emaar Beachfront',
  unit_type: '2 Bedroom',
  budget_min_aed: 1_500_000,
  budget_max_aed: 2_000_000,
  budget_band: null,
  source: 'meta_lead_ads',
  stage_key: 'engaged_qualified',
  status: 'open',
  is_vip: 0,
  returned_at: null,
  next_step_at: '2026-11-14T12:00:00.000Z',
  next_step_note: 'Send the payment plan',
  last_contact_at: '2026-11-14T05:00:00.000Z',
  assigned_at: '2026-11-12T07:00:00.000Z',
  owner_name: 'Layla Hassan',
};

const NOTES = [
  {
    id: 'n-1',
    body: 'Said 1.9M is the real ceiling, not the 2.5M on the form.',
    author_name: 'Layla Hassan',
    created_at: '2026-11-14T05:10:00.000Z',
  },
  {
    id: 'n-2',
    body: 'Worried about the 2027 handover slipping.',
    author_name: 'Layla Hassan',
    created_at: '2026-11-14T04:10:00.000Z',
  },
  {
    id: 'n-3',
    body: 'Walked through the payment plan on the phone.',
    author_name: 'Rocky',
    created_at: '2026-11-13T09:10:00.000Z',
  },
  {
    id: 'n-4',
    body: 'The oldest note of the four, which must not be drawn.',
    author_name: 'Rocky',
    created_at: '2026-11-10T09:10:00.000Z',
  },
];

let container: HTMLDivElement;
let root: Root;
let asked: string[] = [];
/** What each stubbed endpoint answers with, so a test can bend one of them. */
let lead: Record<string, unknown>;
let briefLines: string[];
let notes: typeof NOTES;

const dial = {
  call: vi.fn(async () => null),
  whatsapp: vi.fn(async () => null),
  banner: null,
  error: null,
} as unknown as CallActions;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  asked = [];
  lead = { ...ROW, email: null, language: 'en', preferred_location: null };
  briefLines = [
    'Investor, second property in Dubai.',
    'Wants a sea view and will not go below the 20th floor.',
    'A third line the panel must not draw: the owner asked for two.',
  ];
  notes = NOTES;

  /* 14 Nov 2026, 10:00 in Dubai. "Today" and "Yesterday" are worked out
     against the moment they are called, and a test that drifts with the
     calendar is one that fails one morning for no reason. */
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T06:00:00.000Z'));

  vi.stubGlobal('fetch', async (pathname: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? 'GET'} ${pathname}`);
    const body = pathname.endsWith('/brief')
      ? { notes: { lines: briefLines, watchOut: null, at: null, stale: false }, advice: null }
      : pathname.startsWith('/api/notes/')
        ? { items: notes, files: [] }
        : { lead, activities: [], tasks: [] };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response;
  });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function show(props: Partial<Parameters<typeof LeadPanel>[0]> = {}) {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <LeadPanel
          row={ROW}
          book={false}
          onClose={() => undefined}
          onGive={() => undefined}
          dial={dial}
          {...props}
        />
      </MemoryRouter>,
    );
  });
  /* The three reads land on the next tick. */
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

function press(key: string, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function text(): string {
  return container.textContent ?? '';
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')]
    .find((one) => (one.textContent ?? '').trim() === label);
}

describe('the leads quick panel', () => {
  it('reads the lead, its brief and its notes, and nothing else', async () => {
    await show();
    expect(asked).toEqual([
      'GET /api/my-leads/o-1',
      'GET /api/my-leads/o-1/brief',
      'GET /api/notes/c-1',
    ]);
  });

  /* §4.1 */
  it('heads it with the name, the phone, the stage and their own clock', async () => {
    await show();
    expect(text()).toContain('Marco Bellini');
    expect(container.querySelector('.d-phone-xl')?.textContent).toContain('+971 50 123 4567');
    expect(text()).toContain('Interested');
    expect(container.querySelector('.d-localtime')?.textContent).toMatch(/UAE \d\d:\d\d/);
    expect(text()).toContain('Open full page');
    expect(container.querySelector('button[aria-label="Close"]')).not.toBeNull();
  });

  /* §4.2 */
  it('offers all five ways to work the lead', async () => {
    await show();
    for (const label of ['Call', 'WhatsApp', 'Telegram', 'Follow-up', 'Meeting']) {
      expect(text(), `${label} is missing from the panel`).toContain(label);
    }
  });

  it('rings and messages through the one helper, so the tap is recorded', async () => {
    await show();
    act(() => { container.querySelector<HTMLAnchorElement>('a.d-primary')?.click(); });
    expect(dial.call).toHaveBeenCalledWith(ROW);

    act(() => { button('WhatsApp')?.click(); });
    expect(dial.whatsapp).toHaveBeenCalledWith(ROW);

    act(() => { button('Telegram')?.click(); });
    expect(dial.whatsapp).toHaveBeenCalledWith(ROW, { app: 'telegram' });
  });

  /* §4.3 */
  it('puts Done and Change on the next step, and Add one when there is none', async () => {
    await show();
    expect(text()).toContain('Next step');
    expect(button('Done')).toBeDefined();
    expect(button('Change')).toBeDefined();
    expect(button('Add one')).toBeUndefined();

    /* A different lead, not the same one re-read: the panel keys its three
       reads off `row.id`, which is the whole point of them. */
    lead = {
      ...lead, id: 'o-2', contact_id: 'c-2', next_step_at: null, next_step_note: null,
    };
    await show({ row: { ...ROW, id: 'o-2', contact_id: 'c-2', next_step_at: null, next_step_note: null } });
    expect(text()).toContain('No next step');
    expect(button('Add one')).toBeDefined();
    expect(button('Done')).toBeUndefined();
  });

  /* §4.4 */
  it('shows two lines of In short, under the Homes AI badge', async () => {
    await show();
    const short = container.querySelector('.v2-qp-short');
    expect(short?.textContent).toContain('Homes AI');
    expect(short?.querySelectorAll('p')).toHaveLength(2);
    expect(short?.textContent).not.toContain('the owner asked for two');
  });

  it('wears no Homes AI badge for a sentence the AI did not write', async () => {
    briefLines = [];
    await show();
    const short = container.querySelector('.v2-qp-short');
    expect(short?.textContent).not.toContain('Homes AI');
    /* The record's own facts instead of an empty card. */
    expect(short?.textContent).toContain('Emaar Beachfront');
  });

  /* §4.5 */
  it('has a note box that is already open, named after the lead', async () => {
    await show();
    const box = container.querySelector<HTMLTextAreaElement>('.v2-qp-note textarea');
    expect(box).not.toBeNull();
    expect(box?.placeholder).toBe('Write a note about Marco…');
    expect(button('Save')).toBeDefined();
    /* Nothing written yet, so there is nothing to save. */
    expect(button('Save')?.disabled).toBe(true);
  });

  /* §4.6 */
  it('shows the last three notes, newest first, with who and when', async () => {
    await show();
    const rows = [...container.querySelectorAll('.v2-qp-note-row')];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Layla Hassan');
    expect(rows[0]?.textContent).toContain('1.9M is the real ceiling');
    expect(rows[0]?.textContent).toMatch(/Today \d\d:\d\d/);
    expect(rows[2]?.textContent).toMatch(/Yesterday \d\d:\d\d/);
    expect(text()).not.toContain('must not be drawn');
  });

  it('says so plainly when there are no notes', async () => {
    notes = [];
    await show();
    expect(text()).toContain('No notes yet. Write the first one after your call.');
  });

  /* §4.7 */
  it('lists project, unit, budget and language — and never a code', async () => {
    await show();
    const lines = [...container.querySelectorAll('.d-kv-row')]
      .map((one) => (one.textContent ?? '').trim());
    expect(lines.some((one) => one.startsWith('Project') && one.includes('Emaar Beachfront'))).toBe(true);
    expect(lines.some((one) => one.startsWith('Unit') && one.includes('2 Bedroom'))).toBe(true);
    expect(lines.some((one) => one.startsWith('Budget') && one.includes('AED 1.5M–2M'))).toBe(true);
    expect(lines.some((one) => one === 'LanguageEnglish')).toBe(true);
    expect(lines).not.toContain('Languageen');
  });

  /* §4.8 */
  it('ends with Transfer, Won and Lost', async () => {
    await show();
    const foot = container.querySelector('.d-panel-foot');
    expect(foot?.textContent).toContain('Transfer');
    expect(foot?.textContent).toContain('Won');
    expect(foot?.textContent).toContain('Lost');
  });

  it('offers neither Won nor Lost on a lead that is already closed', async () => {
    lead = { ...lead, status: 'won' };
    await show({ row: { ...ROW, status: 'won' } });
    expect(button('Won')?.disabled).toBe(true);
    expect(button('Lost')?.disabled).toBe(true);
    /* And nothing is owed on a closed lead, so neither is Done. */
    expect(button('Done')).toBeUndefined();
  });
});

/* ── §4.9 · the arrow keys ─────────────────────────────────────────────── */

describe('the arrow keys walk the list', () => {
  it('moves down on ArrowDown and up on ArrowUp, without closing the panel', async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onClose = vi.fn();
    await show({ onPrev, onNext, onClose });

    press('ArrowDown');
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).not.toHaveBeenCalled();

    press('ArrowUp');
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves the arrows alone inside the note box', async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    await show({ onPrev, onNext });

    const box = container.querySelector('.v2-qp-note textarea');
    expect(box).not.toBeNull();
    press('ArrowDown', box as EventTarget);
    press('ArrowUp', box as EventTarget);
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
  });

  it('does nothing at all when the list has not wired them up', async () => {
    const onClose = vi.fn();
    await show({ onClose });
    expect(() => press('ArrowDown')).not.toThrow();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes on Escape', async () => {
    const onClose = vi.fn();
    await show({ onClose });
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives the keys up to a dialog opened over it', async () => {
    const onNext = vi.fn();
    const onClose = vi.fn();
    await show({ onNext, onClose });

    await act(async () => { button('Won')?.click(); });
    expect(container.querySelector('.d-dialog')).not.toBeNull();

    /* Walking to the next lead under a half-filled Won form would file it
       against somebody else. */
    press('ArrowDown');
    expect(onNext).not.toHaveBeenCalled();

    /* And Escape shuts the dialog, not the panel behind it. */
    press('Escape');
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('.d-dialog')).toBeNull();

    press('ArrowDown');
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('takes focus when it opens, so the keys are the panel’s', async () => {
    await show();
    expect(document.activeElement).toBe(container.querySelector('aside.d-panel'));
  });
});

/* ── What the source itself has to say ─────────────────────────────────── */

describe('the panel’s source', () => {
  it('reaches the phone only through the call helper', () => {
    for (const match of CODE.matchAll(/tel:|wa\.me\//g)) {
      const around = CODE.slice(Math.max(0, match.index - 400), match.index + 400);
      expect(
        around,
        `a ${match[0]} hand-off that does not go through dial.call / dial.whatsapp`,
      ).toMatch(/dial\.(call|whatsapp)/);
    }
  });

  it('writes its notes through the one notes endpoint', () => {
    expect(CODE).toContain('/api/notes/');
  });

  it('keeps its own classes out of the design’s namespace', () => {
    /* Every class this file invents is `v2-qp-`; a bare `d-` name it made up
       would style nothing, which `design-classes.test.ts` catches, and a bare
       common word would collide, which `css-collisions.test.ts` catches. */
    const classNames = [...CODE.matchAll(/className=(?:"([^"]*)"|\{'([^']*)'|\{`([^`]*)`)/g)]
      .map((one) => one[1] ?? one[2] ?? one[3] ?? '')
      .join(' ');
    /* The ternaries too, which `className={a ? 'x' : 'y'}` hides from the
       pattern above. */
    const ternaries = [...CODE.matchAll(/'([^'/]*v2-[^'/]*)'/g)]
      .map((one) => one[1] as string)
      .filter((one) => !one.includes('.css'));
    const everyWord = `${classNames} ${ternaries.join(' ')}`;
    const invented = [...everyWord.matchAll(/\bv2-[a-z0-9-]+/g)].map((one) => one[0]);
    expect(invented.length).toBeGreaterThan(5);
    for (const name of invented) expect(name.startsWith('v2-qp-')).toBe(true);
  });
});
