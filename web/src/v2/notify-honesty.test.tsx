import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../design/ui.js';
import type { PushState } from '../lib/push.js';

/**
 * Settings, My notifications: the card that used to lie.
 *
 * On 15 Nov the owner finished setting up Firebase, pressed "Send a test",
 * read **"it works"**, and spent an hour looking for the alert. The button
 * called no endpoint at all. Above it the card read "Notifications are on" as
 * a hardcoded heading, whether or not a key was set and whether or not a
 * single device had ever been registered.
 *
 * And the bigger half: **there was no way to register a phone in v2.** This
 * row had a "How to install" link and no switch; the only caller of
 * `enablePush()` in the whole of v2 was the card on My Day, which stores a
 * "not now" for ever. One press of its X, weeks earlier, and the owner's
 * route to turning alerts on had closed.
 *
 * So what is asserted here is what a person reads and presses, in each state,
 * rather than the shape of a props object.
 */

/* ── the world this card lives in ──────────────────────────────────────── */

let notify: Record<string, unknown>;
let testReply: Record<string, unknown>;
let device: PushState;
let asked: string[];
let registered: string[];

vi.mock('../lib/auth.js', () => ({
  useAuth: () => ({ user: { id: 'u-1', name: 'Emir', role: 'owner' }, signOut: () => undefined }),
  useMaybeAuth: () => ({ user: { id: 'u-1', name: 'Emir', role: 'owner' } }),
}));

/*
 * The browser half is stubbed at `lib/push.js`, not at `lib/push-device.js`:
 * the reading of those states is the thing being checked, so mocking it away
 * would check nothing. `enablePush`/`disablePush` are the two calls that only
 * a real browser can make.
 */
vi.mock('../lib/push.js', () => ({
  pushState: async () => device,
  supported: () => device !== 'unsupported',
  iosNeedsInstall: () => false,
  enablePush: async () => {
    registered.push('enable');
    return device === 'off' ? 'on' : device;
  },
  disablePush: async () => {
    registered.push('disable');
    return 'off';
  },
}));

const { V2SettingsNotifications } = await import('./settings/Notifications.js');

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  asked = [];
  registered = [];
  device = 'off';
  notify = {
    switches: {}, computer: true, sounds: true, volume: 0.12, soundNewLead: true,
    soundWon: true, quiet: '22:00-08:00', vipIgnoresQuiet: true, groups: [],
    alerts: { state: 'ok', keySet: true, devices: 2, say: 'Notifications are on · 2 devices', to: null },
  };
  testReply = {
    outcome: 'sent', reached: 2, registered: 2, removed: 0, to: null,
    say: 'It works. The test alert reached 2 devices.',
  };

  vi.stubGlobal('fetch', async (pathname: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    asked.push(`${method} ${pathname}`);
    const body = pathname.includes('/notifications/test') ? testReply : notify;
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response;
  });

  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined,
  }));

  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** Mount it and let the two loads settle. */
async function show() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ToastHost><V2SettingsNotifications /></ToastHost>
      </MemoryRouter>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

const press = async (label: string) => {
  const button = [...host.querySelectorAll('button')]
    .find((one) => (one.textContent ?? '').includes(label));
  expect(button, `no button reading "${label}"`).toBeTruthy();
  await act(async () => { button?.click(); });
  await act(async () => { await Promise.resolve(); });
};

const heading = () => host.querySelector('h2')?.textContent ?? '';
const deviceSwitch = () =>
  host.querySelector<HTMLInputElement>('input[aria-label="Get alerts on the device I am using now"]');

/* ── the heading ───────────────────────────────────────────────────────── */

describe('the notifications card heading', () => {
  it('says what the server says, not "Notifications are on" regardless', async () => {
    notify.alerts = {
      state: 'no-device', keySet: true, devices: 0,
      say: 'No device gets your alerts yet', to: '/v2/home',
    };
    await show();

    expect(heading()).toBe('No device gets your alerts yet');
    /* The old screen's words, which were printed in this exact state. */
    expect(heading()).not.toContain('are on');
    /* And it points at the place that registers one. */
    expect(host.textContent).toContain('Turn on notifications');
    expect([...host.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/v2/home')).toBe(true);
  });

  it('does not claim alerts are on when the server has no key', async () => {
    notify.alerts = {
      state: 'no-key', keySet: false, devices: 0,
      say: 'Notifications cannot be sent yet', to: null,
    };
    await show();

    expect(heading()).toBe('Notifications cannot be sent yet');
    expect(host.textContent).toContain('Firebase values are not on the server yet');
    /* Nothing is lost — the bell still has them — and an owner should be told
       that rather than left thinking leads are vanishing. */
    expect(host.textContent).toContain('bell inside the CRM');
  });

  it('says so, with a count, when alerts really are on', async () => {
    await show();
    expect(heading()).toBe('Notifications are on · 2 devices');
    expect(host.textContent).toContain('Phone app and this computer');
  });
});

/* ── the button ────────────────────────────────────────────────────────── */

describe('the "Send a test" button', () => {
  it('actually calls the server', async () => {
    await show();
    await press('Send a test');

    expect(asked).toContain('POST /api/v2/notifications/test');
  });

  /** The press the owner made. */
  it('does not say it worked when the server says nothing was sent', async () => {
    notify.alerts = {
      state: 'no-device', keySet: true, devices: 0,
      say: 'No device gets your alerts yet', to: '/v2/home',
    };
    testReply = {
      outcome: 'no-device', reached: 0, registered: 0, removed: 0, to: '/v2/home',
      say: 'Nothing was sent. No device is registered for you yet. Open My Day and tap '
        + '"Turn on notifications" on the card at the top — on the phone you want the '
        + 'alerts on, not here.',
    };
    await show();
    await press('Send a test');

    expect(host.textContent).toContain('Nothing was sent');
    expect(host.textContent?.toLowerCase()).not.toContain('it works');
    /* The sentence it printed before: a subtitle claiming a test had gone. */
    expect(host.textContent).not.toContain('test sent just now');
  });

  it('shows the server\'s sentence whatever the outcome', async () => {
    for (const say of [
      'Nothing was sent. Firebase refused the request.',
      'Nothing was sent. This is the test copy of the CRM, which never sends to a real device.',
      'It works. The test alert reached 1 device.',
    ]) {
      testReply = { outcome: 'failed', reached: 0, registered: 1, removed: 0, to: null, say };
      await show();
      await press('Send a test');
      expect(host.textContent).toContain(say);
      await act(() => root.unmount());
      host.remove();
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
    }
  });

  it('says the test could not be sent rather than that it worked, when the call fails', async () => {
    await show();
    vi.stubGlobal('fetch', async () => ({
      ok: false, status: 500,
      text: async () => '{"error":{"message":"Internal server error"}}',
      json: async () => ({ error: { message: 'Internal server error' } }),
    } as unknown as Response));

    await press('Send a test');

    expect(host.textContent?.toLowerCase()).not.toContain('it works');
  });

  /*
   * The old button refused to send at all when "This computer" was switched
   * off, with "Test sent to your phone" — a claim about a phone it had not
   * contacted. The switch below is about this browser showing alerts; it is
   * not a reason to skip the send.
   */
  it('still sends when "This computer" is switched off', async () => {
    notify.computer = false;
    await show();
    await press('Send a test');

    expect(asked).toContain('POST /api/v2/notifications/test');
  });
});

/* ── the switch that did not exist ─────────────────────────────────────── */

describe('the Phone app row', () => {
  it('has a switch that registers this device', async () => {
    await show();

    const box = deviceSwitch();
    expect(box, 'the Phone app row still has no switch').toBeTruthy();
    expect(box?.checked).toBe(false);
    expect(box?.disabled).toBe(false);

    await act(async () => { box?.click(); });
    await act(async () => { await Promise.resolve(); });

    /* The real registration call, not a stored preference. */
    expect(registered).toEqual(['enable']);
    /* And the heading is re-read, because the server is now counting one
       more device. */
    expect(asked.filter((one) => one === 'GET /api/v2/notify').length).toBeGreaterThan(1);
  });

  it('keeps "How to install" as well as the switch', async () => {
    await show();
    expect(host.textContent).toContain('How to install');
    expect(deviceSwitch()).toBeTruthy();
  });

  it('turns the device off again', async () => {
    device = 'on';
    await show();

    expect(deviceSwitch()?.checked).toBe(true);
    await act(async () => { deviceSwitch()?.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(registered).toEqual(['disable']);
  });

  it('shows the real state of the device, not a preference', async () => {
    for (const [state, words] of [
      ['on', 'On for this device'],
      ['off', 'Off — you will miss new leads'],
      ['blocked', 'Blocked in your phone settings'],
      ['not-configured', 'Not set up yet'],
      ['unsupported', 'Not possible in this browser'],
    ] as Array<[PushState, string]>) {
      device = state;
      await show();
      expect(host.textContent, state).toContain(words);
      await act(() => root.unmount());
      host.remove();
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
    }
  });

  it('does not offer a switch that could do nothing', async () => {
    for (const state of ['blocked', 'not-configured', 'unsupported'] as PushState[]) {
      device = state;
      await show();
      expect(deviceSwitch()?.disabled, state).toBe(true);
      /* And it says why, rather than leaving a dead switch unexplained. */
      expect((host.textContent ?? '').length, state).toBeGreaterThan(0);
      await act(() => root.unmount());
      host.remove();
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
    }
  });

  it('tells somebody blocked where the switch actually is', async () => {
    device = 'blocked';
    await show();
    expect(host.textContent).toContain('only you can undo it');
    expect(host.textContent).toContain('Settings, Notifications, homes.me');
  });
});
