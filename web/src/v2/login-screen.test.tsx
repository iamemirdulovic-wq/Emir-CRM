import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth.js';
import { App } from '../App.js';
import { V2Login } from './Login.js';

/**
 * The v2 sign-in screen: what it must never show, and where a signed-out
 * visitor lands.
 *
 * `design/web/login.html` draws three preview cards on the brand panel and
 * fills them with a named VIP client, a live call count and the team's
 * attendance — on the one page in the CRM where nobody is signed in. It also
 * draws two buttons that open the CRM with no password at all, and a six-digit
 * second step that our server has no idea about. The screen keeps the design's
 * layout and drops those three things; these tests are what stop them coming
 * back when somebody ports the page again from the same design file.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(HERE, 'Login.tsx'), 'utf8');
/** The same file with its prose taken out — a class name in a comment is not
    a class name, and the comments here talk about what is deliberately off. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let container: HTMLDivElement;
let root: Root;
/** Every request the screen makes, so "it fetches nothing" can be shown. */
let asked: string[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  asked = [];
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');

  /* jsdom has no matchMedia, and both the theme and the phone/computer switch
     read it. The "device" is a computer in a light theme unless a test says
     otherwise. */
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));

  vi.stubGlobal('fetch', async (pathname: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? 'GET'} ${pathname}`);
    /* Nobody is signed in. That is the whole point of this screen. */
    if (pathname === '/api/auth/me') {
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { code: 'unauthorized', message: 'Not signed in.' } }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(pathname === '/api/setup/status' ? { needed: false } : {}),
    } as unknown as Response;
  });
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
  vi.unstubAllGlobals();
});

async function mount(tree: ReactNode): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(tree);
  });
}

const screen = async (): Promise<void> => mount(
  <MemoryRouter initialEntries={['/v2/login']}>
    <AuthProvider><V2Login /></AuthProvider>
  </MemoryRouter>,
);

const text = (): string => container.textContent ?? '';

describe('the brand panel', () => {
  it('draws the design\'s three cards, with their own titles', async () => {
    await screen();
    const cards = container.querySelectorAll('.d-preview .d-pv');
    expect(cards).toHaveLength(3);
    expect([...cards].map((card) => card.querySelector('.d-label')?.textContent))
      .toEqual(['Needs you now', 'Calls today', 'In office now']);
    /* The third is the orange one in the design, and stays orange. */
    expect(cards[2]?.classList.contains('d-or')).toBe(true);
  });

  it('names nobody', async () => {
    await screen();
    const panel = container.querySelector('.d-brand')?.textContent ?? '';
    /* The names the design file puts on this page, verbatim. */
    for (const name of [
      'Khalid Al Mansoori', 'Sara Nunes', 'Lucas Martin', 'Marco Bellini',
      'Rocky', 'Emir',
    ]) {
      expect(panel, `${name} must not be on the sign-in page`).not.toContain(name);
    }
  });

  it('puts no figure in the cards', async () => {
    await screen();
    for (const card of container.querySelectorAll('.d-preview .d-pv')) {
      /* "214", "6 of 10", "24:12", "1 late · 1 outside" — all of it is data
         about real people and real work, and none of it belongs to a visitor
         who has not signed in. */
      expect(card.textContent ?? '', 'a preview card must carry no number').not.toMatch(/\d/);
      expect(card.querySelector('.d-num')).toBeNull();
      expect(card.querySelector('.d-bars')).toBeNull();
      expect(card.querySelector('.d-arow')).toBeNull();
      expect(card.querySelector('[data-countdown]')).toBeNull();
    }
  });

  it('reads nothing but whether this CRM has any accounts yet', async () => {
    await screen();
    /* `/api/setup/status` answers true or false about the installation; it is
       not anybody's data. Anything else asked here would be data read before
       a password, which is the fault the cards were hiding. */
    expect(asked.filter((one) => one !== 'GET /api/auth/me'))
      .toEqual(['GET /api/setup/status']);
  });

  it('builds the cards from a constant, not from a request', () => {
    /* The DOM check above passes just as well on a screen that fetches and
       renders nothing yet. This is what pins the cards to fixed text. */
    expect(CODE).toMatch(/const PREVIEW: Array<\{ title: string; line: string; accent\?: boolean \}>/);
    expect(CODE).not.toMatch(/useAsync|\/api\/v2\//);
  });
});

describe('the demo sign-in buttons', () => {
  /*
   * `design/web/login.html`: "Demo only · open as — Agent · Rocky / Owner ·
   * Emir", and the prototype's handler sets a role in localStorage and opens
   * the dashboard. That is a way into the CRM with no password.
   */
  it('do not exist', async () => {
    await screen();
    expect(container.querySelectorAll('.d-roles')).toHaveLength(0);
    expect(container.querySelectorAll('.d-role')).toHaveLength(0);
    expect(container.querySelectorAll('[data-go]')).toHaveLength(0);
    expect(text()).not.toContain('Demo only');
    expect(text()).not.toContain('open as');
  });

  it('are nowhere in the source either', () => {
    expect(CODE).not.toContain('d-role');
    expect(CODE).not.toContain('hmRole');
  });

  it('leaves no way in but the form', async () => {
    await screen();
    /* One submit, and it is the password form. */
    const submits = [...container.querySelectorAll('button')]
      .filter((one) => (one as HTMLButtonElement).type === 'submit');
    expect(submits).toHaveLength(1);
    expect(submits[0]?.textContent).toContain('Sign in');
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });
});

describe('the six-digit second step', () => {
  /*
   * `CLAUDE.md` (LOGIN): "simple built-in email + password login only. No OTP."
   * The design disagrees with the brief, so the markup is built and left
   * unreachable until the owner says otherwise. See
   * `docs/decisions-to-confirm.md` §34.
   */
  it('is drawn, so it is ready', async () => {
    await screen();
    expect(container.querySelector('.d-step2')).not.toBeNull();
    expect(container.querySelectorAll('.d-code input')).toHaveLength(6);
  });

  it('is not reachable: nothing can switch the form into it', async () => {
    await screen();
    const form = container.querySelector('form');
    expect(form?.classList.contains('d-two')).toBe(false);
    /* `.d-form.d-two .d-step1{display:none}` is the only thing in the design
       that shows the step, so a source with no `d-two` in it has no path to
       it at all — whatever a server were to answer. */
    expect(CODE).not.toContain('d-two');
  });

  it('is hidden from the page, not merely styled away', async () => {
    await screen();
    const step = container.querySelector('.d-step2') as HTMLElement | null;
    /* The stylesheet is not loaded in a test, and it will not be loaded in a
       screen reader either: the attribute is what keeps the six boxes out of
       the tab order and out of the accessibility tree. */
    expect(step?.hasAttribute('hidden')).toBe(true);
    expect(step?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the rest of the form', () => {
  it('asks for a work email and a password, and remembers you by default', async () => {
    await screen();
    expect(text()).toContain('Use your work email and your password.');
    expect((container.querySelector('#v2-login-email') as HTMLInputElement).type).toBe('email');
    const keep = container.querySelector('.d-check input') as HTMLInputElement;
    expect(keep.checked).toBe(true);
  });

  it('sends exactly what the live screen sends', async () => {
    await screen();
    const email = container.querySelector('#v2-login-email') as HTMLInputElement;
    const password = container.querySelector('#v2-login-password') as HTMLInputElement;
    await act(async () => {
      email.value = 'dana@homes.me';
      email.dispatchEvent(new Event('input', { bubbles: true }));
      password.value = 'a-real-password';
      password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(asked).toContain('POST /api/auth/login');
  });

  it('says what the server said, so a locked account explains itself', async () => {
    /* The lockout after five bad attempts is the server's message, and the
       live screen shows it verbatim. This one must too, or an agent who is
       locked out sees "wrong password" and keeps trying. */
    vi.stubGlobal('fetch', async (pathname: string, init?: RequestInit) => {
      asked.push(`${init?.method ?? 'GET'} ${pathname}`);
      if (pathname === '/api/auth/login') {
        return {
          ok: false,
          status: 429,
          text: async () => JSON.stringify({
            error: { code: 'locked', message: 'Too many attempts. Try again in 15 minutes.' },
          }),
        } as unknown as Response;
      }
      if (pathname === '/api/auth/me') {
        return {
          ok: false, status: 401,
          text: async () => JSON.stringify({ error: { code: 'unauthorized', message: 'no' } }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ needed: false }) } as unknown as Response;
    });

    await screen();
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(text()).toContain('Too many attempts. Try again in 15 minutes.');
    /* And the design's own `.form.bad` class, which is what shows the banner. */
    expect(container.querySelector('form')?.classList.contains('d-bad')).toBe(true);
  });

  it('points at an admin for a forgotten password, and emails nothing', async () => {
    await screen();
    const forgot = [...container.querySelectorAll('button')]
      .find((one) => one.textContent === 'Forgot password?');
    expect(forgot).toBeDefined();
    await act(async () => { forgot?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(text()).toContain('Ask the owner or an admin');
    expect(asked).not.toContain('POST /api/auth/magic-link');
    /* The live `/login` offers "Email me a sign-in link". The design has no
       such button, so this screen does not. */
    expect(text()).not.toContain('Email me a sign-in link');
  });
});

describe('a signed-out visitor', () => {
  it('lands on /v2/login from any v2 address', async () => {
    await mount(
      <MemoryRouter initialEntries={['/v2/leads']}><App /></MemoryRouter>,
    );
    /* The v2 screen, not the live one: the brand panel's headline is the
       quickest thing to tell them apart. */
    expect(text()).toContain('Every lead called.');
    expect(container.querySelector('.p-login')).not.toBeNull();
  });

  it('still lands on the live /login from everywhere else', async () => {
    await mount(
      <MemoryRouter initialEntries={['/dashboard']}><App /></MemoryRouter>,
    );
    /* `/login` is the screen ten people use every morning and it is untouched:
       its own sign-in-link button is how we know it is the one rendering. */
    expect(text()).toContain('Email me a sign-in link');
    expect(container.querySelector('.p-login')).toBeNull();
  });
});
