import { Fragment } from 'react';

/**
 * The day-by-hour heatmap. Ported from the design's `heat()`: a 12-column grid
 * with a row label, each cell fading to its own opacity on a 12ms-per-cell
 * stagger.
 *
 * The design fills the grid from a sine curve. This takes real counts and
 * normalises them, so an empty hour reads as empty instead of as low activity.
 */
export interface HeatProps {
  /** Column headers, e.g. ['8a','10a','12p',...]. */
  hours: string[];
  rows: { label: string; values: number[] }[];
  /** Tooltip text for a cell; the default is "Mon 8a — 12". */
  describe?: (row: string, hour: string, value: number) => string;
}

const MIN_OPACITY = 0.06;
const MAX_OPACITY = 0.95;

export function Heat({ hours, rows, describe }: HeatProps) {
  const peak = Math.max(1, ...rows.flatMap((row) => row.values));
  const columns = `34px repeat(${hours.length}, 1fr)`;

  return (
    <div className="heat" style={{ gridTemplateColumns: columns }}>
      <em />
      {hours.map((hour) => (
        <em key={hour}>{hour}</em>
      ))}
      {rows.map((row, r) => (
        <Fragment key={row.label}>
          <em style={{ textAlign: 'left' }}>{row.label}</em>
          {hours.map((hour, c) => {
            const value = row.values[c] ?? 0;
            // Zero stays at the floor opacity so "nothing happened" is visible
            // as nothing, not as a faint reading.
            const opacity =
              value === 0
                ? MIN_OPACITY
                : MIN_OPACITY + (value / peak) * (MAX_OPACITY - MIN_OPACITY);
            return (
              <span
                key={hour}
                style={{
                  ['--o' as string]: opacity.toFixed(2),
                  animationDelay: `${(r * hours.length + c) * 12}ms`,
                }}
                title={
                  describe
                    ? describe(row.label, hour, value)
                    : `${row.label} ${hour} — ${value}`
                }
              />
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
