/**
 * The HTML of a public business card.
 *
 * Pure, so it can be rendered and looked at without a database and without a
 * running server — which is the only way a page nobody is logged in to gets
 * checked before a client sees it.
 *
 * Five kilobytes, no bundle, no session, no API call. A client who scans a QR
 * code at a sales centre on one bar of signal gets the page, and it works
 * with JavaScript off.
 */
import { escapeHtml } from '../email/merge.js';
import { renderCover } from './covers.js';
import { qrSvg } from './qr.js';
import type { ProfileRow } from './profiles.js';

function notFoundPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not found</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#EAF3F8;
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#4A5B70}</style>
</head><body><p>This card is not available.</p></body></html>`;
}

function publicPhone(profile: ProfileRow): string | null {
  return profile.public_phone || profile.phone_e164 || null;
}

function socialLinks(profile: ProfileRow): string {
  const links: string[] = [];
  const phone = publicPhone(profile);
  const whatsapp = profile.whatsapp || phone;

  if (phone) {
    links.push(`<a class="act primary" href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}">Call</a>`);
  }
  if (whatsapp) {
    links.push(`<a class="act wa" href="https://wa.me/${escapeHtml(whatsapp.replace(/\D/g, ''))}">WhatsApp</a>`);
  }
  const email = profile.public_email || profile.email;
  if (email) links.push(`<a class="act" href="mailto:${escapeHtml(email)}">Email</a>`);
  return links.join('');
}

function chips(value: unknown): string {
  const list = (() => {
    if (Array.isArray(value)) return value as string[];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? (parsed as string[]) : [];
      } catch {
        return [];
      }
    }
    return [];
  })();
  if (list.length === 0) return '';
  return `<div class="chips">${list.slice(0, 12).map((item) => `<span>${escapeHtml(String(item))}</span>`).join('')}</div>`;
}


/** The card itself. `url` is its own public address, for the QR. */
export function renderCardHtml(profile: ProfileRow, company: string, url: string): string {
  const photo = isSafePhotoUrl(profile.photo_url)
    ? `<img class="face" src="${escapeHtml(profile.photo_url as string)}" alt="" width="104" height="104">`
    : `<div class="face initials">${escapeHtml(initialsOf(profile.name))}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(profile.name)} — ${escapeHtml(company)}</title>
<meta name="description" content="${escapeHtml(profile.headline ?? `${profile.job_title ?? 'Property consultant'} at ${company}`)}">
<meta property="og:title" content="${escapeHtml(profile.name)}">
<meta property="og:description" content="${escapeHtml(profile.headline ?? company)}">
<style>
  :root{color-scheme:light dark}
  *{box-sizing:border-box}
  body{margin:0;background:#EAF3F8;color:#0E1B2C;
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans Arabic',Arial,sans-serif}
  .card{max-width:420px;margin:0 auto;background:#fff;min-height:100vh}
  .cover{position:relative;line-height:0}
  .cover svg{width:100%;height:auto;display:block}
  .face{position:absolute;left:50%;bottom:-52px;transform:translateX(-50%);
        width:104px;height:104px;border-radius:50%;border:4px solid #fff;object-fit:cover;
        background:#0AA3BA;box-shadow:0 6px 20px rgba(15,50,90,.18)}
  .initials{display:grid;place-items:center;color:#fff;font-size:34px;font-weight:700;line-height:1}
  main{padding:66px 22px 28px;text-align:center}
  h1{margin:0;font-size:23px;letter-spacing:-.01em}
  .role{margin:4px 0 0;color:#4A5B70;font-size:14.5px}
  .brn{margin:6px 0 0;color:#7E8DA0;font-size:12px}
  .headline{margin:16px 0 0;font-size:15px;line-height:1.6;color:#2B3B50}
  .bio{margin:12px 0 0;font-size:14px;line-height:1.65;color:#4A5B70;text-align:left;white-space:pre-wrap}
  .acts{display:flex;gap:8px;margin:20px 0 0}
  .act{flex:1;padding:12px 8px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;
       background:#EFF5F9;color:#0E1B2C}
  .act.primary{background:#0AA3BA;color:#fff}
  .act.wa{background:#34B36B;color:#fff}
  .chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:16px 0 0}
  .chips span{font-size:12px;padding:4px 11px;border-radius:99px;background:#EFF5F9;color:#4A5B70}
  .save{display:block;margin:20px 0 0;padding:13px;border-radius:12px;text-align:center;
        text-decoration:none;font-weight:700;font-size:14px;border:1px solid #0AA3BA;color:#0AA3BA}
  .qr{margin:22px auto 0;width:170px}
  .qr svg{width:100%;height:auto;display:block;border-radius:10px}
  .qr p{margin:7px 0 0;font-size:11.5px;color:#7E8DA0;text-align:center}
  footer{margin-top:24px;padding-top:16px;border-top:1px solid #E3ECF3;
         font-size:11.5px;color:#7E8DA0;line-height:1.6}
  @media (prefers-color-scheme:dark){
    body{background:#060D1A;color:#EAF4FF}
    .card{background:#101C2E}
    .role{color:#A7B7CC}.bio{color:#A7B7CC}.headline{color:#D5E3F2}
    .act{background:#1B2B40;color:#EAF4FF}
    .chips span{background:#1B2B40;color:#A7B7CC}
    footer{border-color:#1E2E44}
  }
</style>
</head>
<body>
<div class="card">
  <div class="cover">
    ${renderCover(profile.cover_key, 840, 220)}
    ${photo}
  </div>

  <main>
    <h1>${escapeHtml(profile.name)}</h1>
    <p class="role">${escapeHtml(profile.job_title ?? 'Property Consultant')} · ${escapeHtml(company)}</p>
    ${profile.brn ? `<p class="brn">BRN ${escapeHtml(profile.brn)}</p>` : ''}

    ${profile.headline ? `<p class="headline">${escapeHtml(profile.headline)}</p>` : ''}

    <div class="acts">${socialLinks(profile)}</div>

    ${chips(profile.specialities)}
    ${chips(profile.languages)}

    ${profile.bio ? `<p class="bio">${escapeHtml(profile.bio)}</p>` : ''}

    <a class="save" href="/card/${escapeHtml(profile.slug)}/vcf">Save to contacts</a>

    <div class="qr">
      ${qrSvg(url, { size: 170 })}
      <p>Scan to open this card</p>
    </div>

    <footer>
      ${escapeHtml(company)}<br>
      This card is shared by ${escapeHtml(profile.name)}. Property details, prices and availability
      are confirmed in writing before any payment.
    </footer>
  </main>
</div>
</body>
</html>`;
}

export { notFoundPage, publicPhone, initialsOf };

/**
 * A photo this page is willing to load.
 *
 * `https://` for a photo hosted elsewhere, and a path beginning with a single
 * `/` for one uploaded here — which is what the profile screen produces, and
 * what this used to reject. The effect of rejecting it was quiet: the upload
 * worked, the file served, and the card showed initials anyway.
 *
 * `//evil.example` is excluded deliberately: the browser reads that as a host,
 * not a path, so it is an off-site URL wearing a path's clothes. Nothing else
 * gets through, which keeps `javascript:` and `data:` out of an `src` on a
 * page served to the public.
 */
export function isSafePhotoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (/^https:\/\//.test(url)) return true;
  return url.startsWith('/') && !url.startsWith('//');
}

/** "Layla Hassan" → "LH", for the circle when there is no photograph. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1]?.[0] ?? '' : '')).toUpperCase();
}
