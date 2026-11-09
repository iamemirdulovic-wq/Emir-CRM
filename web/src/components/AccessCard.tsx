/**
 * "Your CRM is ready" as a picture, not a paragraph.
 *
 * Email to @homes.me is not connected, so these nine sign-ins go out on
 * WhatsApp. A wall of plain text with a password in the middle of it is easy
 * to skim past and easy to get wrong. A card is read.
 *
 * It is drawn as SVG and rasterised the same way the business card is — the
 * repo already has that path, fonts and all — rather than photographing the
 * DOM with another library.
 *
 * A caution worth keeping in mind while editing this: the card carries a
 * working password. It is for one person, sent one-to-one, and the card says
 * so on its face.
 */
import { useState } from 'react';
import { poppinsStyleBlock } from '../card/fonts.js';
import { rasterise, withFonts } from '../card/export.js';
import { Button } from '../design/forms.js';
import { Modal, useToast } from '../design/ui.js';

export interface Access {
  name: string;
  email: string;
  password: string;
  url: string;
}

/* 90 × 126mm, which rasterises to roughly 1060 × 1490 — a portrait image that
   fills a phone screen in WhatsApp without being cropped. */
const W_MM = 90;
const H_MM = 126;
const VB_W = 900;
const VB_H = 1260;

const RULES: Array<[string, string]> = [
  ['Open it every day', 'If it is not in the CRM, it did not happen.'],
  ['Press “I am here” each morning', 'At the top of your Dashboard, on the office Wi-Fi.'],
  ['Five minutes on a new lead', 'After that it goes back and somebody else takes it.'],
];

/** SVG has no word wrap, so anything that can run long is split by hand. */
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string
  ));
}

export function accessCardSvg(access: Access): string {
  const first = esc(access.name.split(' ')[0] ?? access.name);

  const rules = RULES.map(([title, detail], i) => {
    const y = 806 + i * 118;
    return `
      <rect x="64" y="${y - 30}" width="40" height="40" rx="13" fill="#EDF6DF"/>
      <text x="84" y="${y - 2}" font-size="21" font-weight="600" fill="#2F5208"
            text-anchor="middle">${i + 1}</text>
      <text x="124" y="${y - 4}" font-size="25" font-weight="600" fill="#16181B">${esc(title)}</text>
      <text x="124" y="${y + 30}" font-size="21" fill="#5F656D">${esc(detail)}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}" width="${VB_W}" height="${VB_H}">
  <rect width="${VB_W}" height="${VB_H}" fill="#F2F5EE"/>
  <rect x="26" y="26" width="${VB_W - 52}" height="${VB_H - 52}" rx="40" fill="#FFFFFF"/>

  <!-- The mark, drawn rather than linked, so the image needs nothing else -->
  <rect x="64" y="74" width="62" height="62" rx="17" fill="#F1511B"/>
  <path d="M79 108 L95 94 L111 108" fill="none" stroke="#FFFFFF" stroke-width="8"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M82 114 C87 126, 103 126, 108 114" fill="none" stroke="#17181A" stroke-width="8"
        stroke-linecap="round"/>
  <text x="142" y="118" font-size="30" font-weight="700" fill="#16181B">homes.me</text>

  <text x="64" y="212" font-size="44" font-weight="700" fill="#16181B">Welcome, ${first}.</text>
  <text x="64" y="258" font-size="23" fill="#5F656D">Your CRM is ready — leads, WhatsApp,</text>
  <text x="64" y="290" font-size="23" fill="#5F656D">email and every project in one place.</text>

  <rect x="56" y="330" width="${VB_W - 112}" height="326" rx="26" fill="#F7FAF2" stroke="#E2E6DF"/>
  <text x="88" y="378" font-size="18" font-weight="600" fill="#6B7466"
        letter-spacing="2">YOUR SIGN-IN</text>

  <text x="88" y="430" font-size="20" fill="#6B7466">Address</text>
  <text x="88" y="464" font-size="26" font-weight="600" fill="#16181B">${esc(access.url)}</text>

  <text x="88" y="516" font-size="20" fill="#6B7466">Email</text>
  <text x="88" y="550" font-size="26" font-weight="600" fill="#16181B"
        font-family="monospace">${esc(access.email)}</text>

  <text x="88" y="602" font-size="20" fill="#6B7466">Password</text>
  <text x="88" y="636" font-size="28" font-weight="700" fill="#16181B"
        font-family="monospace" letter-spacing="1">${esc(access.password)}</text>

  <text x="64" y="700" font-size="21" fill="#5F656D">It asks you to pick your own password straight</text>
  <text x="64" y="730" font-size="21" fill="#5F656D">away. Do that, then delete this message.</text>

  ${rules}

  <line x1="64" y1="1104" x2="${VB_W - 64}" y2="1104" stroke="#E2E6DF" stroke-width="2"/>
  <text x="64" y="1152" font-size="27" font-weight="700" fill="#2F5208">Close more, earn more.</text>
  <text x="64" y="1192" font-size="20" fill="#868D93">Anything broken or missing — tell me.</text>
</svg>`;
}

/** The same thing in words, for pasting beside the picture. */
export function accessCardText(access: Access): string {
  const first = access.name.split(' ')[0] ?? access.name;
  return [
    `Hey ${first} 👋`,
    '',
    'Your homes.me CRM is ready.',
    '',
    access.url,
    `Email: ${access.email}`,
    `Password: ${access.password}`,
    '',
    'It will ask you to pick your own password straight away. Do that, then delete this message.',
    '',
    ...RULES.map(([title, detail]) => `• ${title} — ${detail}`),
    '',
    'It is still being built, so if anything is broken or missing, tell me. Yallah 🚀',
  ].join('\n');
}

export function AccessCardModal({ access, onClose }: { access: Access; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const svg = accessCardSvg(access);

  async function savePng() {
    setBusy(true);
    try {
      const withPoppins = withFonts(svg, await poppinsStyleBlock());
      const blob = await rasterise(withPoppins, W_MM, H_MM, 1, null);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `crm-access-${access.email.split('@')[0]}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast('The image could not be made. Copy the words instead.');
    } finally {
      setBusy(false);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(accessCardText(access));
      toast('Copied — send it to them on their own chat, not the group');
    } catch {
      toast('Could not copy. Select the text and copy it by hand.');
    }
  }

  return (
    <Modal open wide icon="id-card" title={`For ${access.name}`} onClose={onClose}>
      <div className="access">
        <div
          className="access-art"
          /* The card is ours: built in this file from our own values, never
             from anything a lead or a webhook sent. */
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="access-side">
          <p className="muted">
            Send this to <b>{access.name}</b> on their own chat. Never in the team
            group — a password in a group is a password nine people have.
          </p>
          <Button variant="primary" icon="image-up" loading={busy} onClick={() => void savePng()}>
            Save the picture
          </Button>
          <Button icon="copy" onClick={() => void copyText()}>Copy as words</Button>
        </div>
      </div>
    </Modal>
  );
}
