import { describe, expect, it } from 'vitest';
import {
  BLEED, CORNER_RADIUS, DEFAULT_DETAILS, DEFAULT_OPTIONS, SAFE, SIZES,
  nameFontPt, nameOverflows, qrTarget, renderFace, splitName, titleLine,
  NAME_PT_MAX, NAME_PT_MIN, type CardDetails,
} from './artboard.js';
import { TEMPLATES, TEMPLATE_ORDER } from './brand.js';
import { LOGO } from './logo.js';

const details: CardDetails = {
  ...DEFAULT_DETAILS,
  fullName: 'Emir Dulovic',
  jobTitle: 'Founder',
  brn: '00000',
  phone: '+971 58 592 3565',
  whatsapp: '+971 58 592 3565',
  email: 'emir@homes.me',
};

const face = (over = {}) => renderFace({
  template: TEMPLATES.signature, details, options: { ...DEFAULT_OPTIONS }, side: 'back', ...over,
});

describe('the artboard is the size the printer expects', () => {
  it('is the trim size plus bleed on every edge', () => {
    const svg = face();
    expect(svg).toContain(`width="${85 + BLEED * 2}mm"`);
    expect(svg).toContain(`height="${55 + BLEED * 2}mm"`);
    expect(svg).toContain(`viewBox="0 0 91 61"`);
  });

  it('offers the US size too', () => {
    const svg = face({ options: { ...DEFAULT_OPTIONS, size: 'us' } });
    expect(svg).toContain(`width="${(88.9 + 6).toFixed(1)}mm"`);
  });

  it('runs the background through the bleed, or the cut shows white', () => {
    expect(face()).toContain('<rect x="0" y="0" width="91" height="61"');
  });

  it('cuts the corners at 3 mm when asked, and leaves them square when not', () => {
    expect(face()).toContain(`rx="${CORNER_RADIUS}"`);
    const square = face({ options: { ...DEFAULT_OPTIONS, roundedCorners: false } });
    expect(square).not.toContain('clip-path');
  });
});

describe('nothing readable sits in the cut', () => {
  /* Every x/y on a text or icon must be at least SAFE inside the trim. The
     check is crude on purpose: it reads the numbers out of the SVG rather
     than trusting the code that wrote them. */
  const inset = BLEED + SAFE;

  it.each(TEMPLATE_ORDER)('keeps the %s back inside the safe area', (id) => {
    const svg = renderFace({
      template: TEMPLATES[id], details, options: { ...DEFAULT_OPTIONS }, side: 'back',
    });
    const xs = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"/g)];
    expect(xs.length).toBeGreaterThan(2);
    for (const [, x, y] of xs) {
      expect(Number(x)).toBeGreaterThanOrEqual(inset - 0.01);
      expect(Number(y)).toBeLessThanOrEqual(61 - BLEED - SAFE + 1.3);
    }
  });

  it('keeps the front tagline inside too', () => {
    const svg = renderFace({
      template: TEMPLATES.signature, details, options: { ...DEFAULT_OPTIONS }, side: 'front',
    });
    const match = /<text x="([\d.]+)" y="([\d.]+)"/.exec(svg);
    expect(Number(match?.[2])).toBeLessThanOrEqual(61 - inset);
  });
});

describe('the name', () => {
  it('bolds the first name and leaves the rest regular', () => {
    expect(splitName('Emir Dulovic')).toEqual({ first: 'Emir', last: 'Dulovic' });
  });

  it('treats everything after the first space as the surname', () => {
    expect(splitName('Tejeshwar Singh Solanki')).toEqual({ first: 'Tejeshwar', last: 'Singh Solanki' });
  });

  it('copes with one name', () => {
    expect(splitName('Priya')).toEqual({ first: 'Priya', last: '' });
  });

  it('shrinks a long name rather than running it off the card', () => {
    expect(nameFontPt('Emir', 50)).toBe(NAME_PT_MAX);
    expect(nameFontPt('Abdul Rahman Al Mansoori Al Qubaisi', 40)).toBeLessThan(NAME_PT_MAX);
    expect(nameFontPt('x'.repeat(200), 40)).toBe(NAME_PT_MIN);
  });

  it('says when even the smallest size will not fit', () => {
    expect(nameOverflows('Emir Dulovic', 50)).toBe(false);
    expect(nameOverflows('x'.repeat(200), 40)).toBe(true);
  });
});

describe('the title line', () => {
  it('is the job title in capitals with the BRN after a dot', () => {
    expect(titleLine(details)).toBe('FOUNDER · BRN 00000');
  });

  it('drops the dot when there is no BRN', () => {
    expect(titleLine({ ...details, brn: '' })).toBe('FOUNDER');
  });

  it('is empty when there is neither, rather than a stray dot', () => {
    expect(titleLine({ ...details, jobTitle: '', brn: '' })).toBe('');
  });
});

describe('the QR', () => {
  it('opens a WhatsApp chat with the number, digits only', () => {
    expect(qrTarget(details)).toBe('https://wa.me/971585923565');
  });

  it('prefers the WhatsApp number when it differs from the phone', () => {
    expect(qrTarget({ ...details, whatsapp: '+971 50 000 1111' })).toBe('https://wa.me/971500001111');
  });

  it('falls back to the website rather than an empty code', () => {
    expect(qrTarget({ ...details, phone: '', whatsapp: '' })).toBe('https://homes.me');
  });

  it('is drawn on a white tile, so it scans on a black or orange back', () => {
    expect(face()).toContain('rx="1.5" fill="#FFFFFF"');
  });

  it('disappears entirely when switched off', () => {
    const off = face({ options: { ...DEFAULT_OPTIONS, qr: false } });
    expect(off).not.toContain('Scan to WhatsApp');
  });
});

describe('the options do what they say', () => {
  it('shows the tagline on the front, and hides it when off', () => {
    const on = renderFace({ template: TEMPLATES.signature, details, options: DEFAULT_OPTIONS, side: 'front' });
    expect(on).toContain('Find a home that makes you smile.');
    const off = renderFace({
      template: TEMPLATES.signature, details, options: { ...DEFAULT_OPTIONS, tagline: false }, side: 'front',
    });
    expect(off).not.toContain('Find a home');
  });

  it('keeps the company line off unless asked', () => {
    expect(face()).not.toContain('EMIGEO');
    expect(face({ options: { ...DEFAULT_OPTIONS, companyLine: true } })).toContain('EMIGEO');
  });

  it('never exports the safe-area guides', () => {
    expect(face()).not.toContain('stroke-dasharray');
    expect(face({ options: { ...DEFAULT_OPTIONS, showSafeArea: true } })).toContain('stroke-dasharray');
  });
});

describe('the three templates are actually different', () => {
  it('gives each one its own front background', () => {
    const backgrounds = TEMPLATE_ORDER.map((id) => TEMPLATES[id].front.background);
    expect(new Set(backgrounds).size).toBe(3);
  });

  /*
   * The wordmark is drawn, never set in a font — "homes.me" in Poppins is a
   * different logo. So every side must carry the logo's own path data. The
   * website contact line is legitimately the text "homes.me", which is why
   * this looks for the artwork rather than for the absence of the words.
   */
  it('draws the wordmark as artwork on every side', () => {
    const firstPath = /d="(M[\d.]+ [\d.]+L[^"]{10,})"/.exec(LOGO.colour.body)?.[1];
    expect(firstPath, 'the logo must have path data to look for').toBeTruthy();
    for (const id of TEMPLATE_ORDER) {
      for (const side of ['front', 'back'] as const) {
        const svg = renderFace({ template: TEMPLATES[id], details, options: DEFAULT_OPTIONS, side });
        expect(svg, `${id} ${side}`).toContain('<path d="M275.8 150V100.8');
      }
    }
  });

  it('never sets the wordmark in a font at logo size', () => {
    for (const id of TEMPLATE_ORDER) {
      const svg = renderFace({ template: TEMPLATES[id], details, options: DEFAULT_OPTIONS, side: 'front' });
      /* The front has no contact lines, so any "homes.me" in a <text> there
         would be the wordmark typed out. */
      expect(svg, id).not.toMatch(/<text[^>]*>[^<]*homes\.me/);
    }
  });

  it('puts a watermark on every side, in one tone', () => {
    for (const id of TEMPLATE_ORDER) {
      for (const side of ['front', 'back'] as const) {
        const svg = renderFace({ template: TEMPLATES[id], details, options: DEFAULT_OPTIONS, side });
        const mark = TEMPLATES[id][side].watermark;
        expect(svg, `${id} ${side}`).toContain(`stroke="${mark}"`);
      }
    }
  });
});

describe('every size has a label a person can read', () => {
  it.each(Object.keys(SIZES))('%s', (key) => {
    expect(SIZES[key as keyof typeof SIZES].label).toMatch(/mm|in/);
  });
});
