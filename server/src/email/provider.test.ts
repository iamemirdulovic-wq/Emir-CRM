import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrevoProvider, NullProvider, SmtpProvider, applyTestMode, emailProvider, emailReadiness,
  setProviderForTesting, type OutboundEmail,
} from './provider.js';
import { setEnvForTesting } from '../config/env.js';

const MESSAGE: OutboundEmail = {
  to: 'client@example.com',
  from: 'layla@emigeohomes.ae',
  fromName: 'Layla Hassan',
  subject: 'Emaar Beachfront — the two units we discussed',
  html: '<p>Hello</p>',
  text: 'Hello',
};

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  setEnvForTesting(null);
}

beforeEach(() => {
  setEnv({
    FEATURE_EMAIL_SENDING: undefined,
    EMAIL_PROVIDER: undefined,
    EMAIL_TEST_MODE: undefined,
    EMAIL_TEST_REDIRECT: undefined,
    BREVO_API_KEY: undefined,
    RESEND_API_KEY: undefined,
    SMTP_HOST: undefined,
    MAIL_FROM: undefined,
  });
  setProviderForTesting(null);
});

afterEach(() => {
  setProviderForTesting(null);
  setEnvForTesting(null);
});

describe('the off switch', () => {
  it('is off unless it is deliberately turned on', () => {
    expect(emailProvider().name).toBe('none');
  });

  it('stays off even when a provider key is sitting in the environment', () => {
    /* A key in .env is not consent to email clients. */
    setEnv({ EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'xkeysib-real-looking-key' });
    expect(emailProvider().name).toBe('none');
  });

  it('sends nothing, and says why, rather than failing silently', async () => {
    const result = await new NullProvider().send(MESSAGE);
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/switched off/i);
    expect(result.retryable).toBe(false);
  });

  it('turns on only with the flag', () => {
    setEnv({ FEATURE_EMAIL_SENDING: 'true', EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k' });
    expect(emailProvider().name).toBe('brevo');
  });

  it('falls back to sending nothing when the chosen provider has no key', () => {
    setEnv({ FEATURE_EMAIL_SENDING: 'true', EMAIL_PROVIDER: 'brevo' });
    expect(emailProvider().name).toBe('none');
  });

  it('falls back to sending nothing when SMTP has no host', () => {
    setEnv({ FEATURE_EMAIL_SENDING: 'true', EMAIL_PROVIDER: 'smtp' });
    expect(emailProvider(null).name).toBe('none');
  });
});

describe('test mode', () => {
  it('leaves a message alone when it is off', () => {
    const { message, redirected } = applyTestMode(MESSAGE);
    expect(redirected).toBe(false);
    expect(message.to).toBe('client@example.com');
  });

  it('redirects every message to the one address', () => {
    setEnv({ EMAIL_TEST_MODE: 'true', EMAIL_TEST_REDIRECT: 'emir@emigeohomes.ae' });
    const { message, redirected } = applyTestMode(MESSAGE);
    expect(redirected).toBe(true);
    expect(message.to).toBe('emir@emigeohomes.ae');
  });

  it('keeps the real recipient visible, so a test inbox can be read', () => {
    setEnv({ EMAIL_TEST_MODE: 'true', EMAIL_TEST_REDIRECT: 'emir@emigeohomes.ae' });
    const { message } = applyTestMode(MESSAGE);
    expect(message.subject).toBe(
      '[TEST → client@example.com] Emaar Beachfront — the two units we discussed',
    );
    expect(message.headers?.['X-Emir-Real-Recipient']).toBe('client@example.com');
  });

  it('refuses to send at all when test mode has nowhere to redirect to', () => {
    /* The safe reading of a half-configured test mode is "do not send",
       never "send it to the client". */
    setEnv({ EMAIL_TEST_MODE: 'true' });
    expect(() => applyTestMode(MESSAGE)).toThrow(/EMAIL_TEST_REDIRECT/);
  });
});

describe('SMTP', () => {
  it('passes the message through and returns the id', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<abc@mail>' });
    const result = await new SmtpProvider({ sendMail }).send(MESSAGE);
    expect(result).toMatchObject({ sent: true, provider: 'smtp', providerMessageId: '<abc@mail>' });
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      to: 'client@example.com',
      subject: MESSAGE.subject,
      html: '<p>Hello</p>',
      text: 'Hello',
    });
  });

  it('names the sender when there is a name', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'x' });
    await new SmtpProvider({ sendMail }).send(MESSAGE);
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      from: '"Layla Hassan" <layla@emigeohomes.ae>',
    });
  });

  it('reports a refusal without throwing', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('550 mailbox unavailable'));
    const result = await new SmtpProvider({ sendMail }).send(MESSAGE);
    expect(result.sent).toBe(false);
    expect(result.reason).toContain('550');
    expect(result.retryable).toBe(false);
  });

  it('marks a dropped connection as worth retrying', async () => {
    const sendMail = vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    expect((await new SmtpProvider({ sendMail }).send(MESSAGE)).retryable).toBe(true);
  });
});

describe('Brevo', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('sends and returns the provider’s id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 201, json: async () => ({ messageId: '<brevo-1>' }),
    }) as never;
    const result = await new BrevoProvider('key').send(MESSAGE);
    expect(result).toMatchObject({ sent: true, provider: 'brevo', providerMessageId: '<brevo-1>' });
  });

  it('does not retry our own mistake', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 400, text: async () => 'bad request',
    }) as never;
    const result = await new BrevoProvider('key').send(MESSAGE);
    expect(result.sent).toBe(false);
    expect(result.retryable).toBe(false);
  });

  it('retries their outage and their rate limit', async () => {
    for (const status of [500, 503, 429]) {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status, text: async () => '' }) as never;
      expect((await new BrevoProvider('key').send(MESSAGE)).retryable).toBe(true);
    }
  });

  it('treats an unreachable provider as worth retrying', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as never;
    expect((await new BrevoProvider('key').send(MESSAGE)).retryable).toBe(true);
  });

  it('never puts the API key anywhere but the header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    globalThis.fetch = fetchMock as never;
    await new BrevoProvider('xkeysib-secret').send(MESSAGE);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['api-key']).toBe('xkeysib-secret');
    expect(String(init.body)).not.toContain('xkeysib-secret');
  });
});

describe('what the Settings screen is told', () => {
  it('says plainly that sending is off', () => {
    expect(emailReadiness()).toMatchObject({ sendingOn: false, testMode: false });
  });

  it('warns when a provider is chosen but not configured', () => {
    setEnv({ EMAIL_PROVIDER: 'brevo', MAIL_FROM: 'hello@emigeohomes.ae' });
    expect(emailReadiness().problems).toContain('Brevo is selected but there is no API key.');
  });

  it('warns loudly when live sending is on', () => {
    setEnv({
      FEATURE_EMAIL_SENDING: 'true', EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'k', MAIL_FROM: 'hello@emigeohomes.ae',
    });
    expect(emailReadiness().problems).toContain('Sending is live: emails go to real clients.');
  });

  it('does not warn about live sending while test mode holds it back', () => {
    setEnv({
      FEATURE_EMAIL_SENDING: 'true', EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k',
      MAIL_FROM: 'hello@emigeohomes.ae', EMAIL_TEST_MODE: 'true',
      EMAIL_TEST_REDIRECT: 'emir@emigeohomes.ae',
    });
    expect(emailReadiness().problems).toEqual([]);
  });

  it('never returns the API key itself', () => {
    setEnv({ EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'xkeysib-secret', MAIL_FROM: 'a@b.ae' });
    expect(JSON.stringify(emailReadiness())).not.toContain('xkeysib-secret');
  });
});
