/**
 * Signing in over HTTP in a test.
 *
 * Route tests that only call the service layer prove the service is right and
 * say nothing about whether the route in front of it checks anything. These
 * helpers make it cheap to test the real request, cookie and all.
 */
import type { TestUser } from './db.js';

/** The password `createTestUser` sets. */
export const TEST_PASSWORD = 'test-password-1';

/**
 * Sign in and return the Cookie header to send on later requests.
 *
 * Throws rather than returning an empty string on failure: a test that
 * silently went on unauthenticated would pass for the wrong reason.
 */
export async function signIn(base: string, user: TestUser, password = TEST_PASSWORD): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${user.email}: ${res.status} ${await res.text()}`);

  const header = res.headers.getSetCookie?.() ?? [];
  const cookie = header.map((line) => line.split(';')[0]).join('; ');
  if (!cookie) throw new Error(`sign-in for ${user.email} returned no cookie`);
  return cookie;
}
