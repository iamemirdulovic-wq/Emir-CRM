/**
 * Turning the artboard into something you can send to a printer.
 *
 * All four exports start from the same SVG the preview shows, so what is
 * approved on screen is what comes out. The heavy libraries load only when
 * somebody presses a download button — this is a page most people open once,
 * and nobody should pay for jsPDF on every other screen in the CRM.
 */
import { BLEED, SIZES, renderFace, type CardDetails, type CardOptions } from './artboard.js';
import type { Template } from './brand.js';
import { embedPoppins, poppinsStyleBlock, type FontCapablePdf } from './fonts.js';

/** 300 dots per inch, in pixels per millimetre. */
export const PX_PER_MM_300 = 300 / 25.4;

export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card';
}

export function fileName(kind: string, name: string, extension: string): string {
  return `homes-me-card-${slugify(name)}${kind ? `-${kind}` : ''}.${extension}`;
}

export interface ExportInput {
  template: Template;
  details: CardDetails;
  options: CardOptions;
}

/**
 * The two sides, with the on-screen-only guides forced off.
 *
 * `squareForPrint` leaves the corners square for the PDF. The images keep
 * them rounded, which is the card as anybody pictures it.
 */
export function faces(input: ExportInput, squareForPrint = false): { front: string; back: string } {
  const options = { ...input.options, showSafeArea: false };
  return {
    front: renderFace({ ...input, options, side: 'front', squareForPrint }),
    back: renderFace({ ...input, options, side: 'back', squareForPrint }),
  };
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  /* Revoked on the next tick: revoking immediately cancels the download in
     Safari, which is the browser half this team is on. */
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Rasterise one artboard at a given scale of 300 DPI. */
/** Put the font inside the SVG, so it still has one once it leaves the page. */
export function withFonts(svg: string, styleBlock: string): string {
  return svg.replace(/^(<svg[^>]*>)/, `$1${styleBlock}`);
}

export async function rasterise(
  svg: string, widthMm: number, heightMm: number, scale: number, background: string | null,
): Promise<Blob> {
  const width = Math.round(widthMm * PX_PER_MM_300 * scale);
  const height = Math.round(heightMm * PX_PER_MM_300 * scale);

  const image = new Image();
  const source = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The card could not be drawn'));
      image.src = source;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot draw the card');
    /* JPG has no transparency, so it needs something behind the rounded
       corners; PNG keeps them clear. */
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be saved'))),
        background ? 'image/jpeg' : 'image/png',
        background ? 0.95 : undefined,
      );
    });
  } finally {
    URL.revokeObjectURL(source);
  }
}

export async function downloadImage(
  input: ExportInput, side: 'front' | 'back', format: 'png' | 'jpg', scale: number,
): Promise<void> {
  const { w, h } = SIZES[input.options.size];
  const svg = withFonts(faces(input)[side], await poppinsStyleBlock());
  const background = format === 'jpg' ? '#FFFFFF' : null;
  const blob = await rasterise(svg, w + BLEED * 2, h + BLEED * 2, scale, background);
  download(blob, fileName(side, input.details.fullName, format));
}

/**
 * The print PDF: two pages at the full bleed size, everything still vector.
 *
 * `svg2pdf` walks the SVG and writes real PDF drawing operators, so the logo
 * and the QR stay sharp at any zoom — which is the whole reason the artboard
 * is SVG rather than a canvas.
 */
export async function downloadPdf(input: ExportInput, cropMarks: boolean): Promise<void> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
  ]);

  const { w, h } = SIZES[input.options.size];
  const pageW = w + BLEED * 2;
  const pageH = h + BLEED * 2;
  const pdf = new jsPDF({ unit: 'mm', format: [pageW, pageH], orientation: 'landscape' });
  /* Before anything is drawn: svg2pdf resolves each text node's font as it
     walks the SVG, so a font registered afterwards is a font the text never
     sees. */
  await embedPoppins(pdf as unknown as FontCapablePdf);

  const { front, back } = faces(input, true);
  const parser = new DOMParser();

  for (const [index, svg] of [front, back].entries()) {
    if (index > 0) pdf.addPage([pageW, pageH], 'landscape');
    const element = parser.parseFromString(svg, 'image/svg+xml').documentElement as unknown as Element;
    await svg2pdf(element, pdf, { x: 0, y: 0, width: pageW, height: pageH });
    if (cropMarks) drawCropMarks(pdf, pageW, pageH);
  }

  if (input.options.roundedCorners) {
    /* The artwork is square, because rounded corners are a die-cut and not
       something the press prints. The printer has to be told, and a line on
       its own page is the one place they reliably look. */
    pdf.addPage([pageW, pageH], 'landscape');
    pdf.setFontSize(9);
    pdf.text('Die-cut rounded corners, 3 mm radius.', 6, 10);
    pdf.text(`Trim ${SIZES[input.options.size].label}, 3 mm bleed on all sides.`, 6, 16);
    pdf.text('Pages 1 and 2 are the front and the back. This page is not to be printed.', 6, 22);
  }

  pdf.save(fileName('', input.details.fullName, 'pdf'));
}

/** Thin marks in the bleed showing where to cut. */
function drawCropMarks(pdf: { setDrawColor: (r: number, g: number, b: number) => void;
  setLineWidth: (w: number) => void; line: (a: number, b: number, c: number, d: number) => void },
pageW: number, pageH: number): void {
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.1);
  const m = BLEED;
  const len = 2;
  const xs = [m, pageW - m];
  const ys = [m, pageH - m];
  for (const x of xs) {
    pdf.line(x, 0, x, len);
    pdf.line(x, pageH - len, x, pageH);
  }
  for (const y of ys) {
    pdf.line(0, y, len, y);
    pdf.line(pageW - len, y, pageW, y);
  }
}

/**
 * A square image of the two cards at an angle, for WhatsApp or LinkedIn.
 *
 * Drawn here rather than photographed: a mockup built from the real artboard
 * always shows the real card, and a stock mockup photograph is one more thing
 * to license.
 */
export async function downloadMockup(input: ExportInput): Promise<void> {
  const { w, h } = SIZES[input.options.size];
  const style = await poppinsStyleBlock();
  const { front, back } = faces(input);
  const size = 1080;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw the mockup');

  const dark = input.template.front.background !== '#FBF7F3';
  context.fillStyle = dark ? '#121212' : '#F3EEE9';
  context.fillRect(0, 0, size, size);

  const load = async (svg: string): Promise<HTMLImageElement> => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([withFonts(svg, style)], { type: 'image/svg+xml' }));
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The card could not be drawn'));
      image.src = url;
    });
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return image;
  };

  const [backImage, frontImage] = await Promise.all([load(back), load(front)]);
  const cardW = size * 0.62;
  const cardH = cardW * ((h + BLEED * 2) / (w + BLEED * 2));

  const place = (image: HTMLImageElement, dx: number, dy: number, angle: number) => {
    context.save();
    context.translate(size / 2 + dx, size / 2 + dy);
    context.rotate(angle);
    context.shadowColor = 'rgba(0,0,0,0.45)';
    context.shadowBlur = 48;
    context.shadowOffsetY = 24;
    context.drawImage(image, -cardW / 2, -cardH / 2, cardW, cardH);
    context.restore();
  };

  place(backImage, size * 0.08, -size * 0.1, -0.18);
  place(frontImage, -size * 0.07, size * 0.1, -0.18);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The mockup could not be saved'))), 'image/png');
  });
  download(blob, fileName('mockup', input.details.fullName, 'png'));
}
