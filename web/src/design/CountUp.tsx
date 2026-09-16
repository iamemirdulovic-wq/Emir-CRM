/**
 * A number that counts up to its value, as the approved design does for every
 * headline figure. Ported from the design's `countUp()`: 1.2s, cubic ease-out,
 * grouped thousands.
 *
 * With reduce-motion on it renders the final value immediately. It also
 * re-animates when the value changes, so a live KPI counts from where it was
 * rather than restarting from zero.
 */
import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from './theme.js';

const DURATION_MS = 1200;

export interface CountUpProps {
  value: number;
  /** Appended to the number, e.g. "%". */
  suffix?: string;
  prefix?: string;
  /** Decimal places; whole numbers by default. */
  decimals?: number;
  className?: string;
}

function format(value: number, decimals: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function CountUp({ value, suffix = '', prefix = '', decimals = 0, className }: CountUpProps) {
  const reduceMotion = usePrefersReducedMotion();
  const [shown, setShown] = useState(() => (reduceMotion ? value : 0));
  // Where the last animation ended, so a changing value counts on from there.
  const fromRef = useRef(reduceMotion ? value : 0);

  useEffect(() => {
    if (reduceMotion) {
      fromRef.current = value;
      setShown(value);
      return;
    }

    const from = fromRef.current;
    const start = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (value - from) * eased;
      setShown(current);
      if (progress < 1) frame = requestAnimationFrame(step);
      else fromRef.current = value;
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduceMotion]);

  const rounded = decimals === 0 ? Math.round(shown) : shown;
  return (
    <span className={className}>
      {prefix}
      {format(rounded, decimals)}
      {suffix}
    </span>
  );
}
