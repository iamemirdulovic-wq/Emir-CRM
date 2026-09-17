import { afterEach, describe, expect, it } from 'vitest';
import { isEntrypoint } from './entrypoint.js';

const original = process.argv[1];
afterEach(() => {
  process.argv[1] = original as string;
});

describe('isEntrypoint', () => {
  /**
   * The bug this exists to prevent: the old check was
   * `process.argv[1].endsWith('migrate.ts')`, which is false for the built
   * `migrate.js`. The script then did nothing and exited 0, so a deploy
   * reported success and the app came up against an unmigrated database.
   */
  it('matches the built file, not only the TypeScript source', () => {
    process.argv[1] = '/srv/crm/current/server/dist/db/migrate.js';
    expect(isEntrypoint('file:///srv/crm/current/server/dist/db/migrate.js')).toBe(true);
  });

  it('matches under tsx in development', () => {
    process.argv[1] = '/home/dev/emir/server/src/db/migrate.ts';
    expect(isEntrypoint('file:///home/dev/emir/server/src/db/migrate.ts')).toBe(true);
  });

  it('is false when a different script is running', () => {
    process.argv[1] = '/srv/crm/current/server/dist/index.js';
    expect(isEntrypoint('file:///srv/crm/current/server/dist/db/migrate.js')).toBe(false);
  });

  it('is false when the module is merely imported by a test runner', () => {
    process.argv[1] = '/home/dev/emir/node_modules/vitest/vitest.mjs';
    expect(isEntrypoint('file:///home/dev/emir/server/src/db/seed.ts')).toBe(false);
  });

  it('does not confuse two scripts that share a directory', () => {
    process.argv[1] = '/srv/crm/current/server/dist/db/seed.js';
    expect(isEntrypoint('file:///srv/crm/current/server/dist/db/demo.js')).toBe(false);
  });

  it('survives node being handed no script at all', () => {
    process.argv[1] = '' as string;
    expect(isEntrypoint('file:///anything/migrate.js')).toBe(false);
  });
});
