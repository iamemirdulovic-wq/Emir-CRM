import { describe, expect, it } from 'vitest';
import { __test } from './Wall.js';

const { asMedia, sameOrigin } = __test;

/**
 * A wall post's media column is JSON, so it is whatever is in the row: what
 * this CRM wrote today, what it wrote a year ago, and anything a future
 * import puts there. It ends up in an <img src>, which is the part that
 * matters — an off-site url in an <img> tells that site who opened the post,
 * from which city and on what device, with nobody having clicked anything.
 */
describe('wall post media', () => {
  it('takes a path on our own origin', () => {
    expect(sameOrigin('/api/wall/media/abc123')).toBe(true);
    expect(sameOrigin('/preview/sample.svg')).toBe(true);
  });

  it('refuses anything that leaves the origin', () => {
    expect(sameOrigin('https://tracker.example/pixel.gif')).toBe(false);
    // Protocol-relative: the browser fills in the scheme and goes off-site.
    expect(sameOrigin('//tracker.example/pixel.gif')).toBe(false);
    expect(sameOrigin('javascript:alert(1)')).toBe(false);
    expect(sameOrigin('data:image/svg+xml,<svg/>')).toBe(false);
    expect(sameOrigin('')).toBe(false);
  });

  it('reads a normal list', () => {
    expect(asMedia([{ id: 'm1', url: '/api/wall/media/m1', name: 'Launch.jpg' }]))
      .toEqual([{ id: 'm1', url: '/api/wall/media/m1', kind: 'image', name: 'Launch.jpg' }]);
  });

  it('survives a column holding something else entirely', () => {
    // Every one of these is a shape a JSON column can legally hold.
    expect(asMedia(null)).toEqual([]);
    expect(asMedia('a string')).toEqual([]);
    expect(asMedia({})).toEqual([]);
    expect(asMedia([null, 3, 'x', {}])).toEqual([]);
  });

  it('drops the off-site rows and keeps the rest', () => {
    const read = asMedia([
      { url: 'https://tracker.example/p.gif' },
      { id: 'm2', url: '/api/wall/media/m2' },
    ]);
    expect(read.map((row) => row.url)).toEqual(['/api/wall/media/m2']);
  });

  it('names a row that arrived without one', () => {
    expect(asMedia([{ url: '/api/wall/media/m3' }])[0]?.name).toBe('Picture');
  });

  it('stops at eight, whatever the row says', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ url: `/api/wall/media/m${i}` }));
    expect(asMedia(many)).toHaveLength(8);
  });
});
