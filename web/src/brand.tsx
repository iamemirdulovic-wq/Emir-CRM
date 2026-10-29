/**
 * Who this CRM says it is.
 *
 * The name and the mark were written out in seven places — the sidebar, the
 * sign-in card, first-run setup, the change-password screen, the browser tab,
 * the notification instructions. Renaming the product meant finding all seven
 * and missing one. They live here instead, so a rebrand is one edit.
 *
 * Two places still spell it out and cannot read this: `web/index.html`, which
 * is plain HTML served before any script runs, and the icons in `web/public/`.
 * Both are listed in docs/DESIGN.md next to this file.
 */
export const BRAND = {
  /**
   * Shown beside the mark, and as the fallback page title. Matches the
   * manifest's `short_name`, which is what a phone prints under the home
   * screen icon and what iOS lists under Settings → Notifications.
   */
  name: 'homes.me',
} as const;

/**
 * The homes.me mark: the orange roof over the smile.
 *
 * Drawn inline rather than loaded as an image so it is there on first paint —
 * the sidebar and the sign-in card are the first things on screen, and a logo
 * that pops in a moment late is the kind of small wrongness people notice
 * without being able to say why.
 *
 * The geometry is the brand kit's own, unchanged. `viewBox` matches the
 * supplied 512px icon so the proportions and the generous inset around the
 * mark are exactly as the kit draws them.
 */
export function BrandMark() {
  return (
    <svg viewBox="0 0 512 512" role="img" aria-label={BRAND.name} focusable="false">
      <rect width="512" height="512" fill="#FF4000" />
      <g transform="translate(81.92 87.14) scale(3.4816)">
        <path
          d="M14 43L50 11L86 43"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="20"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M24 67Q50 97 76 67" fill="none" stroke="#1A1A1A" strokeWidth="20" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/**
 * The mark and the name together, as they appear in the sidebar and on every
 * signed-out screen.
 *
 * `.brand` is a flex row, so the span is an ordinary flex item and sits
 * exactly where the bare text used to.
 */
export function BrandLockup() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <BrandMark />
      </div>
      <span>{BRAND.name}</span>
    </div>
  );
}
