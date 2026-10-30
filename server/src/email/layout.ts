/**
 * The wrapper every client email goes out in.
 *
 * Email clients are not browsers. Gmail strips `<style>` blocks in some views,
 * Outlook renders through Word, and nothing supports flexbox reliably. So this
 * is a table, the styles are inline, and the whole thing is one column — not
 * because that is nice, but because it is the only layout that survives.
 *
 * Three things are not optional and are added here rather than being left to
 * whoever writes a template:
 *
 * - **The agent's signature.** A property email from a name and a mobile
 *   number is answered; one from "Marketing" is not.
 * - **An unsubscribe link.** A bulk email without one is spam under every
 *   rule that matters and gets the sending domain blocked, which takes the
 *   one-to-one email down with it.
 * - **The company's legal footer.** Name and licence, because this is a
 *   regulated brokerage.
 */
import { escapeHtml } from './merge.js';

export interface Sender {
  name: string;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
  /** BRN — the broker's registration number, required on client-facing mail. */
  brn?: string | null;
  photoUrl?: string | null;
}

export interface Branding {
  companyName: string;
  companyLegalName?: string | null;
  address?: string | null;
  licenceNo?: string | null;
  website?: string | null;
  /** The accent, as a hex colour. Defaults to the CRM's teal. */
  accent?: string | null;
  logoUrl?: string | null;
}

export interface LayoutInput {
  /** The body, already merged. HTML, and already escaped where it came from data. */
  bodyHtml: string;
  sender: Sender;
  branding: Branding;
  /** Full URL. Omitted only for a one-to-one reply, never for a campaign. */
  unsubscribeUrl?: string | null;
  /** A 1×1 open tracker. Omitted when tracking is off. */
  trackingPixelUrl?: string | null;
  previewText?: string | null;
}

const DEFAULT_ACCENT = '#0AA3BA';

/**
 * Hex only, and checked.
 *
 * The accent is written straight into a style attribute, so a value that is
 * not a colour is a value that can close the attribute and add its own.
 */
function safeAccent(value: string | null | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_ACCENT;
}

/** Only http(s). A `javascript:` href in an email is a phishing link. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function signature(sender: Sender, accent: string): string {
  const lines: string[] = [];
  if (sender.title) lines.push(escapeHtml(sender.title));
  if (sender.phone) {
    const digits = sender.phone.replace(/[^\d+]/g, '');
    lines.push(`<a href="tel:${escapeHtml(digits)}" style="color:${accent};text-decoration:none">${escapeHtml(sender.phone)}</a>`);
  }
  if (sender.email) {
    lines.push(`<a href="mailto:${escapeHtml(sender.email)}" style="color:${accent};text-decoration:none">${escapeHtml(sender.email)}</a>`);
  }
  /* The BRN is a legal requirement on client-facing mail from a UAE broker,
     not a nicety. */
  if (sender.brn) lines.push(`BRN ${escapeHtml(sender.brn)}`);

  const photo = safeUrl(sender.photoUrl);
  const details = `
          <div style="font-weight:700;font-size:15px;color:#0E1B2C">${escapeHtml(sender.name)}</div>
          <div style="font-size:13px;color:#4A5B70;line-height:1.6">${lines.join('<br>')}</div>`;

  if (!photo) return `<div>${details}</div>`;

  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding-right:12px" valign="top">
            <img src="${escapeHtml(photo)}" width="52" height="52" alt=""
                 style="border-radius:50%;display:block;width:52px;height:52px;object-fit:cover">
          </td>
          <td valign="top">${details}</td>
        </tr>
      </table>`;
}

/** Wrap a merged body in the company's layout. */
export function renderEmail(input: LayoutInput): string {
  const accent = safeAccent(input.branding.accent);
  const logo = safeUrl(input.branding.logoUrl);
  const website = safeUrl(input.branding.website);
  const unsubscribe = safeUrl(input.unsubscribeUrl);
  const pixel = safeUrl(input.trackingPixelUrl);

  const legalName = input.branding.companyLegalName ?? input.branding.companyName;
  const footerBits = [escapeHtml(legalName)];
  if (input.branding.address) footerBits.push(escapeHtml(input.branding.address));
  if (input.branding.licenceNo) footerBits.push(`Licence ${escapeHtml(input.branding.licenceNo)}`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.branding.companyName)}</title>
</head>
<body style="margin:0;padding:0;background:#EAF3F8;-webkit-font-smoothing:antialiased">
${input.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.previewText)}</div>`
    : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EAF3F8">
  <tr>
    <td align="center" style="padding:24px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;
                    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
        <tr>
          <td style="background:${accent};padding:18px 24px">
            ${logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(input.branding.companyName)}" height="28" style="height:28px;display:block">`
    : `<div style="color:#ffffff;font-size:18px;font-weight:700">${escapeHtml(input.branding.companyName)}</div>`}
          </td>
        </tr>
        <tr>
          <td style="padding:26px 24px 8px;color:#0E1B2C;font-size:15px;line-height:1.65">
${input.bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:14px 24px 24px">
            <div style="border-top:1px solid #E3ECF3;padding-top:16px">
${signature(input.sender, accent)}
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#F4F9FC;padding:16px 24px;color:#7E8DA0;font-size:11.5px;line-height:1.6">
            ${footerBits.join(' · ')}
            ${website ? `<br><a href="${escapeHtml(website)}" style="color:#7E8DA0">${escapeHtml(website)}</a>` : ''}
            ${unsubscribe
    ? `<br><br>You are receiving this because you enquired with us about a property.
               <a href="${escapeHtml(unsubscribe)}" style="color:#7E8DA0;text-decoration:underline">Unsubscribe</a>`
    : ''}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
${pixel ? `<img src="${escapeHtml(pixel)}" width="1" height="1" alt="" style="display:block;border:0">` : ''}
</body>
</html>`;
}

/**
 * The plain-text alternative.
 *
 * Not optional: a message with no text part scores worse with every spam
 * filter, and some corporate mail clients show nothing else.
 */
export function plainTextFallback(input: {
  bodyText: string;
  sender: Sender;
  branding: Branding;
  unsubscribeUrl?: string | null;
}): string {
  const lines = [input.bodyText.trim(), '', '--', input.sender.name];
  if (input.sender.title) lines.push(input.sender.title);
  if (input.sender.phone) lines.push(input.sender.phone);
  if (input.sender.email) lines.push(input.sender.email);
  if (input.sender.brn) lines.push(`BRN ${input.sender.brn}`);
  lines.push('', input.branding.companyLegalName ?? input.branding.companyName);
  if (input.branding.licenceNo) lines.push(`Licence ${input.branding.licenceNo}`);
  const unsubscribe = safeUrl(input.unsubscribeUrl);
  if (unsubscribe) lines.push('', `Unsubscribe: ${unsubscribe}`);
  return lines.join('\n');
}

/** Turn a composer's plain paragraphs into the HTML the layout expects. */
export function paragraphsToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 14px">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}
