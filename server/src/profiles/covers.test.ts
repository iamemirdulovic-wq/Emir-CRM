import { describe, expect, it } from 'vitest';
import { COVERS, cover, renderCover } from './covers.js';

describe('the covers that ship with the CRM', () => {
  it('offers six, so a team of ten does not all pick the same one', () => {
    expect(COVERS).toHaveLength(6);
  });

  it('gives each a unique key and a readable name', () => {
    const keys = COVERS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of COVERS) {
      expect(item.name.length).toBeGreaterThan(4);
      expect(item.key).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('falls back to the first rather than failing on an unknown key', () => {
    expect(cover('nope').key).toBe(COVERS[0]?.key);
    expect(cover(null).key).toBe(COVERS[0]?.key);
    expect(cover(undefined).key).toBe(COVERS[0]?.key);
  });
});

describe('drawing one', () => {
  const svg = renderCover('marina-dusk');

  it('is an SVG with the right viewBox', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 1200 320"');
  });

  it('contains no photograph and fetches nothing', () => {
    /*
     * A stock skyline is either licensed or stolen; this is neither. The
     * w3.org URL is the SVG namespace — required markup, and never fetched —
     * so what is checked is that nothing *loads* from anywhere.
     */
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('xlink:href');
    expect(svg).not.toContain('data:image');
    expect(svg).not.toMatch(/url\(["']?https?:/);
    const urls = svg.match(/https?:\/\/[^"']+/g) ?? [];
    expect(urls).toEqual(['http://www.w3.org/2000/svg']);
  });

  it('draws a tower for every entry in the skyline', () => {
    const design = cover('marina-dusk');
    const towers = svg.match(/<rect [^>]*rx="2"/g) ?? [];
    expect(towers).toHaveLength(design.skyline.length);
  });

  it('is the same picture every time, so it does not flicker on reload', () => {
    expect(renderCover('marina-dusk')).toBe(svg);
    expect(renderCover('downtown-night')).toBe(renderCover('downtown-night'));
  });

  it('draws a different picture for a different cover', () => {
    expect(renderCover('desert-gold')).not.toBe(svg);
  });

  it('lights windows only on the dark ones', () => {
    expect(renderCover('downtown-night')).toContain('#FFD9A0');
    expect(renderCover('saadiyat-day')).not.toContain('#FFD9A0');
  });

  it('scales to whatever size is asked for', () => {
    const small = renderCover('teal-calm', 400, 120);
    expect(small).toContain('viewBox="0 0 400 120"');
    expect(small).toContain('width="400"');
  });

  it('has a label, so a screen reader does not read it as nothing', () => {
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Marina at dusk"');
  });

  it('keeps the gradient id unique per cover, so two on one page do not collide', () => {
    expect(renderCover('marina-dusk')).toContain('skymarinadusk');
    expect(renderCover('desert-gold')).toContain('skydesertgold');
  });

  it('stays small enough to inline six on one page', () => {
    for (const item of COVERS) {
      expect(renderCover(item.key).length).toBeLessThan(12_000);
    }
  });
});
