import { describe, expect, it } from 'vitest';
import { buildVCard, escapeValue, foldLine, vcardFilename } from './vcard.js';

const basic = {
  fullName: 'Layla Hassan',
  jobTitle: 'Property Consultant',
  company: 'Emigeo Homes Real Estate LLC',
  phone: '+971501234567',
  email: 'layla@emigeohomes.ae',
};

describe('the card a client saves to their phone', () => {
  const card = buildVCard(basic);

  it('is a vCard a phone will open', () => {
    expect(card.startsWith('BEGIN:VCARD\r\nVERSION:3.0')).toBe(true);
    expect(card.trimEnd().endsWith('END:VCARD')).toBe(true);
  });

  it('uses CRLF, which some phones genuinely insist on', () => {
    expect(card).toContain('\r\n');
    expect(card.split('\r\n').length).toBeGreaterThan(5);
  });

  it('carries the name both ways round, which is what N and FN are for', () => {
    expect(card).toContain('FN:Layla Hassan');
    expect(card).toContain('N:Hassan;Layla;;;');
  });

  it('handles a three-part name', () => {
    expect(buildVCard({ ...basic, fullName: 'Sara Al Mansoori' }))
      .toContain('N:Mansoori;Sara Al;;;');
  });

  it('handles a one-word name without producing a broken line', () => {
    expect(buildVCard({ ...basic, fullName: 'Layla' })).toContain('N:;Layla;;;');
  });

  it('carries the number, the email and the company', () => {
    expect(card).toContain('TEL;TYPE=CELL,VOICE:+971501234567');
    expect(card).toContain('EMAIL;TYPE=INTERNET,WORK:layla@emigeohomes.ae');
    expect(card).toContain('ORG:Emigeo Homes Real Estate LLC');
    expect(card).toContain('TITLE:Property Consultant');
  });

  it('leaves out what is not there rather than writing empty lines', () => {
    const bare = buildVCard({ fullName: 'Omar Haddad' });
    expect(bare).not.toContain('ORG:');
    expect(bare).not.toContain('TEL');
    expect(bare).not.toContain('EMAIL');
  });

  it('does not write the same number twice', () => {
    /* The same number as both phone and WhatsApp shows as a duplicate on
       the client's contact card. */
    const same = buildVCard({ ...basic, whatsapp: '+971501234567' });
    expect((same.match(/TEL/g) ?? [])).toHaveLength(1);
  });

  it('writes a second number when it really is different', () => {
    const two = buildVCard({ ...basic, whatsapp: '+971509999999' });
    expect((two.match(/TEL/g) ?? [])).toHaveLength(2);
  });
});

describe('values that would otherwise break the card', () => {
  it('escapes a comma in a company name', () => {
    expect(escapeValue('Emigeo Homes, LLC')).toBe('Emigeo Homes\\, LLC');
  });

  it('escapes a semicolon, which separates fields', () => {
    expect(escapeValue('a;b')).toBe('a\;b');
  });

  it('escapes a backslash before anything else, so it is not double-escaped', () => {
    expect(escapeValue('a\\b')).toBe('a\\\\b');
  });

  it('turns a newline into the escape the format expects', () => {
    expect(escapeValue('line one\nline two')).toBe('line one\\nline two');
  });

  it('keeps a card with a comma in it valid', () => {
    const card = buildVCard({ ...basic, company: 'Emigeo Homes, LLC' });
    expect(card).toContain('ORG:Emigeo Homes\\, LLC');
    expect(card.trimEnd().endsWith('END:VCARD')).toBe(true);
  });
});

describe('folding a long line', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('NOTE:short')).toBe('NOTE:short');
  });

  it('leaves a line of exactly the limit alone', () => {
    const exact = 'A'.repeat(75);
    expect(foldLine(exact)).toBe(exact);
  });

  it('breaks a long line and continues it with a space', () => {
    const folded = foldLine(`NOTE:${'A'.repeat(200)}`);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).every((line) => line.startsWith(' '))).toBe(true);
    expect(lines.every((line) => line.length <= 75)).toBe(true);
  });

  it('loses nothing when it folds', () => {
    const original = `NOTE:${'B'.repeat(300)}`;
    const rebuilt = foldLine(original).split('\r\n').map((l, i) => (i === 0 ? l : l.slice(1))).join('');
    expect(rebuilt).toBe(original);
  });

  it('folds a long bio in a real card', () => {
    const card = buildVCard({ ...basic, note: 'C'.repeat(400) });
    expect(card.split('\r\n').every((line) => line.length <= 75)).toBe(true);
  });
});

describe('what the file is called', () => {
  it('is the person’s name, as a filename', () => {
    expect(vcardFilename('Layla Hassan')).toBe('layla-hassan.vcf');
  });

  it('copes with punctuation and non-latin names', () => {
    expect(vcardFilename('Sara Al-Mansoori')).toBe('sara-al-mansoori.vcf');
    expect(vcardFilename('سارة')).toBe('contact.vcf');
  });
});
