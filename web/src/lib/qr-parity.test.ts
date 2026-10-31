import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The web's copy of the QR encoder matches the server's.
 *
 * There are two copies on purpose — see the header of `qr.ts` — and two
 * copies of anything drift. This compares everything below the header
 * comment, so the one fix that matters (a scanning bug) can never be applied
 * to one and not the other. If this fails, copy the file across; do not
 * "fix" the test.
 */
const REPO = path.join(import.meta.dirname, '..', '..', '..');

function body(file: string): string {
  const text = readFileSync(path.join(REPO, file), 'utf8');
  const end = text.indexOf('*/');
  if (end < 0) throw new Error(`${file} has no header comment to skip`);
  return text.slice(end + 2).trim();
}

describe('the two QR encoders are one encoder', () => {
  it('matches the server copy exactly', () => {
    expect(body('web/src/lib/qr.ts')).toBe(body('server/src/profiles/qr.ts'));
  });
});
