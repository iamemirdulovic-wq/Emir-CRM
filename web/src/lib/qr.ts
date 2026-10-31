/**
 * A QR code, generated here — a copy of `server/src/profiles/qr.ts`.
 *
 * The two files are kept byte-identical below this comment, and
 * `qr-parity.test.ts` fails the build if they drift. That is a deliberate
 * trade: the alternative was a shared package, which means touching both
 * tsconfigs and both builds for one file that implements a frozen standard
 * (ISO/IEC 18004) and has not changed since it was written.
 *
 * It is copied rather than fetched from the server because the Business Card
 * Studio is a page that sends nothing anywhere: the number being encoded is
 * the agent's own, and it should not need a round trip to put it on screen.
 */

/* ── Galois field arithmetic, GF(256) with the QR primitive 0x11D ───────── */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255] as number;
})();

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] as number) + (LOG[b] as number)] as number;
}

/** The generator polynomial for `degree` error-correction codewords. */
function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] as number) ^ mul(poly[j] as number, EXP[i] as number);
      next[j + 1] = (next[j + 1] as number) ^ (poly[j] as number);
    }
    poly = next;
  }
  return poly;
}

function errorCorrection(data: number[], count: number): number[] {
  const gen = generator(count);
  const result = new Array<number>(count).fill(0);

  for (const byte of data) {
    const factor = byte ^ (result[0] as number);
    result.shift();
    result.push(0);
    if (factor !== 0) {
      for (let i = 0; i < gen.length - 1; i += 1) {
        result[i] = (result[i] as number) ^ mul(gen[i + 1] as number, factor);
      }
    }
  }
  return result;
}

/* ── Version tables (error correction level M only) ─────────────────────── */

/**
 * Per version: total data codewords, EC codewords per block, and the block
 * split as [count of group-1 blocks, count of group-2 blocks]. From the
 * standard's tables for level M.
 */
const VERSIONS: Array<{ data: number; ecPerBlock: number; blocks: [number, number] }> = [
  { data: 16, ecPerBlock: 10, blocks: [1, 0] },    // 1
  { data: 28, ecPerBlock: 16, blocks: [1, 0] },    // 2
  { data: 44, ecPerBlock: 26, blocks: [1, 0] },    // 3
  { data: 64, ecPerBlock: 18, blocks: [2, 0] },    // 4
  { data: 86, ecPerBlock: 24, blocks: [2, 0] },    // 5
  { data: 108, ecPerBlock: 16, blocks: [4, 0] },   // 6
  { data: 124, ecPerBlock: 18, blocks: [4, 0] },   // 7
  { data: 154, ecPerBlock: 22, blocks: [2, 2] },   // 8
  { data: 182, ecPerBlock: 22, blocks: [3, 2] },   // 9
  { data: 216, ecPerBlock: 26, blocks: [4, 1] },   // 10
];

/** Where the alignment patterns go, per version. Version 1 has none. */
const ALIGNMENT: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

export const MAX_VERSION = 10;

function versionFor(byteLength: number): number {
  for (let v = 1; v <= MAX_VERSION; v += 1) {
    const spec = VERSIONS[v - 1] as { data: number };
    /* 4 bits mode + 8 or 16 bits length + the data itself. */
    const headerBits = 4 + (v < 10 ? 8 : 16);
    if (spec.data * 8 >= headerBits + byteLength * 8) return v;
  }
  throw new Error(`That is too long for a QR code at version ${MAX_VERSION}`);
}

/* ── Building the bit stream ────────────────────────────────────────────── */

function dataCodewords(text: string, version: number): number[] {
  const bytes = [...new TextEncoder().encode(text)];
  const spec = VERSIONS[version - 1] as { data: number };
  const bits: number[] = [];

  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);                                 // byte mode
  push(bytes.length, version < 10 ? 8 : 16);       // length
  for (const byte of bytes) push(byte, 8);

  /* Terminator, up to four zero bits, then pad to a byte boundary. */
  const capacity = spec.data * 8;
  for (let i = 0; i < 4 && bits.length < capacity; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] as number);
    codewords.push(byte);
  }

  /* The two pad bytes the standard specifies, alternating. */
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < spec.data) {
    codewords.push(PAD[padIndex % 2] as number);
    padIndex += 1;
  }
  return codewords;
}

/** Split into blocks, add EC to each, and interleave as the standard says. */
function finalCodewords(data: number[], version: number): number[] {
  const spec = VERSIONS[version - 1] as { data: number; ecPerBlock: number; blocks: [number, number] };
  const totalBlocks = spec.blocks[0] + spec.blocks[1];
  const shortLength = Math.floor(spec.data / totalBlocks);

  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;

  for (let i = 0; i < totalBlocks; i += 1) {
    /* Group-2 blocks carry one more codeword than group-1 blocks. */
    const length = i < spec.blocks[0] ? shortLength : shortLength + 1;
    const block = data.slice(offset, offset + length);
    offset += length;
    blocks.push(block);
    ecBlocks.push(errorCorrection(block, spec.ecPerBlock));
  }

  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) if (i < block.length) out.push(block[i] as number);
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of ecBlocks) out.push(block[i] as number);
  }
  return out;
}

/* ── Drawing the matrix ─────────────────────────────────────────────────── */

type Grid = Array<Array<number | null>>;

function blank(size: number): Grid {
  return Array.from({ length: size }, () => new Array<number | null>(size).fill(null));
}

function placeFinder(grid: Grid, row: number, col: number): void {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || y >= grid.length || x < 0 || x >= grid.length) continue;
      const onRing = (r >= 0 && r <= 6 && (c === 0 || c === 6))
        || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      (grid[y] as Array<number | null>)[x] = onRing || inCore ? 1 : 0;
    }
  }
}

function placePatterns(grid: Grid, version: number): void {
  const size = grid.length;

  placeFinder(grid, 0, 0);
  placeFinder(grid, 0, size - 7);
  placeFinder(grid, size - 7, 0);

  /* Timing patterns: the dotted lines that tell a scanner the module size. */
  for (let i = 8; i < size - 8; i += 1) {
    const bit = i % 2 === 0 ? 1 : 0;
    (grid[6] as Array<number | null>)[i] = bit;
    (grid[i] as Array<number | null>)[6] = bit;
  }

  for (const row of ALIGNMENT[version - 1] ?? []) {
    for (const col of ALIGNMENT[version - 1] ?? []) {
      /* Not over a finder pattern. */
      if ((row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8)) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const ring = Math.max(Math.abs(r), Math.abs(c));
          ((grid[row + r] as Array<number | null>))[col + c] = ring === 1 ? 0 : 1;
        }
      }
    }
  }

  /* The one module that is always dark. */
  (grid[size - 8] as Array<number | null>)[8] = 1;
}

/** Cells reserved for the format information, which data must not use. */
function reserveFormat(grid: Grid): void {
  const size = grid.length;
  for (let i = 0; i < 9; i += 1) {
    if ((grid[8] as Array<number | null>)[i] === null) (grid[8] as Array<number | null>)[i] = 0;
    if ((grid[i] as Array<number | null>)[8] === null) (grid[i] as Array<number | null>)[8] = 0;
  }
  for (let i = size - 8; i < size; i += 1) {
    if ((grid[8] as Array<number | null>)[i] === null) (grid[8] as Array<number | null>)[i] = 0;
    if ((grid[i] as Array<number | null>)[8] === null) (grid[i] as Array<number | null>)[8] = 0;
  }
}

/** Walk the zig-zag the standard defines and drop the data in. */
function placeData(grid: Grid, codewords: number[]): boolean[][] {
  const size = grid.length;
  const isData: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  let bitIndex = 0;
  const nextBit = (): number => {
    const byte = codewords[bitIndex >> 3];
    if (byte === undefined) return 0;
    const bit = (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex += 1;
    return bit;
  };

  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    /* Column 6 is the vertical timing pattern; the walk skips it. */
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if ((grid[row] as Array<number | null>)[col] !== null) continue;
        (grid[row] as Array<number | null>)[col] = nextBit();
        (isData[row] as boolean[])[col] = true;
      }
    }
    upward = !upward;
  }
  return isData;
}

const MASKS: Array<(row: number, col: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Format bits for level M and a mask, with their BCH error correction. */
function formatBits(mask: number): number[] {
  const data = (0b00 << 3) | mask;           // 00 is level M
  let value = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if ((value >> (i + 10)) & 1) value ^= 0b10100110111 << i;
  }
  const bits = ((data << 10) | value) ^ 0b101010000010010;
  return Array.from({ length: 15 }, (_, i) => (bits >> (14 - i)) & 1);
}

function placeFormat(grid: Grid, mask: number): void {
  const size = grid.length;
  const bits = formatBits(mask);

  for (let i = 0; i <= 5; i += 1) (grid[8] as Array<number | null>)[i] = bits[i] as number;
  (grid[8] as Array<number | null>)[7] = bits[6] as number;
  (grid[8] as Array<number | null>)[8] = bits[7] as number;
  (grid[7] as Array<number | null>)[8] = bits[8] as number;
  for (let i = 9; i <= 14; i += 1) (grid[14 - i] as Array<number | null>)[8] = bits[i] as number;

  /*
   * The second copy is split 7 then 8, not 8 then 7. Writing eight into the
   * column overwrites (size-8, 8), which is the module that must always be
   * dark — and a scanner that checks it gives up on the code.
   */
  for (let i = 0; i <= 6; i += 1) (grid[size - 1 - i] as Array<number | null>)[8] = bits[i] as number;
  for (let i = 7; i <= 14; i += 1) (grid[8] as Array<number | null>)[size - 15 + i] = bits[i] as number;
}

/** The standard's penalty score, used to pick the mask that scans best. */
function penalty(grid: Grid): number {
  const size = grid.length;
  let score = 0;

  const at = (r: number, c: number) => ((grid[r] as Array<number | null>)[c] ?? 0);

  /* Rule 1: runs of five or more of the same colour. */
  for (let i = 0; i < size; i += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        const a = horizontal ? at(i, j) : at(j, i);
        const b = horizontal ? at(i, j - 1) : at(j - 1, i);
        if (a === b) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }

  /* Rule 2: 2×2 blocks of one colour. */
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
    }
  }

  /* Rule 3: the finder-like pattern, which confuses a scanner. */
  const PATTERN = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j + 11 <= size; j += 1) {
      const row = PATTERN.every((bit, k) => at(i, j + k) === bit);
      const col = PATTERN.every((bit, k) => at(j + k, i) === bit);
      const rowBack = PATTERN.every((bit, k) => at(i, j + 10 - k) === bit);
      const colBack = PATTERN.every((bit, k) => at(j + 10 - k, i) === bit);
      if (row || col || rowBack || colBack) score += 40;
    }
  }

  /* Rule 4: too far from half dark. */
  let dark = 0;
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) dark += at(r, c);
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/** The finished black-and-white grid. */
export function qrMatrix(text: string): number[][] {
  if (!text) throw new Error('Nothing to encode');

  const version = versionFor(new TextEncoder().encode(text).length);
  const size = version * 4 + 17;
  const codewords = finalCodewords(dataCodewords(text, version), version);

  let best: { grid: Grid; score: number } | null = null;

  for (let mask = 0; mask < 8; mask += 1) {
    const grid = blank(size);
    placePatterns(grid, version);
    reserveFormat(grid);
    const isData = placeData(grid, codewords);

    const test = MASKS[mask] as (r: number, c: number) => boolean;
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if ((isData[r] as boolean[])[c] && test(r, c)) {
          (grid[r] as Array<number | null>)[c] = ((grid[r] as Array<number | null>)[c] as number) ^ 1;
        }
      }
    }
    placeFormat(grid, mask);

    const score = penalty(grid);
    if (!best || score < best.score) best = { grid, score };
  }

  const grid = (best as { grid: Grid }).grid;
  return grid.map((row) => row.map((cell) => cell ?? 0));
}

/**
 * As an SVG.
 *
 * One path for every dark module rather than one rect each: a 45×45 code is
 * two thousand rects, and one path is a tenth of the bytes.
 */
export function qrSvg(text: string, options: { size?: number; quiet?: number; colour?: string } = {}): string {
  const matrix = qrMatrix(text);
  const modules = matrix.length;
  /* Four modules of white on every side, which the standard requires and
     without which many scanners simply will not see the code. */
  const quiet = options.quiet ?? 4;
  const total = modules + quiet * 2;
  const colour = /^#[0-9a-fA-F]{6}$/.test(options.colour ?? '') ? options.colour : '#0E1B2C';

  const parts: string[] = [];
  for (let r = 0; r < modules; r += 1) {
    for (let c = 0; c < modules; c += 1) {
      if ((matrix[r] as number[])[c] === 1) parts.push(`M${c + quiet} ${r + quiet}h1v1h-1z`);
    }
  }

  const pixels = options.size ?? 240;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${pixels}" height="${pixels}" shape-rendering="crispEdges" role="img" aria-label="QR code">`
    + `<rect width="${total}" height="${total}" fill="#ffffff"/>`
    + `<path fill="${colour}" d="${parts.join('')}"/>`
    + '</svg>';
}
