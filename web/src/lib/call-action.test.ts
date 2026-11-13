import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './auth.js';
import { useCallAction, type CallActions, type CallableLead } from '../v2/call.js';

/**
 * Every Call and WhatsApp button records what it did.
 *
 * The fault this pins down: `POST /api/v2/calls` and `POST /api/v2/taps` are
 * where calls today, WhatsApp clicks today, the messaging report and every
 * speed-to-lead figure come from, and only the power dialler was posting to
 * them. Every other Call button in the CRM was a bare `tel:` link, so a call
 * made from a lead's own page did not exist in any figure the owner reads.
 * `v2/call.ts` is the one helper the screens use; this is what it has to do.
 *
 * It lives in `lib/` rather than beside the helper because `v2/` belongs to
 * the screen work going on in parallel.
 *
 * Rendered with react-dom directly: this repository has no component-testing
 * library, and a hook cannot be called outside a render.
 */

interface Sent { method: string; path: string; body: Record<string, unknown> | null }

let sent: Sent[] = [];
let container: HTMLDivElement;
let root: Root;
let actions: CallActions | null = null;
let opened: Array<{ url: string; target?: string }> = [];

/** The attendance answer: whether the agent is asked the check-in question. */
let today = { closed: false, marked: 'office' as string | null, onOfficeNetwork: true, enabled: true, startsAt: null };
/** What `POST /api/v2/calls` and `/taps` do. */
let failPosts = false;

const reply = (body: unknown): Response => ({
  ok: true, status: 200, text: async () => JSON.stringify(body),
} as unknown as Response);

const refuse = (status: number, message: string): Response => ({
  ok: false, status, text: async () => JSON.stringify({ error: { code: 'error', message } }),
} as unknown as Response);

function Probe({ source }: { source?: 'lead' | 'dialler' }) {
  /* The hook under test, held in a module variable so the test can drive it.
     The banner is rendered because the check-in sheet lives in it. */
  actions = useCallAction(source ? { source } : {});
  return createElement('div', null, actions.banner);
}

async function mount(props: { source?: 'lead' | 'dialler' } = {}): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(AuthProvider, null, createElement(Probe, props)));
  });
}

const lead: CallableLead = { id: 'opp-1', phone: '+971 50 123 4567', name: 'Dana Haddad' };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sent = [];
  opened = [];
  actions = null;
  failPosts = false;
  today = { closed: false, marked: 'office', onOfficeNetwork: true, enabled: true, startsAt: null };

  /* 11:00 in Dubai, so the check-in gate's working-hours window is a fact of
     the test rather than of the hour the suite happens to run at. Only Date
     is faked — faking timers as well would deadlock `act`. */
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T07:00:00Z'));

  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string'
      ? JSON.parse(init.body) as Record<string, unknown>
      : null;
    sent.push({ method, path, body });

    if (path === '/api/auth/me') {
      return reply({
        user: {
          id: 'u-1', name: 'Dana', email: 'dana@homes.test', role: 'agent', locale: 'en',
          availability: 'available', mustChangePassword: false, permissions: [],
        },
      });
    }
    if (path === '/api/attendance/today') return reply(today);
    if (path === '/api/attendance/check-in') return reply(today);
    if (path === '/api/v2/calls') {
      return failPosts ? refuse(404, 'That lead is not one of yours.') : reply({ id: 'call-1' });
    }
    if (path === '/api/v2/taps') {
      return failPosts ? refuse(500, 'Nope.') : reply({ id: 'tap-1' });
    }
    return reply({});
  });

  Object.defineProperty(window, 'location', {
    value: { href: 'http://localhost/v2/leads' }, writable: true, configurable: true,
  });
  vi.stubGlobal('open', (url: string, target?: string) => {
    opened.push({ url, target });
    return null;
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const posted = (path: string): Sent[] => sent.filter((one) => one.path === path && one.method === 'POST');

describe('calling a lead from any screen', () => {
  it('records the call before it opens the phone', async () => {
    await mount({ source: 'lead' });
    let id: string | null = null;
    await act(async () => { id = await actions!.call(lead); });

    expect(posted('/api/v2/calls')).toHaveLength(1);
    expect(posted('/api/v2/calls')[0]?.body).toMatchObject({
      opportunityId: 'opp-1', source: 'lead', notCheckedIn: false,
    });
    /* The call id comes back so a screen can ask "what happened?" afterwards
       with PATCH /api/v2/calls/{id}. */
    expect(id).toBe('call-1');
    expect(window.location.href).toBe('tel:+971 50 123 4567');
  });

  it('carries the screen it was pressed on, so the dialler can be told apart', async () => {
    await mount({ source: 'dialler' });
    await act(async () => { await actions!.call(lead); });
    expect(posted('/api/v2/calls')[0]?.body).toMatchObject({ source: 'dialler' });
  });

  /*
   * The number lives under two different names across the v2 screens — the
   * dialler and My day call it `phone`, the pipeline and My leads call it
   * `phone_e164`. The helper takes either, because the alternative is a
   * mapping object at thirteen call sites and a mistake in one of them.
   */
  it('takes either spelling of the number and the name', async () => {
    await mount();
    await act(async () => {
      await actions!.call({ id: 'opp-2', phone_e164: '+971555555555', full_name: 'Omar' });
    });
    expect(posted('/api/v2/calls')[0]?.body).toMatchObject({ opportunityId: 'opp-2' });
    expect(window.location.href).toBe('tel:+971555555555');
  });

  /*
   * A CRM that will not dial because it could not write a row is a CRM people
   * work around, and the agent has a client waiting. So the call goes through
   * and the failure is said out loud instead of swallowed.
   */
  it('still dials when the recording fails, and says so', async () => {
    failPosts = true;
    await mount();
    let id: string | null = 'unset';
    await act(async () => { id = await actions!.call(lead); });

    expect(id).toBeNull();
    expect(window.location.href).toBe('tel:+971 50 123 4567');
    expect(actions!.error).toMatch(/not one of yours/i);
    expect(container.textContent).toMatch(/not one of yours/i);
  });

  it('does not invent a call for a lead with no number', async () => {
    await mount();
    await act(async () => { await actions!.call({ id: 'opp-3', phone: null }); });

    expect(posted('/api/v2/calls')).toHaveLength(0);
    expect(window.location.href).toBe('http://localhost/v2/leads');
    expect(actions!.error).toMatch(/no phone number/i);
  });
});

describe('the check-in question', () => {
  /** The sheet, when the gate has decided to ask. */
  const sheet = () => container.querySelector('.v2-gate');

  it('is not asked of somebody already marked in', async () => {
    await mount();
    await act(async () => { await actions!.call(lead); });
    expect(sheet()).toBeNull();
    expect(posted('/api/v2/calls')[0]?.body).toMatchObject({ notCheckedIn: false });
  });

  it('marks the call "not checked in" when the agent calls anyway', async () => {
    today = { ...today, marked: null };
    await mount();

    /* The call waits on the answer, so it is started and not awaited. */
    let settled: string | null = 'unset';
    await act(async () => { void actions!.call(lead).then((id) => { settled = id; }); });
    expect(sheet(), 'the sheet has to be in the banner the screen rendered').not.toBeNull();
    expect(posted('/api/v2/calls'), 'nothing is recorded until the question is answered')
      .toHaveLength(0);

    const anyway = container.querySelector<HTMLButtonElement>('.v2-gate-any');
    await act(async () => { anyway?.click(); });

    expect(posted('/api/v2/calls')[0]?.body).toMatchObject({ notCheckedIn: true });
    expect(settled).toBe('call-1');
    expect(window.location.href).toBe('tel:+971 50 123 4567');
  });

  it('checks the agent in when they say they are in the office', async () => {
    today = { ...today, marked: null };
    await mount();
    await act(async () => { void actions!.call(lead); });

    const checkIn = container.querySelector<HTMLButtonElement>('.v2-gate-in');
    await act(async () => { checkIn?.click(); });

    expect(posted('/api/attendance/check-in')).toHaveLength(1);
    expect(posted('/api/v2/calls')[0]?.body).toMatchObject({ notCheckedIn: false });
  });

  it('records nothing and dials nothing when the sheet is dismissed', async () => {
    today = { ...today, marked: null };
    await mount();
    let settled: string | null = 'unset';
    await act(async () => { void actions!.call(lead).then((id) => { settled = id; }); });

    const close = container.querySelector<HTMLButtonElement>('[data-sheet-close]');
    await act(async () => { close?.click(); });

    expect(settled).toBeNull();
    expect(posted('/api/v2/calls')).toHaveLength(0);
    expect(window.location.href).toBe('http://localhost/v2/leads');
  });
});

describe('opening WhatsApp on a lead', () => {
  it('records the tap and opens wa.me with the digits only', async () => {
    await mount();
    let id: string | null = null;
    await act(async () => { id = await actions!.whatsapp(lead); });

    expect(posted('/api/v2/taps')).toHaveLength(1);
    expect(posted('/api/v2/taps')[0]?.body).toMatchObject({ opportunityId: 'opp-1', app: 'whatsapp' });
    expect(id).toBe('tap-1');
    expect(opened[0]?.url).toBe('https://wa.me/971501234567');
  });

  it('carries the typed message both to the record and to WhatsApp', async () => {
    await mount();
    await act(async () => { await actions!.whatsapp(lead, { text: 'Hello Dana, about Saadiyat' }); });

    expect(posted('/api/v2/taps')[0]?.body).toMatchObject({ text: 'Hello Dana, about Saadiyat' });
    expect(opened[0]?.url).toContain('?text=Hello%20Dana%2C%20about%20Saadiyat');
  });

  /*
   * A tap is never written down as "sent". The CRM hands over to WhatsApp and
   * cannot know what happened there, so the row records the tap and the agent
   * presses send themselves.
   */
  it('records a tap, never a sent message', async () => {
    await mount();
    await act(async () => { await actions!.whatsapp(lead); });
    expect(posted('/api/v2/taps')[0]?.body).not.toHaveProperty('result');
    expect(sent.some((one) => one.path.includes('/messages'))).toBe(false);
  });

  /*
   * The window is opened while the browser still counts this as the agent's
   * own click. Awaiting the request first makes Safari treat it as a popup
   * and block it, which is why the request is started, the app opened, and
   * only then the id waited for.
   */
  it('opens the app without waiting for the recording to come back', async () => {
    await mount();
    await act(async () => {
      const pending = actions!.whatsapp(lead);
      expect(opened).toHaveLength(1);
      await pending;
    });
  });

  it('opens Telegram when asked for it', async () => {
    await mount();
    await act(async () => { await actions!.whatsapp(lead, { app: 'telegram' }); });
    expect(posted('/api/v2/taps')[0]?.body).toMatchObject({ app: 'telegram' });
    expect(opened[0]?.url).toBe('https://t.me/+971501234567');
  });

  /*
   * The gate is on calls, as it is in the dialler and on the phone bar: the
   * sheet's own words are about calls, and `message_taps` has no column to
   * record the answer in, so asking here would collect an answer and throw
   * it away.
   */
  it('does not ask the check-in question', async () => {
    today = { ...today, marked: null };
    await mount();
    await act(async () => { await actions!.whatsapp(lead); });

    expect(container.querySelector('.v2-gate')).toBeNull();
    expect(posted('/api/v2/taps')).toHaveLength(1);
  });

  it('still opens WhatsApp when the recording fails', async () => {
    failPosts = true;
    await mount();
    let id: string | null = 'unset';
    await act(async () => { id = await actions!.whatsapp(lead); });

    expect(id).toBeNull();
    expect(opened[0]?.url).toBe('https://wa.me/971501234567');
    expect(actions!.error).toBeTruthy();
  });
});
