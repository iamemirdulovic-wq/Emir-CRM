import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../design/index.js';
import { placeBubble, spotlight, stepsFor, tourProgress, type Placed, type Rect } from '../lib/tour.js';
import type { Role } from '../lib/types.js';

/**
 * The guided tour: a dark overlay, a ring around one thing, and a bubble.
 *
 * The awkward part of a tour is that the thing it points at might not be on
 * screen — the sidebar is hidden on a phone, and a step about the Incoming
 * screen is meaningless on the Dashboard. So each step may navigate first, and
 * a step whose anchor cannot be found is skipped rather than shown pointing at
 * the corner of the window. A tour that confidently points at nothing is worse
 * than no tour.
 */

export interface TourProps {
  open: boolean;
  role: Role;
  /** Which step to start on, so a half-finished tour resumes. */
  startAt?: number;
  onStep: (step: number) => void;
  onFinish: (how: 'done' | 'skipped') => void;
}

export function Tour({ open, role, startAt = 0, onStep, onFinish }: TourProps) {
  const steps = stepsFor(role);
  const navigate = useNavigate();
  const [index, setIndex] = useState(startAt);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  const step = steps[Math.min(index, steps.length - 1)];

  useEffect(() => {
    if (open) setIndex(Math.min(startAt, steps.length - 1));
  }, [open, startAt, steps.length]);

  /* Send them to the screen the step is about, before looking for the anchor. */
  useEffect(() => {
    if (!open || !step?.goTo) return;
    navigate(step.goTo);
  }, [open, step?.goTo, navigate, step]);

  const measure = useCallback(() => {
    if (!open || !step) return;
    /*
     * The first match that is actually on screen, not the first in the
     * document. A nav link exists twice — once in the sidebar, once in the
     * phone bar — and whichever one is hidden has no size, so pointing at it
     * would put the ring in the top-left corner.
     */
    const found = Array.from(document.querySelectorAll(step.anchor))
      .map((element) => element.getBoundingClientRect())
      .find((box) => box.width > 0 && box.height > 0);

    setAnchor(found ? { top: found.top, left: found.left, width: found.width, height: found.height } : null);
  }, [open, step]);

  /* After paint, because the step may have just navigated. */
  useLayoutEffect(() => {
    measure();
    const timer = window.setTimeout(measure, 120);
    return () => window.clearTimeout(timer);
  }, [measure, index]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure, open]);

  useLayoutEffect(() => {
    if (!open || !step) return;
    const size = bubble.current?.getBoundingClientRect();
    const box = { width: size?.width ?? 330, height: size?.height ?? 190 };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (anchor) {
      setPlaced(placeBubble(anchor, box, viewport, step.prefer));
    } else {
      /* No anchor: centre it and say what it is about instead of pointing. */
      setPlaced({
        placement: 'bottom',
        left: Math.max(12, viewport.width / 2 - box.width / 2),
        top: Math.max(12, viewport.height / 2 - box.height / 2),
      });
    }
  }, [anchor, open, step, index]);

  const go = useCallback(
    (next: number) => {
      if (next >= steps.length) {
        onFinish('done');
        return;
      }
      const clamped = Math.max(0, next);
      setIndex(clamped);
      onStep(clamped);
    },
    [onFinish, onStep, steps.length],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onFinish('skipped');
      } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        go(index + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        go(index - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index, onFinish, open]);

  if (!open || !step) return null;

  const ring = anchor ? spotlight(anchor) : null;
  const progress = tourProgress(index, steps.length);

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={`Tour, ${progress.label}`}>
      <div
        className={ring ? 'tour-dim' : 'tour-dim solo'}
        onClick={() => onFinish('skipped')}
        role="presentation"
      />
      {ring && (
        <div
          className="tour-ring"
          style={{ top: ring.top, left: ring.left, width: ring.width, height: ring.height }}
          aria-hidden="true"
        />
      )}
      <div
        className={`tour-bubble is-${placed?.placement ?? 'bottom'}`}
        ref={bubble}
        style={{ top: placed?.top ?? 0, left: placed?.left ?? 0 }}
      >
        <div className="tour-bar" aria-hidden="true">
          <span style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <footer>
          <span className="tour-count">{progress.label}</span>
          <div className="tour-buttons">
            <button type="button" className="btn btn-ghost" onClick={() => onFinish('skipped')}>
              Skip
            </button>
            {index > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => go(index - 1)}>
                Back
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => go(index + 1)}>
              <span>{index + 1 >= steps.length ? 'Finish' : 'Next'}</span>
              {index + 1 < steps.length && <Icon name="arrow-right" />}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
