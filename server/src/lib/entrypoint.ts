import { basename } from 'node:path';

/**
 * True when this module is the script node was asked to run.
 *
 * It compares the basename without its extension, because the same file is
 * `migrate.ts` under tsx in development and `migrate.js` once built. Matching
 * on `.ts` alone is silent and expensive: the built script exits 0 having done
 * nothing, so a deploy reports success and the app starts against a database
 * that was never migrated.
 */
export function isEntrypoint(moduleUrl: string): boolean {
  const script = process.argv[1];
  if (!script) return false;
  const strip = (name: string) => basename(name).replace(/\.(ts|js|mjs|cjs)$/, '');
  return strip(script) === strip(new URL(moduleUrl).pathname);
}
