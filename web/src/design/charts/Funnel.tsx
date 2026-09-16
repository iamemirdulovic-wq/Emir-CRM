/**
 * The pipeline funnel: one bar per stage, each growing to its share of the top
 * stage, staggered 90ms apart. Ported from the design's `funnel()`.
 */
import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '../theme.js';

const STAGGER_MS = 90;
const START_DELAY_MS = 150;

export interface FunnelStep {
  label: string;
  value: number;
}

export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const reduceMotion = usePrefersReducedMotion();
  const [grown, setGrown] = useState(reduceMotion ? steps.length : 0);

  useEffect(() => {
    if (reduceMotion) return setGrown(steps.length);
    setGrown(0);
    const timers = steps.map((_, k) =>
      setTimeout(() => setGrown((n) => Math.max(n, k + 1)), START_DELAY_MS + k * STAGGER_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [steps, reduceMotion]);

  // Every bar is measured against the widest stage, which is the top of the
  // funnel — that is what makes the drop-off readable at a glance.
  const top = Math.max(1, ...steps.map((step) => step.value));

  return (
    <div>
      {steps.map((step, k) => (
        <div className="funnel-row" key={step.label} style={{ ['--k' as string]: k }}>
          <span>{step.label}</span>
          <div className="funnel-bar">
            <i
              className={k < grown ? 'go' : undefined}
              style={{ ['--w' as string]: `${Math.max(2, (step.value / top) * 100)}%` }}
            />
          </div>
          <b>{step.value.toLocaleString()}</b>
        </div>
      ))}
    </div>
  );
}
