/**
 * The gradient fills the sparklines and the area chart paint with. Rendered
 * once per screen that draws a chart; the ids are global to the document, which
 * is how the design refers to them (`url(#sparkFill)`).
 *
 * The design hard-codes the light-mode teal in these stops. We read --primary
 * instead so the fills follow the theme; in light mode the result is identical.
 */
export function ChartDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable={false}>
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--primary)' }} stopOpacity=".25" />
          <stop offset="1" style={{ stopColor: 'var(--primary)' }} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--primary)' }} stopOpacity=".28" />
          <stop offset="1" style={{ stopColor: 'var(--primary)' }} stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
