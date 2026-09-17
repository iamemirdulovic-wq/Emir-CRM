import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv, setEnvForTesting } from '../../config/env.js';
import { LogAdapter, NOT_CONNECTED_MESSAGE } from './log.js';

const base = { DB_HOST: '127.0.0.1', DB_USER: 'emir', DB_PASSWORD: 'x', DB_NAME: 'emir_crm' };

function asEnv(nodeEnv: 'development' | 'production') {
  setEnvForTesting(
    loadEnv({
      ...base,
      NODE_ENV: nodeEnv,
      WHATSAPP_PROVIDER: 'log',
      // Both are what a production server running without WhatsApp must set.
      ...(nodeEnv === 'production' ? { ALLOW_FAKE_WHATSAPP: '1', COOKIE_SECURE: 'true' } : {}),
    } as never),
  );
}

afterEach(() => setEnvForTesting(null));

const send = () =>
  new LogAdapter().sendTemplate({
    toWaId: '971501234567',
    templateName: 'lead_welcome_en',
    language: 'en',
    bodyParams: [],
  } as never);

describe('the log provider', () => {
  it('reports success in development, so the whole system can be exercised', async () => {
    asEnv('development');
    const result = await send();
    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toMatch(/^log\./);
  });

  it('reports failure in production, because nothing was sent', async () => {
    // A message that never left the building must not wear a delivery tick.
    asEnv('production');
    const result = await send();
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('whatsapp_not_connected');
    expect(result.providerMessageId).toBeNull();
  });

  it('says what to do instead', async () => {
    asEnv('production');
    const result = await send();
    expect(result.errorMessage).toBe(NOT_CONNECTED_MESSAGE);
    expect(result.errorMessage).toMatch(/call or email/i);
  });
});
