import { describe, expect, it } from 'vitest';
import { PX_PER_MM_300, faces, fileName, slugify } from './export.js';
import { BLEED, DEFAULT_DETAILS, DEFAULT_OPTIONS, SIZES } from './artboard.js';
import { TEMPLATES } from './brand.js';

const input = {
  template: TEMPLATES.signature,
  details: { ...DEFAULT_DETAILS, fullName: 'Emir Dulovic' },
  options: { ...DEFAULT_OPTIONS },
};

describe('file names', () => {
  it('are readable and safe on every operating system', () => {
    expect(fileName('front', 'Emir Dulovic', 'jpg')).toBe('homes-me-card-emir-dulovic-front.jpg');
    expect(fileName('', 'Emir Dulovic', 'pdf')).toBe('homes-me-card-emir-dulovic.pdf');
  });

  it('cope with a name that is all punctuation', () => {
    expect(slugify('!!!')).toBe('card');
  });

  it('cope with an Arabic name rather than producing an empty file name', () => {
    expect(fileName('back', 'أحمد', 'png')).toBe('homes-me-card-card-back.png');
  });
});

describe('what gets exported', () => {
  it('never carries the safe-area guides, even if they are on screen', () => {
    const shown = { ...input, options: { ...DEFAULT_OPTIONS, showSafeArea: true } };
    const { front, back } = faces(shown);
    expect(front).not.toContain('stroke-dasharray');
    expect(back).not.toContain('stroke-dasharray');
  });

  it('exports both sides', () => {
    const { front, back } = faces(input);
    expect(front).toContain('<svg');
    expect(back).toContain('Scan to WhatsApp');
  });
});

describe('the pixel sizes the brief asks for', () => {
  it('is 1075 × 720 at 300 DPI, and double that at 2×', () => {
    const { w, h } = SIZES.uae;
    const width = Math.round((w + BLEED * 2) * PX_PER_MM_300);
    const height = Math.round((h + BLEED * 2) * PX_PER_MM_300);
    expect([width, height]).toEqual([1075, 720]);
    expect([width * 2, height * 2]).toEqual([2150, 1440]);
  });
});

describe('the print PDF leaves the corners to the die-cutter', () => {
  it('keeps the artwork square even when rounded corners are on', () => {
    const { front, back } = faces(input, true);
    expect(front).not.toContain('clip-path');
    expect(back).not.toContain('clip-path');
  });

  it('still rounds them for the images, which is the card people picture', () => {
    const { front } = faces(input);
    expect(front).toContain('clip-path');
  });
});
