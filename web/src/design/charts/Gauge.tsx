/**
 * The half-circle gauge used for speed-to-lead. Ported from the design's
 * `gauge()`: the arc is drawn by sweeping stroke-dashoffset from full to the
 * fraction of `max` that `value` represents.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../theme.js';

export interface GaugeProps {
  value: number;
  /** Value at a full sweep. */
  max: number;
  /** Labels under the two ends of the arc. */
  footStart?: string;
  footEnd?: string;
  children?: React.ReactNode;
}

export function Gauge({ value, max, footStart, footEnd, children }: GaugeProps) {
  const arcRef = useRef<SVGPathElement>(null);
  const [length, setLength] = useState(0);
  const [swept, setSwept] = useState(false);
  const reduceMotion = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const arc = arcRef.current;
    if (arc) setLength(arc.getTotalLength());
  }, []);

  useEffect(() => {
    if (reduceMotion) return setSwept(true);
    const timer = setTimeout(() => setSwept(true), 120);
    return () => clearTimeout(timer);
  }, [reduceMotion, value, max]);

  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const path = 'M20 120 A100 100 0 0 1 220 120';

  return (
    <>
      <svg className="gauge" viewBox="0 0 240 140" aria-hidden focusable={false}>
        <path className="trk" d={path} />
        <path
          className="val"
          ref={arcRef}
          d={path}
          style={{
            // --len feeds the stroke-dasharray in the stylesheet.
            ['--len' as string]: length,
            strokeDashoffset: swept ? length * (1 - fraction) : length,
            transition: reduceMotion ? 'none' : undefined,
          }}
        />
      </svg>
      {children}
      {(footStart || footEnd) && (
        <div className="gauge-foot">
          <span>{footStart}</span>
          <span>{footEnd}</span>
        </div>
      )}
    </>
  );
}
