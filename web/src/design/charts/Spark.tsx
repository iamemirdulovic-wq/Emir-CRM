/**
 * The 96x36 sparkline that sits in the corner of every KPI card.
 * Ported from the design's `sparks()`.
 */
import { useLayoutEffect, useRef } from 'react';
import { smooth, scale, type Point } from './geometry.js';

const W = 96;
const H = 36;

export interface SparkProps {
  /** Oldest value first. Two or more points. */
  values: number[];
  /** Accessible description; omit for a purely decorative spark. */
  label?: string;
}

export function Spark({ values, label }: SparkProps) {
  const lineRef = useRef<SVGPathElement>(null);

  // The draw-in animation runs off --len, which only the browser can measure.
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (line) line.style.setProperty('--len', String(line.getTotalLength()));
  }, [values]);

  if (values.length < 2) return <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const points: Point[] = values.map((value, i) => [
    i * (W / (values.length - 1)),
    H - 4 - scale(value, min, max) * (H - 8),
  ]);

  const d = smooth(points);
  // points mirrors values, which the guard above proved has two or more entries.
  const [lastX, lastY] = points[points.length - 1] as Point;

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${W} ${H}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable={false}
    >
      <path className="a" d={`${d} L${W} ${H} L0 ${H} Z`} />
      <path className="l" ref={lineRef} d={d} />
      <circle cx={lastX} cy={lastY} r="3" fill="var(--primary)" />
    </svg>
  );
}
