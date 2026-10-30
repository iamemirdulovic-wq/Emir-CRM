import { describe, expect, it } from 'vitest';
import { MAX_VERSION, qrMatrix, qrSvg } from './qr.js';

/* ───────────────────────────────────────────────────────────────────────────
 * An independent decoder.
 *
 * Written against the standard rather than against the encoder, and
 * deliberately reading the mask out of the format bits in the finished grid
 * rather than being told which one was chosen. If the encoder picked the
 * wrong mask, wrote the format bits wrongly, walked the zig-zag in the wrong
 * order or interleaved the blocks wrongly, this fails to recover the text.
 *
 * It is the only way to know the codes actually scan, short of a phone:
 * this Chromium has no BarcodeDetector.
 * ─────────────────────────────────────────────────────────────────────────── */

const VERSIONS: Array<{ data: number; ecPerBlock: number; blocks: [number, number] }> = [
  { data: 16, ecPerBlock: 10, blocks: [1, 0] },
  { data: 28, ecPerBlock: 16, blocks: [1, 0] },
  { data: 44, ecPerBlock: 26, blocks: [1, 0] },
  { data: 64, ecPerBlock: 18, blocks: [2, 0] },
  { data: 86, ecPerBlock: 24, blocks: [2, 0] },
  { data: 108, ecPerBlock: 16, blocks: [4, 0] },
  { data: 124, ecPerBlock: 18, blocks: [4, 0] },
  { data: 154, ecPerBlock: 22, blocks: [2, 2] },
  { data: 182, ecPerBlock: 22, blocks: [3, 2] },
  { data: 216, ecPerBlock: 26, blocks: [4, 1] },
];

const ALIGNMENT: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Which cells are function patterns, and so are not data. */
function functionMap(size: number, version: number): boolean[][] {
  const map: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (r: number, c: number) => {
    if (r >= 0 && r < size && c >= 0 && c < size) (map[r] as boolean[])[c] = true;
  };

  for (const [row, col] of [[0, 0], [0, size - 7], [size - 7, 0]] as Array<[number, number]>) {
    for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) mark(row + r, col + c);
  }
  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
  }
  for (const row of ALIGNMENT[version - 1] ?? []) {
    for (const col of ALIGNMENT[version - 1] ?? []) {
      if ((row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8)) continue;
      for (let r = -2; r <= 2; r += 1) for (let c = -2; c <= 2; c += 1) mark(row + r, col + c);
    }
  }
  for (let i = 0; i < 9; i += 1) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = size - 8; i < size; i += 1) {
    mark(8, i);
    mark(i, 8);
  }
  return map;
}

/** Read the mask out of the format information, as a scanner does. */
function readMask(grid: number[][]): number {
  const bits: number[] = [];
  for (let i = 0; i <= 5; i += 1) bits.push((grid[8] as number[])[i] as number);
  bits.push((grid[8] as number[])[7] as number);
  bits.push((grid[8] as number[])[8] as number);
  bits.push((grid[7] as number[])[8] as number);
  for (let i = 9; i <= 14; i += 1) bits.push((grid[14 - i] as number[])[8] as number);

  let value = 0;
  for (const bit of bits) value = (value << 1) | bit;
  const unmasked = value ^ 0b101010000010010;
  /* Top five bits are the EC level (2) and the mask (3). */
  return (unmasked >> 10) & 0b111;
}

function readEcLevel(grid: number[][]): number {
  const bits: number[] = [];
  for (let i = 0; i <= 5; i += 1) bits.push((grid[8] as number[])[i] as number);
  bits.push((grid[8] as number[])[7] as number);
  bits.push((grid[8] as number[])[8] as number);
  bits.push((grid[7] as number[])[8] as number);
  for (let i = 9; i <= 14; i += 1) bits.push((grid[14 - i] as number[])[8] as number);
  let value = 0;
  for (const bit of bits) value = (value << 1) | bit;
  return ((value ^ 0b101010000010010) >> 13) & 0b11;
}

function decode(grid: number[][]): string {
  const size = grid.length;
  const version = (size - 17) / 4;
  const spec = VERSIONS[version - 1] as { data: number; ecPerBlock: number; blocks: [number, number] };
  const mask = MASKS[readMask(grid)] as (r: number, c: number) => boolean;
  const fn = functionMap(size, version);

  /* Walk the zig-zag and unmask. */
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if ((fn[row] as boolean[])[col]) continue;
        const raw = (grid[row] as number[])[col] as number;
        bits.push(mask(row, col) ? raw ^ 1 : raw);
      }
    }
    upward = !upward;
  }

  const all: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] as number);
    all.push(byte);
  }

  /* De-interleave back into blocks and drop the error correction. */
  const totalBlocks = spec.blocks[0] + spec.blocks[1];
  const shortLength = Math.floor(spec.data / totalBlocks);
  const lengths = Array.from({ length: totalBlocks }, (_, i) =>
    (i < spec.blocks[0] ? shortLength : shortLength + 1));

  const blocks: number[][] = lengths.map(() => []);
  let index = 0;
  for (let i = 0; i < Math.max(...lengths); i += 1) {
    for (let b = 0; b < totalBlocks; b += 1) {
      if (i < (lengths[b] as number)) {
        (blocks[b] as number[]).push(all[index] as number);
        index += 1;
      }
    }
  }

  const data = blocks.flat();
  let bitIndex = 0;
  const take = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = data[bitIndex >> 3] as number;
      value = (value << 1) | ((byte >> (7 - (bitIndex & 7))) & 1);
      bitIndex += 1;
    }
    return value;
  };

  const mode = take(4);
  if (mode !== 0b0100) throw new Error(`Not byte mode: ${mode}`);
  const length = take(version < 10 ? 8 : 16);
  const bytes: number[] = [];
  for (let i = 0; i < length; i += 1) bytes.push(take(8));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/* ── The tests ──────────────────────────────────────────────────────────── */

describe('a QR code that actually scans', () => {
  const cases = [
    'hi',
    'https://crm.homes.me/card/layla-hassan',
    'https://crm.homes.me/card/sara-al-mansoori',
    'https://crm.homes.me/card/omar-haddad-abu-dhabi-waterfront',
    `https://crm.homes.me/card/${'a'.repeat(100)}`,
    'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Layla Hassan\r\nEND:VCARD',
  ];

  it.each(cases.map((text) => [text.slice(0, 40), text]))(
    'round-trips through an independent decoder: %s',
    (_label, text) => {
      expect(decode(qrMatrix(text as string))).toBe(text);
    },
  );

  it('encodes a name with an accent correctly, as UTF-8 bytes', () => {
    const text = 'https://crm.homes.me/card/josé-garcía';
    expect(decode(qrMatrix(text))).toBe(text);
  });
});

describe('the structure a scanner looks for first', () => {
  const grid = qrMatrix('https://crm.homes.me/card/layla-hassan');
  const size = grid.length;

  it('is square and a legal size', () => {
    expect(grid.every((row) => row.length === size)).toBe(true);
    expect((size - 17) % 4).toBe(0);
    expect((size - 17) / 4).toBeGreaterThanOrEqual(1);
    expect((size - 17) / 4).toBeLessThanOrEqual(MAX_VERSION);
  });

  it('has a finder pattern in exactly three corners', () => {
    const finder = (r0: number, c0: number) => {
      /* The 7×7 pattern: dark ring, light ring, 3×3 dark core. */
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          const want = ring === 2 ? 0 : 1;
          if (((grid[r0 + r] as number[])[c0 + c] as number) !== want) return false;
        }
      }
      return true;
    };
    expect(finder(0, 0)).toBe(true);
    expect(finder(0, size - 7)).toBe(true);
    expect(finder(size - 7, 0)).toBe(true);
    /* And not in the fourth, which is how a scanner knows the orientation. */
    expect(finder(size - 7, size - 7)).toBe(false);
  });

  it('has alternating timing patterns', () => {
    for (let i = 8; i < size - 8; i += 1) {
      expect((grid[6] as number[])[i]).toBe(i % 2 === 0 ? 1 : 0);
      expect((grid[i] as number[])[6]).toBe(i % 2 === 0 ? 1 : 0);
    }
  });

  it('has the module that is always dark', () => {
    expect((grid[size - 8] as number[])[8]).toBe(1);
  });

  it('says level M in the format bits, which is what the tables assume', () => {
    expect(readEcLevel(grid)).toBe(0b00);
  });

  it('writes the format information twice, identically', () => {
    /* A scanner reads whichever copy it can see; they must agree. */
    const copyA: number[] = [];
    for (let i = 0; i <= 5; i += 1) copyA.push((grid[8] as number[])[i] as number);
    copyA.push((grid[8] as number[])[7] as number, (grid[8] as number[])[8] as number, (grid[7] as number[])[8] as number);
    for (let i = 9; i <= 14; i += 1) copyA.push((grid[14 - i] as number[])[8] as number);

    const copyB: number[] = [];
    /* Seven in the column then eight in the row — the eighth in the column
       would land on the module that must always be dark. */
    for (let i = 0; i <= 6; i += 1) copyB.push((grid[size - 1 - i] as number[])[8] as number);
    for (let i = 7; i <= 14; i += 1) copyB.push((grid[8] as number[])[size - 15 + i] as number);

    expect(copyB).toEqual(copyA);
  });
});

describe('choosing a version', () => {
  it('uses the smallest one that fits', () => {
    expect(qrMatrix('hi').length).toBe(21);           // version 1
    expect(qrMatrix('a'.repeat(40)).length).toBeGreaterThan(21);
  });

  it('grows as the text grows, and never shrinks', () => {
    let previous = 0;
    for (const length of [5, 20, 40, 80, 150, 200]) {
      const size = qrMatrix('x'.repeat(length)).length;
      expect(size).toBeGreaterThanOrEqual(previous);
      previous = size;
    }
  });

  it('refuses text it cannot encode rather than producing a code that will not scan', () => {
    /* Version 10 at level M holds 216 data codewords, so about 213
       characters. A business card URL is forty; anything approaching the
       limit is a mistake somewhere else and should say so. */
    expect(() => qrMatrix('x'.repeat(5000))).toThrow(/too long/i);
    expect(() => qrMatrix('x'.repeat(214))).toThrow(/too long/i);
    expect(() => qrMatrix('x'.repeat(200))).not.toThrow();
  });

  it('refuses nothing at all', () => {
    expect(() => qrMatrix('')).toThrow();
  });
});

describe('the SVG', () => {
  const svg = qrSvg('https://crm.homes.me/card/layla-hassan');

  it('has the quiet zone without which many scanners see nothing', () => {
    const modules = qrMatrix('https://crm.homes.me/card/layla-hassan').length;
    expect(svg).toContain(`viewBox="0 0 ${modules + 8} ${modules + 8}"`);
  });

  it('is one path rather than two thousand rects', () => {
    expect((svg.match(/<rect/g) ?? [])).toHaveLength(1);  // the white background
    expect((svg.match(/<path/g) ?? [])).toHaveLength(1);
  });

  it('is small enough to inline', () => {
    expect(svg.length).toBeLessThan(12_000);
  });

  it('draws crisp squares rather than blurred ones', () => {
    expect(svg).toContain('shape-rendering="crispEdges"');
  });

  it('refuses a colour that is not a colour', () => {
    expect(qrSvg('hi', { colour: '#fff" onload="alert(1)' })).not.toContain('onload');
  });

  it('has a label for a screen reader', () => {
    expect(svg).toContain('aria-label="QR code"');
  });
});
