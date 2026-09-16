/**
 * The dashboard's "over time" chart: a smoothed area for this period, a dashed
 * line for the previous one, a grid, axis labels, and a crosshair tooltip.
 *
 * Ported from the design's `areaChart()`. The design generates its own demo
 * series; this takes real points, which is the whole difference.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { smooth, type Point } from './geometry.js';
import { usePrefersReducedMotion } from '../theme.js';

const PAD = { l: 34, r: 10, t: 10, b: 26 };
const GRID_LINES = 4;
/** Used until the container has been measured, matching the design's fallback. */
const FALLBACK = { w: 600, h: 250 };

export interface AreaPoint {
  /** X-axis label, already formatted for the reader's locale. */
  label: string;
  value: number;
  /** Same slot in the previous period; omit to hide the comparison line. */
  previous?: number;
}

export interface AreaChartProps {
  points: AreaPoint[];
  /** Noun for the tooltip, e.g. "leads". */
  unit?: string;
}

export function AreaChart({ points, unit = '' }: AreaChartProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<SVGPathElement>(null);
  const previousRef = useRef<SVGPathElement>(null);
  const [size, setSize] = useState(FALLBACK);
  const [hover, setHover] = useState<number | null>(null);
  const reduceMotion = usePrefersReducedMotion();

  // The chart is laid out in pixels, not a fixed viewBox, so it has to know how
  // wide it actually is. ResizeObserver also covers the sidebar collapsing.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () =>
      setSize({ w: box.clientWidth || FALLBACK.w, h: box.clientHeight || FALLBACK.h });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const { w: W, h: H } = size;
  const count = points.length;
  const hasPrevious = points.some((p) => p.previous !== undefined);

  const values = points.map((p) => p.value);
  const previousValues = points.map((p) => p.previous ?? 0);
  const peak = Math.max(1, ...values, ...(hasPrevious ? previousValues : []));
  // Round the axis up to a friendly number, as the design does.
  const max = Math.ceil((peak * 1.15) / 10) * 10 || 10;

  const x = (i: number) => (count < 2 ? PAD.l : PAD.l + i * ((W - PAD.l - PAD.r) / (count - 1)));
  const y = (value: number) => PAD.t + (1 - value / max) * (H - PAD.t - PAD.b);

  const currentPoints: Point[] = points.map((p, i) => [x(i), y(p.value)]);
  const previousPoints: Point[] = points.map((p, i) => [x(i), y(p.previous ?? 0)]);
  const currentPath = smooth(currentPoints);

  // Measure the drawn paths so the stroke-dash animation has a length to run to.
  useLayoutEffect(() => {
    for (const ref of [currentRef, previousRef]) {
      const path = ref.current;
      if (path) path.style.setProperty('--len', String(path.getTotalLength()));
    }
  }, [currentPath, W, H]);

  const gridStep = (H - PAD.t - PAD.b) / GRID_LINES;
  const labelEvery = Math.max(1, Math.ceil(count / 6));

  function track(event: React.MouseEvent<SVGRectElement>) {
    if (count < 2) return;
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const svgX = (event.clientX - rect.left) * (W / rect.width);
    const step = (W - PAD.l - PAD.r) / (count - 1);
    setHover(Math.max(0, Math.min(count - 1, Math.round((svgX - PAD.l) / step))));
  }

  const active = hover === null ? null : points[hover];
  const difference =
    active && active.previous !== undefined ? active.value - active.previous : null;

  if (count === 0) {
    return (
      <div className="chart-wrap" ref={boxRef}>
        <p className="muted" style={{ textAlign: 'center', paddingTop: 90 }}>
          No data for this period yet.
        </p>
      </div>
    );
  }

  return (
    <div className="chart-wrap" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`}>
        {Array.from({ length: GRID_LINES + 1 }, (_, k) => {
          const gy = PAD.t + k * gridStep;
          return (
            <g key={k}>
              <line className="grid-l" x1={PAD.l} x2={W - PAD.r} y1={gy} y2={gy} />
              <text className="axis" x="0" y={gy + 4}>
                {Math.round(max * (1 - k / GRID_LINES))}
              </text>
            </g>
          );
        })}

        {points.map((point, i) =>
          i % labelEvery === 0 ? (
            <text className="axis" key={point.label + i} x={x(i)} y={H - 6} textAnchor="middle">
              {point.label}
            </text>
          ) : null,
        )}

        <path
          className="area-fill"
          fill="url(#areaFill)"
          d={`${currentPath} L${x(count - 1)} ${H - PAD.b} L${PAD.l} ${H - PAD.b} Z`}
        />
        {hasPrevious && (
          <path className="area-line b drawn" ref={previousRef} d={smooth(previousPoints)} />
        )}
        <path className="area-line drawn" ref={currentRef} d={currentPath} />

        {active && (
          <>
            <line
              className="cross"
              x1={x(hover!)}
              x2={x(hover!)}
              y1={PAD.t}
              y2={H - PAD.b}
              style={{ opacity: 0.5 }}
            />
            <circle
              className="dotc"
              r="5"
              cx={x(hover!)}
              cy={y(active.value)}
              style={{ opacity: 1 }}
            />
          </>
        )}

        <rect
          x={PAD.l}
          y="0"
          width={Math.max(0, W - PAD.l - PAD.r)}
          height={H}
          fill="transparent"
          onMouseMove={track}
          onMouseLeave={() => setHover(null)}
        />
      </svg>

      {active && (
        <div
          className="tip"
          style={{
            opacity: 1,
            // The svg is drawn in viewBox units but positioned in CSS pixels.
            left: `${(x(hover!) / W) * 100}%`,
            top: `${(y(active.value) / H) * 100}%`,
            // A tooltip that animates in under reduce-motion is just noise.
            transition: reduceMotion ? 'none' : undefined,
          }}
        >
          {active.label}
          <b>
            {active.value.toLocaleString()}
            {unit ? ` ${unit}` : ''}
          </b>
          {difference !== null && `${difference >= 0 ? '+' : ''}${difference} vs previous`}
        </div>
      )}
    </div>
  );
}
