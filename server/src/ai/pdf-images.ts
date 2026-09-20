/**
 * Pulling the photographs out of a developer's brochure.
 *
 * Emir AI reads the brochure's *words* — the name, the prices, the payment
 * plan. The pictures were left behind, so after dropping a 40-page brochure
 * full of renders the owner still had a project card with no photograph on it
 * and had to go and find the images by hand.
 *
 * **Done without a PDF library, on purpose.** Adding one is the owner's call,
 * not mine, and it is not needed for the job: a brochure's renders are
 * overwhelmingly JPEG, and a JPEG inside a PDF is stored with no
 * transformation at all — `/Filter /DCTDecode` means the bytes between
 * `stream` and `endstream` *are* a complete JPEG file. Finding those and
 * copying them out is the whole of it.
 *
 * What this deliberately does not do is decode the other filters
 * (FlateDecode, JPX, CCITT). Those need real image reconstruction, and a
 * brochure rarely uses them for photography. A logo drawn as vector artwork is
 * not extractable this way either, and is not worth a dependency.
 */
import { logger } from '../lib/logger.js';

export type PdfImage = {
  /** A complete JPEG file, exactly as it sat inside the PDF. */
  data: Buffer;
  width: number | null;
  height: number | null;
  /** Where it was found, so the biggest and earliest can be preferred. */
  offset: number;
};

/** Below this an image is a bullet, a rule or an icon, not photography. */
const MIN_BYTES = 20 * 1024;
/** Guards against a hostile file: a brochure has renders, not thousands. */
const MAX_IMAGES = 40;

/**
 * Every JPEG embedded in the PDF, largest first.
 *
 * Largest because a brochure's hero render is its biggest image, and that is
 * the one worth offering as the cover.
 */
export function extractPdfImages(pdf: Buffer): PdfImage[] {
  const found: PdfImage[] = [];

  /*
   * Scanned as bytes rather than as text. A PDF is binary, and decoding it to
   * a string first corrupts the very stream data being looked for.
   */
  const STREAM = Buffer.from('stream');
  const ENDSTREAM = Buffer.from('endstream');
  const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);

  let cursor = 0;
  while (cursor < pdf.length && found.length < MAX_IMAGES) {
    const streamAt = pdf.indexOf(STREAM, cursor);
    if (streamAt === -1) break;

    // The dictionary is what comes before `stream`; a few hundred bytes is
    // plenty and keeps this linear.
    const dictionary = pdf.subarray(Math.max(0, streamAt - 800), streamAt).toString('latin1');
    let start = streamAt + STREAM.length;
    // The spec allows CRLF or LF after the keyword.
    if (pdf[start] === 0x0d) start += 1;
    if (pdf[start] === 0x0a) start += 1;

    const endAt = pdf.indexOf(ENDSTREAM, start);
    if (endAt === -1) break;
    cursor = endAt + ENDSTREAM.length;

    if (!/\/Subtype\s*\/Image/.test(dictionary)) continue;
    if (!/\/DCTDecode/.test(dictionary)) continue;

    /*
     * `/Length` is the true size of the stream. The bytes up to `endstream`
     * usually include the end-of-line that separates them from the keyword,
     * which is not part of the image — so prefer the declared length, and trim
     * a trailing EOL when there isn't one.
     */
    const declared = readNumber(dictionary, 'Length');
    const stop = declared && start + declared <= endAt ? start + declared : trimEol(pdf, start, endAt);

    const data = pdf.subarray(start, stop);
    if (data.length < MIN_BYTES) continue;
    // It must actually begin like a JPEG, or it is something else mislabelled.
    if (!data.subarray(0, 3).equals(JPEG_START)) continue;

    found.push({
      data: Buffer.from(data),
      width: readNumber(dictionary, 'Width'),
      height: readNumber(dictionary, 'Height'),
      offset: streamAt,
    });
  }

  if (found.length === 0) logger.debug('no extractable images in that pdf');

  // Biggest first: a brochure's hero render is its largest image.
  return found.sort((a, b) => b.data.length - a.data.length);
}

/** The stream's end, without the newline that separates it from `endstream`. */
function trimEol(pdf: Buffer, start: number, end: number): number {
  let stop = end;
  if (stop > start && pdf[stop - 1] === 0x0a) stop -= 1;
  if (stop > start && pdf[stop - 1] === 0x0d) stop -= 1;
  return stop;
}

function readNumber(dictionary: string, key: string): number | null {
  const match = new RegExp(`/${key}\\s+(\\d+)`).exec(dictionary);
  return match?.[1] ? Number(match[1]) : null;
}

/**
 * Drop images that are almost certainly not photography.
 *
 * A brochure repeats its logo and its page furniture on every page, so the
 * same bytes appear many times over; and anything very long and thin is a
 * banner or a rule rather than a picture of a building.
 */
export function usefulImages(images: PdfImage[], limit = 12): PdfImage[] {
  const seen = new Set<string>();
  const kept: PdfImage[] = [];

  for (const image of images) {
    // Same length and same first bytes is the same image repeated.
    const fingerprint = `${image.data.length}:${image.data.subarray(0, 32).toString('hex')}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    if (image.width && image.height) {
      const ratio = image.width / image.height;
      if (ratio > 5 || ratio < 0.2) continue;             // a banner or a rule
      if (image.width < 400 && image.height < 400) continue;  // an icon
    }

    kept.push(image);
    if (kept.length >= limit) break;
  }

  return kept;
}
