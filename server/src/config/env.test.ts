import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  DB_HOST: '127.0.0.1',
  DB_USER: 'emir',
  DB_PASSWORD: 'x',
  DB_NAME: 'emir_crm',
};

/** A production environment that is otherwise valid, so one test fails at a time. */
const prod = { ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true' };

describe('the fake WhatsApp provider in production', () => {
  /**
   * A production server that swallows every WhatsApp message silently is the
   * worst of both worlds: it looks like it is working. An agent sees the
   * welcome in the inbox and does not call a lead who was never contacted.
   */
  it('refuses to start', () => {
    expect(() => loadEnv({ ...prod, WHATSAPP_PROVIDER: 'log' } as never)).toThrow(
      /never sends anything/,
    );
  });

  it('starts when the owner opts in explicitly', () => {
    // Running without WhatsApp is a legitimate choice — imports and calls work
    // long before a number is approved. It just has to be a decision.
    const env = loadEnv({
      ...prod,
      WHATSAPP_PROVIDER: 'log',
      ALLOW_FAKE_WHATSAPP: '1',
    } as never);
    expect(env.ALLOW_FAKE_WHATSAPP).toBe(true);
  });

  it('starts with a real provider, override or not', () => {
    expect(() =>
      loadEnv({ ...prod, WHATSAPP_PROVIDER: 'cloud' } as never),
    ).not.toThrow();
  });

  it('leaves development alone', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development', WHATSAPP_PROVIDER: 'log' } as never)).not.toThrow();
    expect(() => loadEnv({ ...base, NODE_ENV: 'test', WHATSAPP_PROVIDER: 'log' } as never)).not.toThrow();
  });

  it('names the setting that unblocks it, not just the problem', () => {
    try {
      loadEnv({ ...prod, WHATSAPP_PROVIDER: 'log' } as never);
      throw new Error('expected it to refuse');
    } catch (err) {
      expect(String(err)).toContain('ALLOW_FAKE_WHATSAPP');
    }
  });
});

describe('the session cookie in production', () => {
  /**
   * Without Secure the cookie rides a plain-http request, and helmet's HSTS is
   * the only thing that would have stopped the browser making one. Neither is
   * worth leaving to a checklist.
   */
  it('refuses to start when COOKIE_SECURE is off', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', WHATSAPP_PROVIDER: 'cloud' } as never)).toThrow(
      /COOKIE_SECURE/,
    );
  });

  it('says what to do about it, not just what is wrong', () => {
    try {
      loadEnv({ ...base, NODE_ENV: 'production', WHATSAPP_PROVIDER: 'cloud' } as never);
      throw new Error('expected it to refuse');
    } catch (err) {
      expect(String(err)).toContain('HTTPS');
    }
  });

  it('leaves development alone, where the CRM is served over http', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development' } as never)).not.toThrow();
    expect(() => loadEnv({ ...base, NODE_ENV: 'test' } as never)).not.toThrow();
  });
});
