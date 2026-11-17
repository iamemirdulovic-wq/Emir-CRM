import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

/**
 * Homes AI is one thing, reached from the bar.
 *
 * The floating orb it replaced is the reason these assertions exist: it held
 * its own conversation, answered eight fixed questions and told everybody
 * else that Homes AI was still being built — while the real assistant, which
 * reads the database, sat on a page with no way in from the header.
 */
describe('the Homes AI star', () => {
  it('goes to the one real Homes AI, and says so to a screen reader', () => {
    const src = read('./HomesAiStar.tsx');
    expect(src).toContain('to="/v2/ai"');
    expect(src).toContain('aria-label="Ask Homes AI"');
    expect(src).toContain("aria-current={here ? 'page' : undefined}");
  });

  it('is in both bars, and the orb is gone for good', () => {
    const shell = read('./Shell.tsx');
    expect(shell).toContain("import { HomesAiStar } from './HomesAiStar.js'");
    expect(shell).toContain('<HomesAiStar />');
    expect(shell).toContain('<HomesAiStar compact />');
    /* Not "no orb rendered" but "no orb at all": a second Homes AI that can
       answer differently from the first is the bug, not the rendering. */
    expect(shell).not.toContain('HomesAiOrb');
  });

  it('holds no answers of its own', () => {
    /* It is a link. The moment it fetches or replies, there are two Homes
       AIs again and they will disagree. */
    const src = read('./HomesAiStar.tsx');
    expect(src).not.toMatch(/api\.(get|post)|fetch\(/);
  });
});
