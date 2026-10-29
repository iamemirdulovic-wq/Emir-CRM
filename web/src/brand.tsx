/**
 * Who this CRM says it is.
 *
 * The name and the mark were written out in seven places — the sidebar, the
 * sign-in card, first-run setup, the change-password screen, the browser tab,
 * the notification instructions. Renaming the product meant finding all seven
 * and missing one. They live here instead, so a rebrand is one edit.
 *
 * Two places still spell it out and cannot read this: `web/index.html`, which
 * is plain HTML served before any script runs, and `web/public/icon.svg`.
 * Both are listed in docs/DESIGN.md next to this file.
 */
export const BRAND = {
  /** Shown beside the mark, and as the fallback page title. */
  name: 'Emir CRM',
  /**
   * The short mark in the rounded square, for the many places with no room for
   * a logo — a sidebar 34px tall, a sign-in card on a phone. One or two
   * characters; anything longer is cropped by the square rather than scaled.
   */
  mark: 'E',
} as const;

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
      <div className="brand-mark" aria-hidden="true">{BRAND.mark}</div>
      <span>{BRAND.name}</span>
    </div>
  );
}
