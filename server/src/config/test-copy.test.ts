import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setEnvForTesting } from './env.js';
import { isTestCopy, refuseOutbound } from './test-copy.js';

/**
 * The test copy must not be able to reach a real person.
 *
 * `newcrm.emirdulovic.com` runs this code against a copy of the live
 * database, which is a copy of every client's real phone number. The thing
 * that goes wrong is not a missing key — it is a key pasted into the wrong
 * site at eleven at night. So the refusal is unconditional, and these tests
 * are what stop somebody removing it later for a good-sounding reason.
 */

const SRC = join(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(join(SRC, p), 'utf8');

afterEach(() => setEnvForTesting(null));

function asTestCopy(): void {
  setEnvForTesting({ IS_TEST_COPY: true } as never);
}

describe('the test copy refuses to send', () => {
  it('is off unless it is switched on', () => {
    setEnvForTesting({ IS_TEST_COPY: false } as never);
    expect(isTestCopy()).toBe(false);
    expect(refuseOutbound('whatsapp', '+971500000001')).toBe(false);
  });

  it('refuses every channel when it is on', () => {
    asTestCopy();
    expect(isTestCopy()).toBe(true);
    for (const channel of ['whatsapp', 'email', 'push', 'sms'] as const) {
      expect(refuseOutbound(channel, '+971500000001'), channel).toBe(true);
    }
  });

  it('keeps the whole number out of the log', () => {
    asTestCopy();
    /* The log line is read over somebody's shoulder in a hosting panel. Four
       digits is enough to recognise a send; the rest is a client's number. */
    const logged: unknown[] = [];
    const before = console.warn;
    console.warn = (...args: unknown[]) => { logged.push(...args); };
    try {
      refuseOutbound('whatsapp', '+971501234567');
    } finally {
      console.warn = before;
    }
    const text = JSON.stringify(logged);
    expect(text).not.toContain('+971501234567');
    expect(text).not.toContain('97150123');
  });
});

/*
 * The three doors out of the server, checked by reading the source.
 *
 * A unit test proves `refuseOutbound` says no. It cannot prove anybody calls
 * it, and the mistake that matters is a send path that forgot to ask. So this
 * reads the files instead — the same trick as hook-order and schema-map, and
 * it exists for the same reason: those caught real bugs.
 */
describe('every way out of the server asks first', () => {
  it('WhatsApp asks before it sends', () => {
    const src = read('messaging/send.ts');
    expect(src).toContain("refuseOutbound('whatsapp'");
    /* Before the consent and quiet-hours guards, not after: this refusal is
       not about the contact, and must not be reachable only on the happy
       path through them. */
    expect(src.indexOf("refuseOutbound('whatsapp'")).toBeLessThan(src.indexOf('evaluateGuards('));
  });

  it('push asks before it sends', () => {
    expect(read('messaging/push.ts')).toContain("refuseOutbound('push'");
  });

  it('email hands back a provider that cannot send', () => {
    const src = read('email/provider.ts');
    /* Inside the factory, so no call site can bypass it by holding a provider
       it fetched earlier -- and the whole file is not the factory, which is
       what the first version of this test compared and got wrong. */
    const factory = src.slice(src.indexOf('export function emailProvider('));
    expect(factory).toContain('IS_TEST_COPY');
    expect(factory.indexOf('IS_TEST_COPY'))
      .toBeLessThan(factory.indexOf('FEATURE_EMAIL_SENDING'));
  });
});
