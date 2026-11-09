import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { welcomeEmailHtml } from './welcome-email.js';

/**
 * The email carries a password. These check what actually ends up in it.
 *
 * `WELCOME_EMAIL_OUT` writes the rendered HTML to a file so it can be opened
 * in a browser and looked at; without it this is an ordinary unit test.
 */
describe('the welcome email itself', () => {
  const input = {
    name: 'Tej Solanki',
    email: 'tej@homes.me',
    temporaryPassword: 'Swift-Harbour-4821',
  };
  const html = welcomeEmailHtml(input, 'homes.me', 'https://mycrm.emirdulovic.com/login');

  it('greets them by their first name only', () => {
    expect(html).toContain('Welcome to the CRM, Tej.');
    expect(html).not.toContain('Tej Solanki,');
  });

  it('carries the address, the password and a way in', () => {
    expect(html).toContain('tej@homes.me');
    expect(html).toContain('Swift-Harbour-4821');
    expect(html).toContain('https://mycrm.emirdulovic.com/login');
  });

  it('tells them to change it and delete the email', () => {
    expect(html).toMatch(/pick your own password/i);
    expect(html).toMatch(/delete this email/i);
  });

  it('lists all five rules, numbered', () => {
    for (const n of ['1', '2', '3', '4', '5']) expect(html).toContain(`>${n}</div>`);
    expect(html).toMatch(/five minutes/i);
    expect(html).toMatch(/office Wi-Fi/i);
  });

  /* A staff email, not a campaign: nobody unsubscribes from being told how to
     log in to their own job, and we do not track whether they opened it. */
  it('has no unsubscribe link and no tracking pixel', () => {
    expect(html).not.toMatch(/unsubscribe/i);
    expect(html).not.toMatch(/<img/i);
  });

  /* A name or a password with a quote in it must not be able to close an
     attribute and write markup into somebody's inbox. */
  it('escapes what came from data', () => {
    const nasty = welcomeEmailHtml(
      { name: '"><script>x</script>', email: 'a@b.c', temporaryPassword: '<b>pw</b>' },
      'homes.me', 'https://example.com/login',
    );
    expect(nasty).not.toContain('<script>');
    expect(nasty).not.toContain('<b>pw</b>');
    expect(nasty).toContain('&lt;');
  });

  it('writes the file when asked', () => {
    const out = process.env.WELCOME_EMAIL_OUT;
    if (!out) return;
    writeFileSync(out, html, 'utf8');
    expect(html.length).toBeGreaterThan(500);
  });
});
