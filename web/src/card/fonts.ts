/**
 * Poppins, into the PDF.
 *
 * jsPDF ships the fourteen standard PDF fonts and nothing else, so without
 * this the card's text is written in Helvetica — the logo stays perfect, the
 * name and the contact lines come out in the wrong typeface, and the only
 * place anybody notices is the printed card. The brand sheet asks for the
 * font to be embedded for exactly that reason.
 *
 * The TTFs are the ones the preview uses, fetched from our own origin, so the
 * screen and the page agree by construction rather than by luck.
 */

const FILES: Array<{ weight: number; style: 'normal'; file: string }> = [
  { weight: 400, style: 'normal', file: 'Poppins-Regular.ttf' },
  { weight: 500, style: 'normal', file: 'Poppins-Medium.ttf' },
  { weight: 700, style: 'normal', file: 'Poppins-Bold.ttf' },
];

/** jsPDF wants base64, and the browser hands us bytes. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  /* In chunks: one spread of 160,000 arguments overflows the call stack, and
     a card's font is about that size. */
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

let cached: Array<{ weight: number; file: string; data: string }> | null = null;

async function load(): Promise<Array<{ weight: number; file: string; data: string }>> {
  if (cached) return cached;
  cached = await Promise.all(FILES.map(async ({ weight, file }) => {
    const response = await fetch(`/fonts/${file}`);
    if (!response.ok) throw new Error(`Poppins ${weight} did not load`);
    return { weight, file, data: toBase64(await response.arrayBuffer()) };
  }));
  return cached;
}

/** jsPDF's font style names, which are not CSS weights. */
const STYLE: Record<number, string> = { 400: 'normal', 500: 'medium', 700: 'bold' };

export interface FontCapablePdf {
  addFileToVFS: (name: string, data: string) => void;
  addFont: (file: string, family: string, style: string) => string;
  setFont: (family: string, style?: string) => void;
}

/**
 * Register all three weights, and leave the document set to the regular one.
 *
 * svg2pdf matches on the SVG's `font-family` and `font-weight`, so the names
 * registered here have to be the family the artboard asks for — "Poppins".
 */
export async function embedPoppins(pdf: FontCapablePdf): Promise<void> {
  for (const { weight, file, data } of await load()) {
    pdf.addFileToVFS(file, data);
    pdf.addFont(file, 'Poppins', STYLE[weight] ?? 'normal');
  }
  pdf.setFont('Poppins', 'normal');
}

/**
 * The same three fonts, as a `<style>` block to drop inside the SVG.
 *
 * An SVG rasterised through an `<img>` is its own isolated document: it
 * cannot see the page's stylesheets or its `@font-face` rules. So the PNG and
 * the JPG came out in whatever sans the browser falls back to, while the
 * preview beside them — inline in the DOM — was correctly in Poppins. Two
 * pictures of the same card in two typefaces, and the wrong one is the one
 * that gets sent to a printer.
 *
 * Inlining the bytes is the only way to make the SVG stand alone. It is about
 * 640 KB of base64 held for the moment it takes to draw, and nothing is kept.
 */
export async function poppinsStyleBlock(): Promise<string> {
  const faces = (await load()).map(({ weight, data }) => (
    `@font-face{font-family:'Poppins';font-style:normal;font-weight:${weight};`
    + `src:url(data:font/ttf;base64,${data}) format('truetype');}`
  ));
  return `<style>${faces.join('')}</style>`;
}
