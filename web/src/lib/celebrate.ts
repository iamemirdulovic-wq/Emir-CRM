import { play } from './sound.js';

/**
 * A small burst of confetti.
 *
 * Hand-rolled rather than a library: this is forty lines and one canvas, and
 * a dependency for it would be fifteen kilobytes an agent downloads on mobile
 * data to see something that lasts a second and a half.
 *
 * Respects reduce-motion by doing nothing at all. Someone who has asked their
 * device to stop animating things has asked for this too.
 */

const COLOURS = ['#00AFC8', '#3D7BFF', '#FF9F43', '#22C55E', '#FF5FA2', '#8B6CFF'];

interface Piece {
  x: number; y: number; vx: number; vy: number; rotation: number; spin: number;
  size: number; colour: string;
}

export function celebrate(options: { big?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);

  const context = canvas.getContext('2d');
  if (!context) {
    canvas.remove();
    return;
  }

  const count = options.big ? 160 : 70;
  const pieces: Piece[] = Array.from({ length: count }, () => ({
    /* From the middle, slightly above centre: a burst from the very bottom
       reads as something falling off the screen rather than celebrating. */
    x: canvas.width / 2 + (Math.random() - 0.5) * 120,
    y: canvas.height * 0.42,
    vx: (Math.random() - 0.5) * 13,
    vy: -7 - Math.random() * 9,
    rotation: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.3,
    size: 5 + Math.random() * 6,
    colour: COLOURS[Math.floor(Math.random() * COLOURS.length)] as string,
  }));

  const started = performance.now();
  const lifetime = options.big ? 2200 : 1500;

  function frame(now: number) {
    const elapsed = now - started;
    if (!context || elapsed > lifetime) {
      canvas.remove();
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    /* Fade the whole thing out rather than letting pieces vanish mid-air. */
    context.globalAlpha = Math.max(0, 1 - elapsed / lifetime);

    for (const piece of pieces) {
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.vy += 0.32;
      piece.vx *= 0.995;
      piece.rotation += piece.spin;

      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.rotation);
      context.fillStyle = piece.colour;
      context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.6);
      context.restore();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (options.big) play('won');
}
