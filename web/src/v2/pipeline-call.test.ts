import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth.js';
import { V2Pipeline } from './Pipeline.js';

/**
 * One screen, mounted for real, with the button pressed.
 *
 * `call-wiring.test.ts` reads the source of all eight screens, which is the
 * only way to hold eight of them at once in an app with no component-testing
 * library. It proves the helper is wired in; it cannot prove the wiring
 * works. So one screen is mounted and clicked end to end, and the pipeline
 * board is the one worth picking: every agent lives on it, the card and the
 * kanban row are two separate call sites, and it loads from a single
 * endpoint.
 *
 * What this pins down is the owner's own fault, in the shape he found it: the
 * Call button on the board opened the phone and recorded nothing, so a day
 * spent calling from the board showed as a day of no calls.
 */

interface Sent { method: string; path: string; body: Record<string, unknown> | null }

let sent: Sent[] = [];
let container: HTMLDivElement;
let root: Root;

const reply = (body: unknown): Response => ({
  ok: true, status: 200, text: async () => JSON.stringify(body),
} as unknown as Response);

const BOARD = {
  columns: [
    {
      stageKey: 'new_lead',
      stageName: 'New Lead',
      position: 1,
      total: 1,
      cards: [{
        id: 'opp-77',
        contact_id: 'c-77',
        stage_key: 'new_lead',
        full_name: 'Dana Haddad',
        phone_e164: '+971501234567',
        project_name: 'The Archive',
        owner_name: 'Dana',
      }],
    },
    { stageKey: 'attempted_contact', stageName: 'Attempted Contact', position: 2, total: 0, cards: [] },
    { stageKey: 'engaged_qualified', stageName: 'Engaged', position: 3, total: 0, cards: [] },
    { stageKey: 'appointment_scheduled', stageName: 'Appointment', position: 4, total: 0, cards: [] },
    { stageKey: 'deal_sent', stageName: 'Deal Sent', position: 5, total: 0, cards: [] },
    { stageKey: 'won', stageName: 'Won', position: 6, total: 0, cards: [] },
    { stageKey: 'lost', stageName: 'Lost', position: 7, total: 0, cards: [] },
  ],
};

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(
      MemoryRouter,
      null,
      createElement(AuthProvider, null, createElement(V2Pipeline)),
    ));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sent = [];

  /* 11:00 in Dubai: the check-in gate's working-hours window becomes a fact
     of the test rather than of the hour the suite happens to run at. */
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T07:00:00Z'));

  /* jsdom has no matchMedia, and the phone/computer switch reads it. A
     computer, so the board draws its kanban columns rather than the phone's
     one-stage-at-a-time list. */
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: false,
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));

  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    sent.push({
      method,
      path,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null,
    });

    if (path === '/api/auth/me') {
      return reply({
        user: {
          id: 'u-1', name: 'Dana', email: 'dana@homes.test', role: 'agent', locale: 'en',
          availability: 'available', mustChangePassword: false, permissions: [],
        },
      });
    }
    /* Already marked in, so the sheet does not come up and the click runs
       straight through — the gate itself is `lib/call-action.test.ts`. */
    if (path === '/api/attendance/today') {
      return reply({ closed: false, marked: 'office', onOfficeNetwork: true, enabled: true, startsAt: null });
    }
    if (path.startsWith('/api/pipeline/board')) return reply(BOARD);
    if (path === '/api/v2/calls') return reply({ id: 'call-1' });
    return reply({});
  });

  Object.defineProperty(window, 'location', {
    value: { href: 'http://localhost/v2/pipeline' }, writable: true, configurable: true,
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Call on the pipeline board', () => {
  it('records the call against the lead, then opens the phone', async () => {
    await mount();

    const call = container.querySelector<HTMLAnchorElement>('.v2-kb-call');
    expect(call, 'the kanban card should draw a Call button').not.toBeNull();
    /*
     * The href stays on the element — it is what a long press on a phone
     * offers and what right-click copies — so the proof is not its absence
     * but that the click is taken over and the row written first.
     */
    expect(call?.getAttribute('href')).toBe('tel:+971501234567');

    await act(async () => { call?.click(); });

    const calls = sent.filter((one) => one.path === '/api/v2/calls' && one.method === 'POST');
    expect(calls, 'pressing Call used to post nothing at all').toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      opportunityId: 'opp-77',
      source: 'lead',
      notCheckedIn: false,
    });
    expect(window.location.href).toBe('tel:+971501234567');
  });
});
