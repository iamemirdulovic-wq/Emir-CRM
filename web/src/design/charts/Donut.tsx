/**
 * The source-breakdown donut with its legend. Ported from the design's
 * `donut()`: a 60px radius ring, a 6-unit gap between segments, segments that
 * grow from zero, and a legend row that dims the others on hover.
 */
import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '../theme.js';

const R = 60;
const CIRCUMFERENCE = 2 * Math.PI * R;
const GAP = 6;

export interface DonutSlice {
  label: string;
  value: number;
  colour: string;
}

export interface DonutProps {
  slices: DonutSlice[];
  /** Big number in the middle; the total is used when omitted. */
  centre?: string;
  centreLabel?: string;
}

export function Donut({ slices, centre, centreLabel }: DonutProps) {
  const reduceMotion = usePrefersReducedMotion();
  // Segments start collapsed and are grown on the next frame, which is what
  // makes the CSS transition on stroke-dasharray run.
  const [grown, setGrown] = useState(reduceMotion);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (reduceMotion) return setGrown(true);
    const frame = requestAnimationFrame(() => setTimeout(() => setGrown(true), 80));
    return () => cancelAnimationFrame(frame);
  }, [reduceMotion, slices]);

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return <p className="muted">Nothing to show yet.</p>;

  let offset = 0;
  const segments = slices.map((slice, i) => {
    const length = (slice.value / total) * CIRCUMFERENCE - GAP;
    const segment = { ...slice, length: Math.max(0, length), offset, index: i };
    offset += (slice.value / total) * CIRCUMFERENCE;
    return segment;
  });

  return (
    <div className="donut-box">
      <div className="donut-c">
        <svg className="donut" viewBox="0 0 150 150" aria-hidden focusable={false}>
          {segments.map((segment) => (
            <circle
              key={segment.label}
              cx="75"
              cy="75"
              r={R}
              stroke={segment.colour}
              strokeDasharray={
                grown ? `${segment.length} ${CIRCUMFERENCE}` : `0 ${CIRCUMFERENCE}`
              }
              strokeDashoffset={-segment.offset}
              style={{
                opacity: hovered === null || hovered === segment.index ? 1 : 0.25,
                transition: reduceMotion ? 'none' : undefined,
              }}
            />
          ))}
        </svg>
        <div className="mid">
          {/* The inner div matters: .mid is a centring grid, so without it the
              number and the label become two rows and the label slides over
              the ring. The design wraps them the same way. */}
          <div>
            <b>{centre ?? total.toLocaleString()}</b>
            {centreLabel && <small>{centreLabel}</small>}
          </div>
        </div>
      </div>

      <div className="src-list">
        {segments.map((segment) => (
          <div
            key={segment.label}
            onMouseEnter={() => setHovered(segment.index)}
            onMouseLeave={() => setHovered(null)}
          >
            <i style={{ background: segment.colour }} />
            {segment.label}
            <b>{Math.round((segment.value / total) * 100)}%</b>
          </div>
        ))}
      </div>
    </div>
  );
}
