/**
 * Shared chart geometry. Ported from the drawing helpers in
 * design/emir-crm-design.html so the curves match the approved design exactly.
 */

export type Point = [x: number, y: number];

/**
 * A Catmull-Rom-style smoothed path through the given points, emitted as cubic
 * beziers. This is the design's `smooth()`, unchanged: the control points are
 * a sixth of the span between each point's neighbours, which is what gives the
 * charts their soft shoulders without overshooting.
 */
export function smooth(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const [x, y] = points[0] as Point;
    return `M${x} ${y}`;
  }

  // Every index below is clamped into range, so the reads are always defined.
  const at = (i: number): Point => points[Math.max(0, Math.min(points.length - 1, i))] as Point;

  const [startX, startY] = at(0);
  let d = `M${startX} ${startY}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = at(i - 1);
    const [x1, y1] = at(i);
    const [x2, y2] = at(i + 1);
    const [x3, y3] = at(i + 2);
    d += ` C${x1 + (x2 - x0) / 6} ${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6} ${y2 - (y3 - y1) / 6} ${x2} ${y2}`;
  }
  return d;
}

/** Scales values into plot coordinates, guarding the flat-series divide-by-zero. */
export function scale(value: number, min: number, max: number): number {
  return max === min ? 0.5 : (value - min) / (max - min);
}
