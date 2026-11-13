import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth.js';
import { V2Leads } from './Leads.js';

/**
 * My leads, mounted for real, with both buttons pressed.
 *
 * The companion to `pipeline-call.test.ts`: that one proves a Call is
 * recorded, and this one proves a WhatsApp tap is too, which is the other
 * half of the owner's fault. Every WhatsApp button outside the dialler was a
 * bare `wa.me` link, so "WhatsApp clicks today" counted only the diallerer's.
 *
 * My leads is the screen to mount for it because it draws Call and WhatsApp
 * side by side on every row, so one click each proves both paths through the
 * same component. `call-wiring.test.ts` holds the other six screens by
 * reading their source.
 */

interface Sent { method: string; path: string; body: Record<string, unknown> | null }

let sent: Sent[] = [];
let opened: string[] = [];
let container: HTMLDivElement;
let root: Root;

const reply = (body: unknown): Response => ({
  ok: true, status: 200, text: async () => JSON.stringify(body),
} as unknown as Response);

const ROW = {
  id: 'opp-42',
  contact_id: 'c-42',
  full_name: 'Omar Haddad',
  phone_e164: '+971509876543',
  project_name: 'The Archive',
  unit_type: '2BR',
  budget_min_aed: null,
  budget_max_aed: 2_000_000,
  source: 'meta',
  stage_key: 'new_lead',
  status: 'open',
  is_vip: 0,
  returned_at: null,
  next_step_at: null,
  next_step_note: null,
  last_contact_at: null,
  owner_name: 'Dana',
};

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(
      MemoryRouter,
      null,
      createElement(AuthProvider, null, createElement(V2Leads)),
    ));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sent = [];
  opened = [];

  /* 11:00 in Dubai, so the gate's working-hours window is a fact of the test
     rather than of the hour the suite happens to run at. */
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T07:00:00Z'));

  /* jsdom lays nothing out, so it has no `scrollIntoView`. The tab strip
     scrolls the open tab into view on every change. */
  Element.prototype.scrollIntoView = () => undefined;

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
    if (path === '/api/attendance/today') {
      return reply({ closed: false, marked: 'office', onOfficeNetwork: true, enabled: true, startsAt: null });
    }
    if (path.startsWith('/api/my-leads/counts')) return reply({ today: 1 });
    if (path.startsWith('/api/my-leads/projects')) return reply({ items: [] });
    if (path.startsWith('/api/my-leads?')) {
      return reply({
        tab: 'today', items: [ROW], total: 1, empty: { title: '', hint: '' },
      });
    }
    return reply({ items: [] });
  });

  Object.defineProperty(window, 'location', {
    value: { href: 'http://localhost/v2/leads' }, writable: true, configurable: true,
  });
  vi.stubGlobal('open', (url: string) => { opened.push(url); return null; });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const posted = (path: string): Sent[] => sent.filter((one) => one.path === path && one.method === 'POST');

/** The two buttons on a row of the table, by what they say. */
function button(label: 'Call' | 'WhatsApp'): HTMLAnchorElement | null {
  return [...container.querySelectorAll<HTMLAnchorElement>('.d-row-actions a')]
    .find((one) => one.textContent?.includes(label)) ?? null;
}

describe('Call and WhatsApp on My leads', () => {
  it('records the call, then opens the phone', async () => {
    await mount();

    const call = button('Call');
    expect(call, 'the row should draw a Call button').not.toBeNull();
    /* The href stays, for a long press and for right-click-copy; the click is
       what is taken over. */
    expect(call?.getAttribute('href')).toBe('tel:+971509876543');

    await act(async () => { call?.click(); });

    expect(posted('/api/v2/calls'), 'pressing Call used to post nothing').toHaveLength(1);
    expect(posted('/api/v2/calls')[0]?.body).toMatchObject({
      opportunityId: 'opp-42', source: 'lead', notCheckedIn: false,
    });
    expect(window.location.href).toBe('tel:+971509876543');
  });

  it('records the tap, then opens WhatsApp — and never says "sent"', async () => {
    await mount();

    const wa = button('WhatsApp');
    expect(wa, 'the row should draw a WhatsApp button').not.toBeNull();

    await act(async () => { wa?.click(); });

    expect(posted('/api/v2/taps'), 'pressing WhatsApp used to post nothing').toHaveLength(1);
    expect(posted('/api/v2/taps')[0]?.body).toMatchObject({
      opportunityId: 'opp-42', app: 'whatsapp',
    });
    /* A tap, not a message: the CRM hands over to WhatsApp and cannot know
       what happened there, so nothing is written down as sent. */
    expect(sent.some((one) => one.path.includes('/messages'))).toBe(false);
    expect(opened).toEqual(['https://wa.me/971509876543']);
    /* The browser was not navigated away — WhatsApp opens in its own tab. */
    expect(window.location.href).toBe('http://localhost/v2/leads');
  });

  /* The gate belongs to calls. `message_taps` has no column for the answer,
     so asking before a tap would collect one and bin it. */
  it('does not ask the check-in question before a WhatsApp tap', async () => {
    await mount();
    await act(async () => { button('WhatsApp')?.click(); });
    expect(container.querySelector('.v2-gate')).toBeNull();
  });
});
