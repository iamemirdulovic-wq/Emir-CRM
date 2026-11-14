import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadHandover, type AttemptOutcome, type HandoverStep } from './LeadHandover.js';
import { when } from './Transfers.js';

/**
 * "Who has had this lead" — the owner's two dates.
 *
 * Emir, 14 Nov 2026, hours after the single "Given out" date shipped:
 *
 * > "Exact date when leads coming from admin and owner, always need to show
 * > date, and if we have another agents like transfer leads date it's need to
 * > also showing like on the leads page, this leads transfer from this agent
 * > with the date, mean 2 dates."
 *
 * These render the real component in jsdom against a stubbed endpoint, so
 * what is asserted is the words an agent reads rather than the shape of a
 * props object. The clock is frozen: `given()` works out "yesterday" against
 * the moment it is called, and a test that drifts with the calendar is a test
 * that fails one morning for no reason.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(HERE, 'LeadHandover.tsx'), 'utf8');
/** The same file with its prose removed — a name in a comment is not a call. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let container: HTMLDivElement;
let root: Root;
/** Every request the block made, so "it asks for the one thing" can be shown. */
let asked: string[] = [];
/** What the stubbed endpoint answers with. */
let answer: { items: HandoverStep[] } = { items: [] };
let fails = false;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  asked = [];
  answer = { items: [] };
  fails = false;

  /*
   * Only Date is faked. The block's loading is promise-based, so faking the
   * timers as well would be a way to hang `act` for nothing.
   *
   * 14 Nov 2026, 10:00 in Dubai.
   */
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T06:00:00.000Z'));

  vi.stubGlobal('fetch', async (pathname: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? 'GET'} ${pathname}`);
    if (fails) {
      return {
        ok: false,
        status: 403,
        text: async () => JSON.stringify({
          error: { code: 'bad_request', message: 'That lead is not yours to work.' },
        }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(answer),
    } as unknown as Response;
  });
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(tree: ReactNode): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(tree);
  });
}

const block = async (): Promise<void> => mount(<LeadHandover leadId="o-1" />);
const text = (): string => (container.textContent ?? '').replace(/\s+/g, ' ');

/** A hand-over with everything blank but what the test cares about. */
function step(over: Partial<HandoverStep> & { id: string; at: string }): HandoverStep {
  return {
    kind: 'handover', toName: null, fromName: null, by: 'unknown', byName: null,
    reason: null, note: null, outcome: null, decidedAt: null, ...over,
  };
}

/** A transfer request that did not move the lead. */
function attempt(
  over: Partial<HandoverStep> & { id: string; at: string; outcome: AttemptOutcome },
): HandoverStep {
  return step({ kind: 'attempt', by: 'person', ...over });
}

/* ── 1. one hand-out, one line ────────────────────────────────────────── */

describe('a lead handed out once', () => {
  it('shows one line: who gave it out, to whom, and when', async () => {
    answer = {
      items: [step({
        id: 'a1',
        at: '2026-11-12T06:05:00.000Z',
        toName: 'Talha Khan',
        by: 'person',
        byName: 'Emir Dulovic',
      })],
    };
    await block();

    expect(asked).toEqual(['GET /api/my-leads/o-1/handover']);
    expect(text()).toContain('Given out by Emir Dulovic to Talha Khan');
    /* 06:05 UTC is 10:05 in Dubai, two days back from the frozen clock. */
    expect(text()).toContain('12 Nov 10:05');
    expect(rows()).toHaveLength(1);
  });

  it('never says "transferred" when nothing has moved', async () => {
    answer = {
      items: [step({
        id: 'a1', at: '2026-11-12T06:05:00.000Z', toName: 'Talha Khan',
        by: 'person', byName: 'Emir Dulovic',
      })],
    };
    await block();
    expect(text()).not.toContain('Transferred');
  });
});

/** One element per hand-over, which is what "three lines" means on screen. */
const rows = (): Element[] => [...container.querySelectorAll('.v2-leadhand-row')];

/* ── 2. two moves, three lines, oldest first ──────────────────────────── */

describe('a lead transferred twice', () => {
  beforeEach(() => {
    answer = {
      items: [
        step({
          id: 'a1', at: '2026-11-10T06:00:00.000Z', toName: 'Talha Khan',
          by: 'person', byName: 'Emir Dulovic',
        }),
        step({
          id: 'a2', at: '2026-11-12T07:15:00.000Z', toName: 'Raj Mehta',
          fromName: 'Talha Khan', by: 'person', byName: 'Talha Khan', reason: 'too_many',
        }),
        step({
          id: 'a3', at: '2026-11-13T12:30:00.000Z', toName: 'Sara Ali',
          fromName: 'Raj Mehta', by: 'person', byName: 'Raj Mehta', reason: 'knows_project',
        }),
      ],
    };
  });

  it('shows three lines', async () => {
    await block();
    expect(rows()).toHaveLength(3);
  });

  it('puts them oldest first, which is the order it happened in', async () => {
    await block();
    const said = text();
    const first = said.indexOf('Given out by Emir Dulovic');
    const second = said.indexOf('Transferred from Talha Khan to Raj Mehta');
    const third = said.indexOf('Transferred from Raj Mehta to Sara Ali');
    expect(first, 'the first hand-out is on the page').toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('carries a date on every one of the three', async () => {
    await block();
    /* 10 Nov 10:00 Dubai, 12 Nov 11:15 Dubai, 13 Nov 16:30 Dubai. */
    expect(text()).toContain('10 Nov 10:00');
    expect(text()).toContain('12 Nov 11:15');
    expect(text()).toContain('Yesterday 16:30');
  });

  it('says the reason in plain English, never the stored key', async () => {
    await block();
    expect(text()).toContain('Too many leads');
    expect(text()).toContain('Knows the project better');
    expect(text(), 'the ENUM values are keys, not wording').not.toContain('too_many');
    expect(text()).not.toContain('knows_project');
  });

  it('does not repeat the sending agent as the person who moved it', async () => {
    /*
     * On an agent-to-agent transfer the giver *is* the agent it came from, so
     * "Transferred from Talha to Raj · Moved by Talha" would say it twice.
     */
    await block();
    expect(text()).not.toContain('Moved by Talha Khan');
  });

  it('names the third person when an owner moved it, since that is not the sender', async () => {
    answer = {
      items: [
        step({
          id: 'a1', at: '2026-11-10T06:00:00.000Z', toName: 'Talha Khan',
          by: 'person', byName: 'Emir Dulovic',
        }),
        step({
          id: 'a2', at: '2026-11-12T07:15:00.000Z', toName: 'Raj Mehta',
          fromName: 'Talha Khan', by: 'person', byName: 'Emir Dulovic',
        }),
      ],
    };
    await block();
    expect(text()).toContain('Transferred from Talha Khan to Raj Mehta');
    expect(text()).toContain('Moved by Emir Dulovic');
  });
});

/* ── 3. the CRM is not a person ───────────────────────────────────────── */

describe('a lead the CRM assigned by itself', () => {
  it('says the CRM did it and names nobody', async () => {
    /*
     * `lead_assignments.assigned_by_user_id` is NULL on every assignment
     * Workflow A made, which is the normal case. Naming a person there would
     * be an invention, and the rule is flat: never invent a name.
     */
    answer = {
      items: [step({
        id: 'a1', at: '2026-11-14T05:30:00.000Z', toName: 'Talha Khan', by: 'crm',
      })],
    };
    await block();
    expect(text()).toContain('Given out by the CRM to Talha Khan');
    expect(text()).not.toContain('Given out by Emir');
    expect(text()).not.toContain('undefined');
    expect(text()).not.toContain('null');
  });

  it('says only the date when this CRM recorded no giver at all', async () => {
    /*
     * The bulk-assign screen, "share equally", a claim from the pool and a
     * straight move all change the owner without writing a `lead_assignments`
     * row. The date is on the lead, so it is said; nobody is named, and it is
     * not blamed on the CRM either.
     */
    answer = {
      items: [step({
        id: 'now:o-1', at: '2026-11-14T05:30:00.000Z', toName: 'Talha Khan', by: 'unknown',
      })],
    };
    await block();
    expect(text()).toContain('Given out to Talha Khan');
    expect(text()).not.toContain('by the CRM');
    expect(text()).toContain('09:30');
  });
});

/* ── 4. Dubai, and a 24-hour clock ────────────────────────────────────── */

describe('the dates', () => {
  it('are Dubai, not UTC', async () => {
    /* 20:45 UTC on the 13th is 00:45 on the **14th** in Dubai, so this one
       instant proves both the zone and the day it lands in. */
    answer = {
      items: [step({ id: 'a1', at: '2026-11-13T20:45:00.000Z', toName: 'Talha Khan', by: 'crm' })],
    };
    await block();
    expect(text(), 'today in Dubai: the time alone, like the leads list')
      .toContain('00:45');
    expect(text(), 'not 13 Nov, and not 20:45').not.toContain('20:45');
    expect(text()).not.toContain('13 Nov');
  });

  it('are 24-hour', async () => {
    answer = {
      items: [step({ id: 'a1', at: '2026-11-12T13:40:00.000Z', toName: 'Talha Khan', by: 'crm' })],
    };
    await block();
    /* 17:40 Dubai. `en-AE` is 12-hour unless told otherwise, which is the
       mistake `format.ts` exists to have fixed once. */
    expect(text()).toContain('17:40');
    expect(text()).not.toMatch(/PM|pm|05:40/);
  });

  it('puts the whole date, with its weekday, on the hover', async () => {
    answer = {
      items: [step({ id: 'a1', at: '2026-11-12T13:40:00.000Z', toName: 'Talha Khan', by: 'crm' })],
    };
    await block();
    const when = container.querySelector('.v2-leadhand-when');
    expect(when?.getAttribute('title')).toContain('12 Nov 2026');
    expect(when?.getAttribute('title')).toContain('17:40');
  });

  it('reads the date through `given`, not the lead page’s own local clock', async () => {
    /*
     * `Lead.tsx` has a `moment()` helper that formats in the *browser's*
     * timezone — it buckets the day at +04:00 but prints the clock local. On
     * a laptop outside Dubai it is four hours out. This block must use
     * `lib/assigned.ts`, which passes `timeZone: 'Asia/Dubai'` explicitly.
     */
    expect(CODE).toContain("from '../lib/assigned.js'");
    expect(CODE).toContain('given(step.at)');
    expect(CODE, 'no second date formatter in here').not.toMatch(/toLocale(Date|Time)String/);
  });
});

/* ── 4b. transfers that did not happen ────────────────────────────────── */

describe('a transfer that did not happen', () => {
  /*
   * Emir, 14 Nov, looking at a real lead: *"show every transfer, also
   * cancelled and refused ones, with from, to, date, time and reason. Today a
   * cancelled transfer (Test Agents to Tej, 13 Nov) does not show on the
   * lead."* A refused request is the record of an agent turning a lead down
   * and a cancelled one of a manager pulling it back. Neither moved the lead;
   * both are history.
   */
  const cancelled = (): HandoverStep => attempt({
    id: 't:1',
    at: '2026-11-13T06:05:00.000Z',
    outcome: 'cancelled',
    fromName: 'Test Agents',
    toName: 'Tej Singh',
    byName: 'Test Agents',
    reason: 'too_many',
    decidedAt: '2026-11-13T12:20:00.000Z',
  });

  it('shows the cancelled one, with from, to, date, time and reason', async () => {
    answer = { items: [cancelled()] };
    await block();
    expect(text()).toContain('Transfer from Test Agents to Tej Singh');
    expect(text(), 'the outcome, in plain English').toContain('cancelled');
    expect(text(), 'the reason, in plain English').toContain('Too many leads');
    /* 06:05 UTC is 10:05 in Dubai, on the 13th — yesterday, against the
       frozen clock, which is how the rest of the product words it. */
    expect(text()).toContain('Yesterday 10:05');
    expect(container.querySelector('.v2-leadhand-when')?.getAttribute('title'))
      .toContain('13 Nov 2026');
  });

  it('never shows the stored status code', async () => {
    answer = {
      items: [
        cancelled(),
        attempt({
          id: 't:2', at: '2026-11-13T07:00:00.000Z', outcome: 'needs_approval',
          fromName: 'Talha Khan', toName: 'Raj Mehta', reason: 'language',
        }),
      ],
    };
    await block();
    /* Emir's first rule: never a raw code. `needs_approval` is a column
       value, not a sentence. */
    expect(text()).not.toContain('needs_approval');
    expect(text()).toContain('waiting for the owner');
  });

  it('reads as not-completed: a noun, not the past tense, and greyed', async () => {
    answer = { items: [cancelled()] };
    await block();
    /* "Transferred from" means it moved. "Transfer from" does not. */
    expect(text()).not.toContain('Transferred from');
    const row = container.querySelector('.v2-leadhand-row');
    expect(row?.className).toContain('v2-leadhand-off');
    expect(container.querySelector('.v2-leadhand-out')?.textContent).toBe('cancelled');
  });

  it('does not grey a transfer that did happen', async () => {
    answer = {
      items: [step({
        id: 'a2', at: '2026-11-13T06:05:00.000Z', toName: 'Raj Mehta',
        fromName: 'Talha Khan', by: 'person', byName: 'Talha Khan', reason: 'knows_project',
      })],
    };
    await block();
    expect(text()).toContain('Transferred from Talha Khan to Raj Mehta');
    expect(container.querySelector('.v2-leadhand-row')?.className)
      .not.toContain('v2-leadhand-off');
  });

  it('names who is being waited on, so nobody has to go and look it up', async () => {
    answer = {
      items: [attempt({
        id: 't:3', at: '2026-11-13T06:05:00.000Z', outcome: 'pending',
        fromName: 'Talha Khan', toName: 'Raj Mehta', reason: 'leave',
      })],
    };
    await block();
    expect(text()).toContain('waiting for Raj Mehta');
  });

  it('says only "refused", because two different people can refuse', async () => {
    /*
     * The agent it was offered to and the owner whose approval a Meeting or
     * Offer lead needs both store `refused`, and `lead_transfers` keeps no
     * record of which. Naming one would be a guess.
     */
    answer = {
      items: [attempt({
        id: 't:4', at: '2026-11-13T06:05:00.000Z', outcome: 'refused',
        fromName: 'Talha Khan', toName: 'Raj Mehta', reason: 'client_asked',
      })],
    };
    await block();
    expect(text()).toContain('refused');
    expect(text()).not.toMatch(/refused by/);
  });

  it('puts when it ended on the hover, not as a second date on the line', async () => {
    answer = { items: [cancelled()] };
    await block();
    const title = container.querySelector('.v2-leadhand-when')?.getAttribute('title') ?? '';
    expect(title).toContain('Asked');
    expect(title).toContain('13 Nov 2026, 10:05');
    expect(title, 'cancelled at 12:20 UTC, which is 16:20 in Dubai')
      .toContain('Cancelled');
    expect(title).toContain('16:20');
  });

  it('weaves attempts into the chain by date, oldest first', async () => {
    answer = {
      items: [
        step({
          id: 'a1', at: '2026-11-10T06:00:00.000Z', toName: 'Talha Khan',
          by: 'person', byName: 'Emir Dulovic',
        }),
        attempt({
          id: 't:1', at: '2026-11-11T06:00:00.000Z', outcome: 'refused',
          fromName: 'Talha Khan', toName: 'Tej Singh', reason: 'too_many',
        }),
        step({
          id: 'a2', at: '2026-11-12T06:00:00.000Z', toName: 'Raj Mehta',
          fromName: 'Talha Khan', by: 'person', byName: 'Talha Khan', reason: 'knows_project',
        }),
      ],
    };
    await block();
    const said = text();
    expect(said.indexOf('Given out by Emir Dulovic'))
      .toBeLessThan(said.indexOf('Transfer from Talha Khan to Tej Singh'));
    expect(said.indexOf('Transfer from Talha Khan to Tej Singh'))
      .toBeLessThan(said.indexOf('Transferred from Talha Khan to Raj Mehta'));
    expect(rows()).toHaveLength(3);
  });
});

/* ── 5. the ends of the range ─────────────────────────────────────────── */

describe('a lead nobody has been given', () => {
  it('uses the words the three leads screens already use', async () => {
    answer = { items: [] };
    await block();
    expect(text()).toContain('Not given out yet');
    expect(rows()).toHaveLength(0);
    expect(CODE, 'from the one module, not written out a second time')
      .toContain('{NOT_GIVEN}');
  });
});

describe('when the endpoint refuses', () => {
  it('says so rather than drawing an empty history', async () => {
    fails = true;
    await block();
    expect(text()).toContain('That lead is not yours to work.');
    expect(text()).not.toContain('Not given out yet');
  });
});

/* ── 6. it is on the lead page, above the tabs ────────────────────────── */

describe('the lead page', () => {
  const page = readFileSync(path.join(HERE, 'Lead.tsx'), 'utf8');

  it('always draws the block, for every lead', async () => {
    /* No condition on it: the complaint was that a lead carried no date at
       all, so a lead with nothing to say has to say that. */
    expect(page).toContain('<LeadHandover leadId={lead.id} />');
  });

  it('puts it in the middle column, under “In short”', () => {
    const short = page.indexOf('<InShort lead={lead}');
    const hand = page.indexOf('<LeadHandover leadId={lead.id} />');
    const tabs = page.indexOf('className="d-card v2-leadpage-tabs"');
    expect(short).toBeGreaterThan(-1);
    expect(hand).toBeGreaterThan(short);
    expect(hand, 'above the Notes/Timeline/Info/Files card').toBeLessThan(tabs);
  });
});

/* ── 6b. the Transfers page's own When column ─────────────────────────── */

describe('the Transfers page “When” column', () => {
  /*
   * Emir, 14 Nov: *"Transfers page: the When column shows only the day. Show
   * date AND time."* Today's rows already carried a clock and everything
   * older dropped it, so there was no telling a request sent before the
   * morning meeting from one sent after it.
   */
  it('carries the time on an older row, not just the day', () => {
    /* 13 Nov 06:05 UTC is 10:05 in Dubai, against the frozen 14 Nov clock. */
    expect(when('2026-11-13T06:05:00.000Z')).toBe('Fri 13 Nov 10:05');
  });

  it('still says “Today” with the clock on today’s rows', () => {
    expect(when('2026-11-14T05:30:00.000Z')).toBe('Today 09:30');
  });

  it('is 24-hour and Dubai', () => {
    /* 20:45 UTC on the 13th is 00:45 on the 14th in Dubai — today. */
    expect(when('2026-11-13T20:45:00.000Z')).toBe('Today 00:45');
    expect(when('2026-11-12T13:40:00.000Z')).toBe('Thu 12 Nov 17:40');
  });
});

/* ── 7. the stylesheet the block needs ────────────────────────────────── */

describe('its three rules', () => {
  const shell = readFileSync(path.join(HERE, '..', 'styles', 'v2-shell.css'), 'utf8');

  it('are in the base layer of v2-shell.css, not inside the phone query', () => {
    /*
     * The bottom half of `v2-shell.css` is inside `@media (max-width:767px)`,
     * and three fixes written for the computer have already landed in there
     * and done nothing above 767px, in silence, with the suite green.
     * Counted by brace depth, because by eye is how it went wrong before.
     */
    const css = shell.replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf('.v2 .d-row.v2-leadhand-row{');
    expect(at, 'the rule should be in v2-shell.css').toBeGreaterThan(-1);
    let depth = 0;
    for (const ch of css.slice(0, at)) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    expect(depth, 'depth 0 is the base layer; 1 is inside a media query').toBe(0);
  });

  it('exist for all three classes the block uses', () => {
    for (const name of ['v2-leadhand-row', 'v2-leadhand-why', 'v2-leadhand-when']) {
      expect(CODE, `${name} should be used`).toContain(name);
      expect(shell, `${name} should be styled`).toMatch(
        new RegExp(`\\.${name}\\{`),
      );
    }
  });

  it('beats the design’s own `.d-row`, which centres its children', () => {
    /*
     * `.v2 .d-row` is two classes. A bare `.v2-leadhand-row` is one, and
     * loses — which it did: the date sat half-way down a two-line row and
     * the code looked right. Three classes, so there is nothing to lose to.
     */
    expect(shell).toContain('.v2 .d-row.v2-leadhand-row{ align-items:flex-start');
  });
});
