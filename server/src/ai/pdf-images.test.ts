import { describe, expect, it } from 'vitest';
import { extractPdfImages, usefulImages } from './pdf-images.js';

/**
 * A JPEG inside a PDF is stored with no transformation: `/Filter /DCTDecode`
 * means the bytes between `stream` and `endstream` are a complete JPEG file.
 * These build small PDFs by hand to prove the scanner finds exactly those and
 * nothing else.
 */

/** A minimal but genuine JPEG: SOI, a comment of the given size, EOI. */
function jpeg(bytes: number): Buffer {
  const padding = Math.max(0, bytes - 8);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xfe]),                       // SOI + COM
    Buffer.from([(padding + 2) >> 8, (padding + 2) & 0xff]),      // segment length
    Buffer.alloc(padding, 0x41),
    Buffer.from([0xff, 0xd9]),                                    // EOI
  ]);
}

function pdfWith(objects: { dict: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n')];
  objects.forEach((object, index) => {
    parts.push(Buffer.from(`${index + 1} 0 obj\n<< ${object.dict} /Length ${object.data.length} >>\nstream\n`));
    parts.push(object.data);
    parts.push(Buffer.from('\nendstream\nendobj\n'));
  });
  parts.push(Buffer.from('%%EOF'));
  return Buffer.concat(parts);
}

const image = (dict: string, bytes: number) => ({ dict, data: jpeg(bytes) });
const RENDER = '/Type /XObject /Subtype /Image /Filter /DCTDecode /Width 1600 /Height 900';

describe('taking the photographs out of a brochure', () => {
  it('finds an embedded JPEG and hands back the whole file', () => {
    const pdf = pdfWith([image(RENDER, 60_000)]);

    const found = extractPdfImages(pdf);

    expect(found).toHaveLength(1);
    // Starts like a JPEG and ends like one: a complete file, not a fragment.
    expect(found[0]?.data.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(found[0]?.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(found[0]).toMatchObject({ width: 1600, height: 900 });
  });

  it('puts the biggest first, because that is the hero render', () => {
    const pdf = pdfWith([
      image(RENDER, 40_000),
      image('/Subtype /Image /Filter /DCTDecode /Width 2400 /Height 1400', 200_000),
      image('/Subtype /Image /Filter /DCTDecode /Width 900 /Height 600', 90_000),
    ]);

    const sizes = extractPdfImages(pdf).map((row) => row.data.length);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(extractPdfImages(pdf)[0]?.width).toBe(2400);
  });

  /* Text and font streams sit in the same file and must not be mistaken for
     pictures. */
  it('ignores streams that are not images', () => {
    const pdf = pdfWith([
      { dict: '/Filter /FlateDecode', data: Buffer.alloc(80_000, 0x20) },
      { dict: '/Type /Font /Subtype /Type1', data: Buffer.alloc(90_000, 0x20) },
      image(RENDER, 60_000),
    ]);

    expect(extractPdfImages(pdf)).toHaveLength(1);
  });

  /* Only DCTDecode is a JPEG sitting there ready to copy. The others need real
     image reconstruction, which is not worth a dependency for a brochure. */
  it('leaves filters it cannot copy out alone', () => {
    const pdf = pdfWith([
      { dict: '/Subtype /Image /Filter /FlateDecode /Width 1600 /Height 900', data: Buffer.alloc(80_000, 0x78) },
      { dict: '/Subtype /Image /Filter /JPXDecode /Width 1600 /Height 900', data: Buffer.alloc(80_000, 0x6a) },
    ]);

    expect(extractPdfImages(pdf)).toEqual([]);
  });

  it('skips anything too small to be photography', () => {
    const pdf = pdfWith([image('/Subtype /Image /Filter /DCTDecode /Width 48 /Height 48', 2_000)]);
    expect(extractPdfImages(pdf)).toEqual([]);
  });

  it('skips a stream that claims to be a JPEG and is not', () => {
    const pdf = pdfWith([{ dict: RENDER, data: Buffer.alloc(60_000, 0x00) }]);
    expect(extractPdfImages(pdf)).toEqual([]);
  });

  it('does not fall over on a file with no streams at all', () => {
    expect(extractPdfImages(Buffer.from('%PDF-1.7\nnothing here\n%%EOF'))).toEqual([]);
    expect(extractPdfImages(Buffer.alloc(0))).toEqual([]);
  });

  /* A truncated file must end the scan, not spin. */
  it('stops cleanly when a stream is never closed', () => {
    const broken = Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n<< /Subtype /Image /Filter /DCTDecode >>\nstream\n'), jpeg(60_000)]);
    expect(() => extractPdfImages(broken)).not.toThrow();
  });
});

describe('deciding which of them are worth offering', () => {
  /* A brochure repeats its logo and page furniture on every page. */
  it('drops the same picture repeated', () => {
    const same = jpeg(60_000);
    const images = [0, 1, 2].map((offset) => ({ data: same, width: 1600, height: 900, offset }));

    expect(usefulImages(images)).toHaveLength(1);
  });

  it('drops banners and rules', () => {
    const images = [
      { data: jpeg(60_000), width: 2400, height: 200, offset: 0 },   // a banner
      { data: jpeg(61_000), width: 100, height: 1400, offset: 1 },   // a rule
      { data: jpeg(62_000), width: 1600, height: 900, offset: 2 },   // a render
    ];

    const kept = usefulImages(images);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.width).toBe(1600);
  });

  it('drops icons, and keeps a picture with no dimensions given', () => {
    const images = [
      { data: jpeg(60_000), width: 64, height: 64, offset: 0 },
      { data: jpeg(61_000), width: null, height: null, offset: 1 },
    ];

    expect(usefulImages(images)).toHaveLength(1);
  });

  it('stops at the limit rather than offering forty', () => {
    const images = Array.from({ length: 30 }, (_, i) => ({
      data: jpeg(60_000 + i), width: 1600, height: 900, offset: i,
    }));

    expect(usefulImages(images, 12)).toHaveLength(12);
  });
});
