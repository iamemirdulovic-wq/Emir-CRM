/**
 * One card side, drawn as an SVG artboard in real millimetres.
 *
 * Everything the studio produces comes from here — the preview on screen, the
 * PDF the printer gets, the JPG and the PNG. One source means the thing you
 * approve is the thing that prints; two sources means finding out at the
 * printer that the preview was lying.
 *
 * The unit is the millimetre, so the numbers below are the numbers on the
 * brand sheet rather than pixels that happen to look right.
 */
import { LOGO, logoRatio, watermarkIcon, type LogoKind } from './logo.js';
import { TAGLINE, type Face, type Template } from './brand.js';
import { qrMatrix } from '../lib/qr.js';

export type CardSize = 'uae' | 'us';

/** Trim size in mm. The UAE/European card is the default. */
export const SIZES: Record<CardSize, { w: number; h: number; label: string }> = {
  uae: { w: 85, h: 55, label: '85 × 55 mm' },
  us: { w: 88.9, h: 50.8, label: '3.5 × 2 in' },
};

/** Printers need the background to run past the cut, so the sheet is bigger. */
export const BLEED = 3;
/** Nothing readable goes nearer the cut than this. */
export const SAFE = 4;
export const CORNER_RADIUS = 3;

export interface CardDetails {
  fullName: string;
  jobTitle: string;
  brn: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
}

export interface CardOptions {
  size: CardSize;
  tagline: boolean;
  qr: boolean;
  roundedCorners: boolean;
  companyLine: boolean;
  /** Preview only — never exported. */
  showSafeArea?: boolean;
}

export const DEFAULT_DETAILS: CardDetails = {
  fullName: '',
  jobTitle: '',
  brn: '',
  phone: '',
  whatsapp: '',
  email: '',
  website: 'homes.me',
  addressLine1: 'Office 16, The Bayswater by Omniyat',
  addressLine2: 'Business Bay, Dubai, UAE',
};

export const DEFAULT_OPTIONS: CardOptions = {
  size: 'uae',
  tagline: true,
  qr: true,
  roundedCorners: true,
  companyLine: false,
  showSafeArea: false,
};

export const COMPANY_LINE = 'EMIGEO Homes Real Estate LLC';

/** Points to millimetres. The brand sheet sizes type in points. */
const PT = 25.4 / 72;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string
  ));
}

/**
 * "Emir Dulovic" → bold "Emir", regular "Dulovic".
 *
 * Everything after the first space is the surname, so "Emir Can Dulovic"
 * bolds only "Emir". That is the brand sheet's rule and it reads correctly
 * for the Arabic and South Asian names this team actually has.
 */
export function splitName(fullName: string): { first: string; last: string } {
  const trimmed = fullName.trim().replace(/\s+/g, ' ');
  if (!trimmed) return { first: '', last: '' };
  const cut = trimmed.indexOf(' ');
  if (cut < 0) return { first: trimmed, last: '' };
  return { first: trimmed.slice(0, cut), last: trimmed.slice(cut + 1) };
}

/** `FOUNDER · BRN 12345`, with the BRN only when there is one. */
export function titleLine(details: CardDetails): string {
  const title = details.jobTitle.trim().toUpperCase();
  const brn = details.brn.trim();
  if (title && brn) return `${title} · BRN ${brn}`;
  return title || (brn ? `BRN ${brn}` : '');
}

/**
 * The name shrinks rather than running off the card.
 *
 * Poppins Bold is roughly 0.60 em per character at these sizes; that estimate
 * only has to be good enough to pick a size, because the real text is
 * centred-left and has room to spare. It never goes below 10 pt — past that
 * the card looks like a mistake, and the caller shows a warning instead.
 */
export const NAME_PT_MAX = 14;
export const NAME_PT_MIN = 10;

export function nameFontPt(fullName: string, availableMm: number): number {
  const chars = fullName.trim().length || 1;
  for (let pt = NAME_PT_MAX; pt > NAME_PT_MIN; pt -= 0.5) {
    if (chars * pt * PT * 0.6 <= availableMm) return pt;
  }
  return NAME_PT_MIN;
}

export function nameOverflows(fullName: string, availableMm: number): boolean {
  const chars = fullName.trim().length || 1;
  return chars * NAME_PT_MIN * PT * 0.6 > availableMm;
}

/** The link the QR opens: a WhatsApp chat, or the website when there is no number. */
export function qrTarget(details: CardDetails): string {
  const number = (details.whatsapp || details.phone).replace(/[^\d]/g, '');
  if (number) return `https://wa.me/${number}`;
  const site = details.website.trim() || 'homes.me';
  return /^https?:\/\//.test(site) ? site : `https://${site}`;
}

/** The QR as SVG rects, sized to fit `sizeMm` including its quiet zone. */
function qrSvg(text: string, sizeMm: number, colour: string): string {
  const matrix = qrMatrix(text);
  const n = matrix.length;
  const cell = sizeMm / n;
  let out = '';
  for (let y = 0; y < n; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= n; x += 1) {
      const on = x < n && matrix[y]?.[x] === 1;
      if (on && runStart < 0) runStart = x;
      if (!on && runStart >= 0) {
        /* One rect per run of dark cells rather than per cell: it is the same
           picture in a fraction of the nodes, which keeps the PDF small. */
        const w = (x - runStart) * cell;
        out += `<rect x="${(runStart * cell).toFixed(4)}" y="${(y * cell).toFixed(4)}" `
          + `width="${w.toFixed(4)}" height="${cell.toFixed(4)}" fill="${colour}"/>`;
        runStart = -1;
      }
    }
  }
  return out;
}

/** A line icon, 2.5 mm, drawn to sit on the text's baseline. */
function lineIcon(kind: 'phone' | 'mail' | 'globe' | 'pin', x: number, y: number, colour: string): string {
  const s = 2.5;
  /* 0.3 rather than 0.26: a hairline that survives a screen can still vanish
     into a dark card at print size, and these are the four lines a client
     actually needs to read. */
  const common = `fill="none" stroke="${colour}" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round"`;
  const g = (body: string) => `<g transform="translate(${x.toFixed(3)} ${(y - s * 0.78).toFixed(3)}) scale(${(s / 24).toFixed(5)})" ${common}>${body}</g>`;
  switch (kind) {
    case 'phone':
      return g('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>');
    case 'mail':
      return g('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>');
    case 'globe':
      return g('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>');
    case 'pin':
    default:
      return g('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>');
  }
}

export interface FaceInput {
  template: Template;
  details: CardDetails;
  options: CardOptions;
  side: 'front' | 'back';
  /**
   * Leave the corners square even when the card is a rounded one.
   *
   * Set for the print PDF. Rounded corners are a die-cut, not something the
   * press prints: if the artwork arrives already rounded, the ink stops short
   * of the cut and the finished card shows white slivers at every corner. The
   * printer is told about the radius on the PDF's own note page instead.
   */
  squareForPrint?: boolean;
}

/**
 * The whole artboard: background, bleed, watermark and content.
 *
 * Returns an `<svg>` whose user units are millimetres and whose canvas
 * includes the bleed, so the same string can be shown on screen, rasterised
 * at any DPI, or dropped into a PDF page of exactly this size.
 */
export function renderFace(input: FaceInput): string {
  const { template, details, options, side } = input;
  const face: Face = side === 'front' ? template.front : template.back;
  const { w: tw, h: th } = SIZES[options.size];
  const W = tw + BLEED * 2;
  const H = th + BLEED * 2;
  /* The origin is the top-left of the trim, so every measurement below is
     "from the edge of the finished card" — which is how the brand sheet and
     the printer both talk about it. */
  const O = BLEED;

  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${face.background}"/>`);

  /* The watermark: the icon at 1.3× the card height, cropped off the
     bottom-right corner, behind everything. */
  const markSize = th * 1.3;
  parts.push(
    `<g transform="translate(${(O + tw - markSize * 0.52).toFixed(3)} ${(O + th - markSize * 0.62).toFixed(3)}) `
    + `scale(${(markSize / 100).toFixed(5)})">${watermarkIcon(face.watermark)}</g>`,
  );

  if (side === 'front') {
    parts.push(renderFront(face, options, tw, th, O));
  } else {
    parts.push(renderBack(face, details, options, tw, th, O));
  }

  if (options.showSafeArea) {
    parts.push(
      `<rect x="${O + SAFE}" y="${O + SAFE}" width="${tw - SAFE * 2}" height="${th - SAFE * 2}" `
      + `fill="none" stroke="#00AFC8" stroke-width="0.2" stroke-dasharray="1 1" opacity="0.8"/>`,
      `<rect x="${O}" y="${O}" width="${tw}" height="${th}" fill="none" stroke="#00AFC8" `
      + `stroke-width="0.2" opacity="0.5"/>`,
    );
  }

  /* On screen and in the PNG the corners are clipped, because that is the card
     the person is holding in their head. For print they stay square — see
     `squareForPrint`. */
  const round = options.roundedCorners && !input.squareForPrint;
  const clip = round
    ? `<defs><clipPath id="trim"><rect x="${O}" y="${O}" width="${tw}" height="${th}" rx="${CORNER_RADIUS}"/></clipPath></defs>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" `
    + `viewBox="0 0 ${W} ${H}" shape-rendering="geometricPrecision">${clip}`
    + `<g${round ? ' clip-path="url(#trim)"' : ''}>${parts.join('')}</g></svg>`;
}

function logoBlock(kind: LogoKind, x: number, y: number, widthMm: number): string {
  const { viewBox, body } = LOGO[kind];
  const height = widthMm / logoRatio(kind);
  const [vx, vy, vw] = viewBox.split(/\s+/).map(Number);
  const scale = widthMm / (vw as number);
  return `<g transform="translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${scale.toFixed(6)}) `
    + `translate(${(-(vx as number)).toFixed(3)} ${(-(vy as number)).toFixed(3)})">${body}</g>`
    + `<!--h:${height.toFixed(3)}-->`;
}

function renderFront(face: Face, options: CardOptions, tw: number, th: number, O: number): string {
  const logoWidth = tw * 0.57;
  const kind = face.logo as LogoKind;
  const logoHeight = logoWidth / logoRatio(kind);
  const centreY = O + th / 2 - (options.tagline ? 2.2 : 0);
  const out = [logoBlock(kind, O + (tw - logoWidth) / 2, centreY - logoHeight / 2, logoWidth)];

  if (options.tagline) {
    out.push(
      `<text x="${(O + tw / 2).toFixed(3)}" y="${(centreY + logoHeight / 2 + 4.1).toFixed(3)}" `
      + `text-anchor="middle" font-family="Poppins, sans-serif" font-weight="400" `
      + `font-size="${(7 * PT).toFixed(3)}" fill="${face.tagline}">${escapeXml(TAGLINE)}</text>`,
    );
  }
  return out.join('');
}

function renderBack(
  face: Face, details: CardDetails, options: CardOptions, tw: number, th: number, O: number,
): string {
  const out: string[] = [];
  const left = O + SAFE;
  const right = O + tw - SAFE;

  /* Top-left: the small logo, 21 mm wide. */
  const kind = face.logo as LogoKind;
  const logoWidth = 21;
  const logoHeight = logoWidth / logoRatio(kind);
  out.push(logoBlock(kind, left, O + SAFE, logoWidth));

  /* Top-right: the QR on a white tile, which is also its quiet zone. */
  let qrBottom = O + SAFE;
  if (options.qr) {
    const tile = 13.4;
    const pad = 1.2;
    const x = right - tile;
    const y = O + SAFE;
    out.push(
      `<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${tile}" height="${tile}" rx="1.5" fill="#FFFFFF"/>`,
      `<g transform="translate(${(x + pad).toFixed(3)} ${(y + pad).toFixed(3)})">`
      + `${qrSvg(qrTarget(details), tile - pad * 2, '#1A1A1A')}</g>`,
      `<text x="${(x + tile / 2).toFixed(3)}" y="${(y + tile + 2.1).toFixed(3)}" text-anchor="middle" `
      + `font-family="Poppins, sans-serif" font-weight="500" font-size="${(5 * PT).toFixed(3)}" `
      + `fill="${face.titleLine}">Scan to WhatsApp</text>`,
    );
    qrBottom = y + tile + 2.1;
  }

  /* The name, under the logo. */
  const { first, last } = splitName(details.fullName || 'Your Name');
  const available = (options.qr ? right - 15.5 : right) - left;
  const pt = nameFontPt(`${first} ${last}`, available);
  const nameY = O + SAFE + logoHeight + 7.4;
  out.push(
    `<text x="${left.toFixed(3)}" y="${nameY.toFixed(3)}" font-family="Poppins, sans-serif" `
    + `font-size="${(pt * PT).toFixed(3)}">`
    + `<tspan font-weight="700" fill="${face.firstName}">${escapeXml(first)}</tspan>`
    + (last ? `<tspan font-weight="400" fill="${face.lastName}"> ${escapeXml(last)}</tspan>` : '')
    + `</text>`,
  );

  const title = titleLine(details);
  if (title) {
    out.push(
      `<text x="${left.toFixed(3)}" y="${(nameY + 3.1).toFixed(3)}" font-family="Poppins, sans-serif" `
      + `font-weight="500" font-size="${(5.5 * PT).toFixed(3)}" letter-spacing="${(5.5 * PT * 0.2).toFixed(3)}" `
      + `fill="${face.titleLine}">${escapeXml(title)}</text>`,
    );
  }

  /* Contact lines, bottom-left, each with its icon. */
  const lines: Array<{ icon: 'phone' | 'mail' | 'globe' | 'pin'; text: string[] }> = [];
  if (details.phone.trim()) lines.push({ icon: 'phone', text: [details.phone.trim()] });
  if (details.email.trim()) lines.push({ icon: 'mail', text: [details.email.trim()] });
  if (details.website.trim()) lines.push({ icon: 'globe', text: [details.website.trim()] });
  const address = [details.addressLine1, details.addressLine2].map((l) => l.trim()).filter(Boolean);
  if (address.length) lines.push({ icon: 'pin', text: address });

  const lineGap = 2.7;
  const wrapGap = 2.2;
  const rows = lines.reduce((n, l) => n + l.text.length, 0);
  const companyRows = options.companyLine ? 1 : 0;
  let y = O + th - SAFE - 1.6 - (rows - 1) * lineGap - companyRows * 2.6;
  /* Never let the contact block climb into the name. */
  y = Math.max(y, Math.max(nameY + 6, qrBottom + 2.4));

  for (const line of lines) {
    out.push(lineIcon(line.icon, left, y, face.icons));
    line.text.forEach((text, i) => {
      out.push(
        `<text x="${(left + 3.6).toFixed(3)}" y="${(y + i * wrapGap).toFixed(3)}" `
        + `font-family="Poppins, sans-serif" font-weight="400" font-size="${(7 * PT).toFixed(3)}" `
        + `fill="${face.contactText}">${escapeXml(text)}</text>`,
      );
    });
    y += lineGap + (line.text.length - 1) * wrapGap;
  }

  if (options.companyLine) {
    out.push(
      `<text x="${left.toFixed(3)}" y="${(O + th - SAFE + 1.2).toFixed(3)}" font-family="Poppins, sans-serif" `
      + `font-weight="400" font-size="${(5 * PT).toFixed(3)}" fill="${face.titleLine}">`
      + `${escapeXml(COMPANY_LINE)}</text>`,
    );
  }

  return out.join('');
}
