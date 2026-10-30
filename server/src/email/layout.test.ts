import { describe, expect, it } from 'vitest';
import { paragraphsToHtml, plainTextFallback, renderEmail, safeUrl, type Branding, type Sender } from './layout.js';

const sender: Sender = {
  name: 'Layla Hassan',
  title: 'Property Consultant',
  phone: '+971 50 123 4567',
  email: 'layla@emigeohomes.ae',
  brn: '48219',
};

const branding: Branding = {
  companyName: 'Emigeo Homes',
  companyLegalName: 'Emigeo Homes Real Estate LLC',
  licenceNo: '1120345',
};

const render = (extra: Partial<Parameters<typeof renderEmail>[0]> = {}) =>
  renderEmail({ bodyHtml: '<p>Hello</p>', sender, branding, ...extra });

describe('the wrapper every client email goes out in', () => {
  it('puts the body inside it', () => {
    expect(render()).toContain('<p>Hello</p>');
  });

  it('carries the agent’s name and number, because that is who gets replied to', () => {
    const html = render();
    expect(html).toContain('Layla Hassan');
    expect(html).toContain('+971 50 123 4567');
    expect(html).toContain('tel:+971501234567');
  });

  it('shows the BRN, which a UAE broker must put on client mail', () => {
    expect(render()).toContain('BRN 48219');
  });

  it('shows the legal name and licence in the footer', () => {
    const html = render();
    expect(html).toContain('Emigeo Homes Real Estate LLC');
    expect(html).toContain('Licence 1120345');
  });

  it('falls back to the trading name when no legal name is set', () => {
    const html = renderEmail({
      bodyHtml: '<p>Hi</p>', sender, branding: { companyName: 'Emigeo Homes' },
    });
    expect(html).toContain('Emigeo Homes');
  });

  it('is a table, because that is the only layout email clients agree on', () => {
    expect(render()).toContain('role="presentation"');
    expect(render()).not.toContain('display:flex');
  });

  it('has a plain-text preview line when one is given, hidden from the body', () => {
    const html = render({ previewText: 'Three units left at Beachfront' });
    expect(html).toContain('Three units left at Beachfront');
    expect(html).toContain('display:none');
  });
});

describe('the unsubscribe link', () => {
  it('appears when there is one', () => {
    const html = render({ unsubscribeUrl: 'https://crm.homes.me/u/abc123' });
    expect(html).toContain('https://crm.homes.me/u/abc123');
    expect(html).toContain('Unsubscribe');
  });

  it('is left out entirely for a one-to-one reply', () => {
    expect(render()).not.toContain('Unsubscribe');
  });

  it('refuses a javascript: link, which is how a phishing link gets in', () => {
    const html = render({ unsubscribeUrl: 'javascript:alert(1)' });
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Unsubscribe');
  });
});

describe('what a hostile value cannot do', () => {
  it('cannot break out of the accent colour into its own style', () => {
    const html = renderEmail({
      bodyHtml: '<p>Hi</p>',
      sender,
      branding: { ...branding, accent: '#fff" onload="alert(1)' },
    });
    expect(html).not.toContain('onload');
    /* Falls back to the CRM's own teal rather than rendering nothing. */
    expect(html).toContain('#0AA3BA');
  });

  it('accepts a real hex accent', () => {
    expect(renderEmail({ bodyHtml: '<p>Hi</p>', sender, branding: { ...branding, accent: '#FF6A3D' } }))
      .toContain('#FF6A3D');
  });

  it('escapes an agent name that contains markup, leaving it inert text', () => {
    const html = renderEmail({
      bodyHtml: '<p>Hi</p>',
      sender: { ...sender, name: '<img src=x onerror=alert(1)>' },
      branding,
    });
    /* The characters survive — they are the person's name as typed — but as
       text, not as a tag. No `<img` is ever emitted, so nothing can fire. */
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });

  it('refuses a photo URL that is not http(s)', () => {
    const html = renderEmail({
      bodyHtml: '<p>Hi</p>', sender: { ...sender, photoUrl: 'javascript:alert(1)' }, branding,
    });
    expect(html).not.toContain('javascript:');
  });

  it('allows a real photo URL', () => {
    expect(renderEmail({
      bodyHtml: '<p>Hi</p>', sender: { ...sender, photoUrl: 'https://cdn.example.com/a.jpg' }, branding,
    })).toContain('https://cdn.example.com/a.jpg');
  });
});

describe('judging a URL', () => {
  it('accepts http and https', () => {
    expect(safeUrl('https://a.test/x')).toBe('https://a.test/x');
    expect(safeUrl('http://a.test/x')).toBe('http://a.test/x');
  });

  it('rejects anything else, including nothing at all', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<script>')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl('')).toBeNull();
  });
});

describe('the tracking pixel', () => {
  it('is there when tracking is on', () => {
    expect(render({ trackingPixelUrl: 'https://crm.homes.me/e/o/abc.gif' }))
      .toContain('https://crm.homes.me/e/o/abc.gif');
  });

  it('is absent when it is off', () => {
    expect(render()).not.toContain('width="1"');
  });
});

describe('the plain-text alternative', () => {
  const text = plainTextFallback({ bodyText: 'Hello there.', sender, branding });

  it('carries the body and the signature', () => {
    expect(text).toContain('Hello there.');
    expect(text).toContain('Layla Hassan');
    expect(text).toContain('BRN 48219');
  });

  it('has no HTML in it at all', () => {
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it('includes the unsubscribe address as a readable URL', () => {
    expect(plainTextFallback({
      bodyText: 'Hi', sender, branding, unsubscribeUrl: 'https://crm.homes.me/u/abc',
    })).toContain('Unsubscribe: https://crm.homes.me/u/abc');
  });
});

describe('turning what the agent typed into HTML', () => {
  it('makes a paragraph of each block', () => {
    expect(paragraphsToHtml('One.\n\nTwo.')).toContain('<p style="margin:0 0 14px">One.</p>');
    expect(paragraphsToHtml('One.\n\nTwo.')).toContain('Two.');
  });

  it('keeps a single line break inside a paragraph', () => {
    expect(paragraphsToHtml('Line one\nLine two')).toContain('Line one<br>Line two');
  });

  it('escapes what the agent typed, so a stray < does not eat the email', () => {
    expect(paragraphsToHtml('Budget < 2M')).toContain('Budget &lt; 2M');
  });

  it('drops empty blocks rather than making empty paragraphs', () => {
    expect(paragraphsToHtml('One.\n\n\n\nTwo.').match(/<p /g)).toHaveLength(2);
  });
});
