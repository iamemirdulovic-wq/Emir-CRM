/**
 * The card on screen: the same SVG that goes to the printer, in a div.
 *
 * It is injected rather than built as JSX because the artboard is one string
 * produced by one function — the moment the preview is assembled separately,
 * it starts telling a different story from the PDF.
 */
import { useMemo } from 'react';
import { renderFace, type CardDetails, type CardOptions } from './artboard.js';
import type { Template } from './brand.js';

export function CardFace({
  template, details, options, side, className, grain = true,
}: {
  template: Template;
  details: CardDetails;
  options: CardOptions;
  side: 'front' | 'back';
  className?: string;
  /** Paper texture, on screen only. Never exported. */
  grain?: boolean;
}) {
  const svg = useMemo(
    () => renderFace({ template, details, options, side }),
    [template, details, options, side],
  );
  return (
    <div
      className={`bc-face${grain ? ' grain' : ''}${className ? ` ${className}` : ''}`}
      // The SVG is built entirely from our own template and escaped details;
      // nothing a user types reaches it unescaped. See escapeXml in artboard.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Front and back at an angle, which is how a card is actually shown to people. */
export function CardMockup({
  template, details, options, flipped = false,
}: {
  template: Template;
  details: CardDetails;
  options: CardOptions;
  flipped?: boolean;
}) {
  const dark = template.front.background !== '#FBF7F3';
  return (
    <div className={dark ? 'bc-mockup dark' : 'bc-mockup'}>
      <div className="bc-tilt">
        <CardFace
          template={template} details={details} options={options}
          side={flipped ? 'front' : 'back'} className="bc-behind"
        />
        <CardFace
          template={template} details={details} options={options}
          side={flipped ? 'back' : 'front'} className="bc-infront"
        />
      </div>
    </div>
  );
}
