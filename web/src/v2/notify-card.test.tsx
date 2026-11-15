import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushState } from '../lib/push.js';

/**
 * "Turn on notifications" on My Day, and when it comes back.
 *
 * 15 Nov. The owner pressed the X on this card weeks ago, when no Firebase
 * key existed and pressing "Turn on" could not have delivered anything to
 * anybody. The dismissal was stored for ever — and this card was the ONLY
 * thing in the whole of v2 that called `enablePush()`. So from that moment he
 * had no way to register a phone anywhere in the CRM, his team's alerts were
 * unreachable, and he spent an hour on it before anyone worked out why.
 *
 * The rule now: an old dismissal lapses once the card can actually do its job
 * — the server has a key and this device is simply off. A fresh "not now",
 * pressed in that state, stands. Both halves are checked here, because the
 * second one is what stops the fix becoming a card nobody can get rid of.
 */

let device: PushState;
let enabled: number;

vi.mock('../lib/push.js', () => ({
  pushState: async () => device,
  supported: () => device !== 'unsupported',
  iosNeedsInstall: () => false,
  enablePush: async () => { enabled += 1; return 'on'; },
  disablePush: async () => 'off',
}));

const { NotifyCard } = await import('./Home.js');

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  device = 'off';
  enabled = 0;
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function show() {
  await act(async () => {
    root.render(<MemoryRouter><NotifyCard /></MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); });
}

const showing = () => host.textContent?.includes('Turn on notifications') ?? false;

const dismiss = async () => {
  const x = host.querySelector<HTMLButtonElement>('button[aria-label="Not now"]');
  expect(x, 'no "Not now" button').toBeTruthy();
  await act(async () => { x?.click(); });
};

describe('when the My Day notifications card appears', () => {
  it('asks when this device is off and nothing has been dismissed', async () => {
    await show();
    expect(showing()).toBe(true);
  });

  it('never asks once this device is registered', async () => {
    device = 'on';
    await show();
    expect(showing()).toBe(false);
  });

  /** The bug. */
  it('comes back for somebody who dismissed it before there was a key', async () => {
    /* What the owner's browser held: a "no" written when `pushState()` was
       `not-configured` and the card could not have worked. */
    localStorage.setItem('emir-notify-ask', 'no');
    device = 'off';

    await show();

    expect(showing(), 'the only route to registering a phone is still hidden').toBe(true);
    /* And the stale answer is cleared, so it is not re-decided every load. */
    expect(localStorage.getItem('emir-notify-ask')).toBeNull();
  });

  it('stays hidden for that same dismissal while nothing can be delivered', async () => {
    localStorage.setItem('emir-notify-ask', 'no');
    device = 'not-configured';

    await show();

    /* Still true that pressing "Turn on" cannot deliver a lead alert, so the
       dismissal still stands and the stored answer is left alone. */
    expect(showing()).toBe(false);
    expect(localStorage.getItem('emir-notify-ask')).toBe('no');
  });

  it('respects a "not now" pressed when the card could do its job', async () => {
    device = 'off';
    await show();
    expect(showing()).toBe(true);

    await dismiss();
    expect(showing()).toBe(false);
    /* Recorded as the live kind, so the next load does not clear it. */
    expect(localStorage.getItem('emir-notify-ask')).toBe('no-live');

    await act(() => root.unmount());
    host.remove();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await show();

    expect(showing(), 'a real "not now" must stick').toBe(false);
  });

  it('still registers the device when "Turn on" is pressed', async () => {
    await show();
    const turnOn = [...host.querySelectorAll('button')]
      .find((one) => (one.textContent ?? '').trim() === 'Turn on');
    expect(turnOn).toBeTruthy();

    await act(async () => { turnOn?.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(enabled).toBe(1);
    /* And then it has nothing left to ask, so it goes. The "Notifications are
       on." line it sets is never seen for that reason — the card removes
       itself in the same render. Left as it was: the switch in Settings is
       where somebody checks, and it says so. */
    expect(showing()).toBe(false);
  });
});
