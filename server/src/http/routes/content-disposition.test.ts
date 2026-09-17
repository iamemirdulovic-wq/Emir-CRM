import { describe, expect, it } from 'vitest';
import { contentDisposition } from './tasks.js';

/**
 * Header values are Latin-1. These are the names that actually turn up in a
 * Dubai brokerage — Arabic, an em dash pasted from a listing, a quote in a
 * project name — and every one of them used to throw.
 */
describe('the Content-Disposition for a downloaded attachment', () => {
  it('keeps a plain ASCII name as it is', () => {
    expect(contentDisposition('attachment', 'floorplan.pdf')).toBe(
      `attachment; filename="floorplan.pdf"; filename*=UTF-8''floorplan.pdf`,
    );
  });

  it('carries an Arabic name in filename*, with an ASCII fallback', () => {
    const value = contentDisposition('attachment', 'مخطط.pdf');
    expect(value).toContain(`filename*=UTF-8''`);
    expect(value).toContain('%D9%85'); // the first letter, percent-encoded
    // The fallback holds no Arabic, so the header is Latin-1 throughout.
    expect(value.split(';')[1]).toBe(' filename="____.pdf"');
  });

  it('survives an em dash, which is what broke it', () => {
    const value = contentDisposition('inline', 'floor plan — level 14.png');
    expect(value).toContain('filename="floor plan _ level 14.png"');
    expect(value).toContain('%E2%80%94');
  });

  it('is always a header value Node will accept', () => {
    for (const name of ['مخطط.pdf', 'floor plan — 14.png', 'naïve.png', '“quoted”.pdf', '日本語.png']) {
      // Latin-1 is every code point below 256; anything above would throw.
      for (const char of contentDisposition('attachment', name)) {
        expect(char.charCodeAt(0)).toBeLessThan(256);
      }
    }
  });

  it('cannot be escaped out of the quoted string', () => {
    const value = contentDisposition('attachment', 'a"; drop.pdf');
    // The injected quote is gone, so the filename stays one value.
    expect(value.split('"').length - 1).toBe(2);
  });

  it('strips a newline rather than splitting the header', () => {
    expect(contentDisposition('attachment', 'a\r\nX-Evil: 1.pdf')).not.toMatch(/[\r\n]/);
  });

  it('percent-encodes the characters RFC 5987 does not allow', () => {
    const value = contentDisposition('attachment', "it's (a) file!.pdf");
    expect(value).toContain('%27');
    expect(value).toContain('%28');
    expect(value).toContain('%21');
  });

  it('never leaves the fallback empty', () => {
    expect(contentDisposition('attachment', '""')).toContain('filename="file"');
  });
});
