/**
 * Six cover images, drawn rather than photographed.
 *
 * A stock photograph of the Dubai skyline is either licensed or stolen, and
 * a brokerage's own CRM must not be either. These are SVG, generated from a
 * handful of numbers, so they weigh a couple of kilobytes, scale to any
 * screen, and belong to nobody but this repository.
 *
 * They are deliberately abstract — a skyline silhouette and a sky, not a
 * drawing of a specific tower. Nobody should be able to say "that is the
 * Burj and you have drawn it wrong".
 */

export interface Cover {
  key: string;
  name: string;
  /** Top and bottom of the sky. */
  sky: [string, string];
  /** The buildings. */
  ink: string;
  /** Sun, moon or nothing. */
  orb: { x: number; y: number; r: number; colour: string } | null;
  /** How tall the towers are, left to right, as a fraction of the height. */
  skyline: number[];
  /** Whether lit windows are drawn. Only on the dark ones. */
  windows: boolean;
}

/*
 * The six. Two evenings, a dawn, a daytime, a night and a sand-coloured one,
 * so that a team of ten does not end up with ten of the same card.
 */
export const COVERS: Cover[] = [
  {
    key: 'marina-dusk',
    name: 'Marina at dusk',
    sky: ['#1B3A6B', '#E8794F'],
    ink: '#0B1A33',
    /* High enough to clear the towers; a sun hidden behind a building is
       just a smudge. */
    orb: { x: 0.80, y: 0.22, r: 0.08, colour: '#FFB27A' },
    skyline: [0.42, 0.68, 0.34, 0.80, 0.55, 0.92, 0.48, 0.72, 0.38, 0.60, 0.30, 0.52],
    windows: true,
  },
  {
    key: 'downtown-night',
    name: 'Downtown at night',
    sky: ['#05101F', '#123047'],
    ink: '#020810',
    orb: { x: 0.18, y: 0.24, r: 0.045, colour: '#DCE8FF' },
    skyline: [0.30, 0.52, 0.88, 0.46, 0.70, 0.38, 0.96, 0.44, 0.62, 0.34, 0.50, 0.28],
    windows: true,
  },
  {
    key: 'creek-dawn',
    name: 'Creek at dawn',
    sky: ['#F4C9A0', '#8FB8D8'],
    ink: '#3A4F6B',
    orb: { x: 0.24, y: 0.58, r: 0.06, colour: '#FFF0D8' },
    skyline: [0.26, 0.40, 0.58, 0.34, 0.48, 0.66, 0.38, 0.52, 0.30, 0.44, 0.24, 0.36],
    windows: false,
  },
  {
    key: 'saadiyat-day',
    name: 'Saadiyat by day',
    sky: ['#9FD4E8', '#E6F4F8'],
    ink: '#5B7F96',
    orb: null,
    skyline: [0.22, 0.34, 0.28, 0.46, 0.30, 0.38, 0.26, 0.42, 0.24, 0.32, 0.20, 0.28],
    windows: false,
  },
  {
    key: 'desert-gold',
    name: 'Desert gold',
    sky: ['#E8B16A', '#F6E3C4'],
    ink: '#8A5A33',
    orb: { x: 0.70, y: 0.30, r: 0.08, colour: '#FFF4DC' },
    /* Low and varied: a low skyline of identical blocks reads as a wall. */
    skyline: [0.12, 0.34, 0.18, 0.44, 0.15, 0.52, 0.22, 0.38, 0.14, 0.30, 0.10, 0.24],
    windows: false,
  },
  {
    key: 'teal-calm',
    name: 'Calm teal',
    sky: ['#0AA3BA', '#BFE7EE'],
    ink: '#07596A',
    orb: null,
    skyline: [0.34, 0.50, 0.42, 0.62, 0.38, 0.72, 0.44, 0.54, 0.36, 0.46, 0.30, 0.40],
    windows: false,
  },
];

export function cover(key: string | null | undefined): Cover {
  return COVERS.find((item) => item.key === key) ?? (COVERS[0] as Cover);
}

/**
 * Draw one, at a given size.
 *
 * Deterministic: the same key always produces the same picture, because a
 * cover that shuffles on every page load is a cover that looks broken.
 */
export function renderCover(key: string, width = 1200, height = 320): string {
  const design = cover(key);
  const id = design.key.replace(/[^a-z0-9]/gi, '');

  const towerWidth = width / design.skyline.length;
  const towers = design.skyline.map((tall, index) => {
    const x = index * towerWidth;
    const h = tall * height;
    const y = height - h;
    /* A little gap between towers so the skyline reads as buildings rather
       than as one block. */
    const w = towerWidth - Math.max(2, towerWidth * 0.08);

    const lights = design.windows ? windowsFor(x, y, w, h, index) : '';

    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>${lights}`;
  }).join('');

  const orb = design.orb
    ? `<circle cx="${(design.orb.x * width).toFixed(1)}" cy="${(design.orb.y * height).toFixed(1)}" r="${(design.orb.r * height).toFixed(1)}" fill="${design.orb.colour}" opacity="0.9"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${design.name}">
  <defs>
    <linearGradient id="sky${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${design.sky[0]}"/>
      <stop offset="100%" stop-color="${design.sky[1]}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#sky${id})"/>
  ${orb}
  <g fill="${design.ink}">${towers}</g>
</svg>`;
}

/**
 * Lit windows.
 *
 * Placed by a small deterministic pattern rather than by Math.random, so the
 * cover is the same every time it is drawn — on the server, in the browser,
 * and in a PDF.
 */
function windowsFor(x: number, y: number, w: number, h: number, seed: number): string {
  /*
   * Sparse on purpose. A window every nine pixels looked right and weighed
   * 56KB for one cover, which is too much to inline six times on a page.
   * Wider spacing, fewer lit, and nothing on the short towers — where the
   * detail would not be seen anyway — brings it under four.
   */
  const size = 3;
  const gapX = 16;
  const gapY = 22;
  if (h < 90) return '';

  const out: string[] = [];
  for (let row = 0; row * gapY + 16 < h; row += 1) {
    for (let col = 0; col * gapX + 10 < w; col += 1) {
      /* A cheap repeatable hash: lit if this cell lands on the pattern. */
      const lit = ((row * 7 + col * 13 + seed * 29) % 7) < 2;
      if (!lit) continue;
      out.push(
        `<rect x="${(x + 7 + col * gapX).toFixed(1)}" y="${(y + 12 + row * gapY).toFixed(1)}" width="${size}" height="${size}"/>`,
      );
    }
  }
  /* One fill for all of them rather than an attribute on each. */
  return out.length ? `<g fill="#FFD9A0" opacity="0.55">${out.join('')}</g>` : '';
}
