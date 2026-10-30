/**
 * Roughly where an address is.
 *
 * Optional on purpose. A MaxMind database is a licence, a download and a
 * cron job to keep it fresh, and the CRM must work without one — so this
 * returns nothing rather than failing, and every screen that uses it reads
 * naturally with the city missing.
 *
 * Private addresses are answered without any lookup at all: an agent on the
 * office wifi behind a router is not somewhere, and asking a database about
 * 192.168.1.4 wastes a call to be told so.
 */
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface Location {
  city: string | null;
  country: string | null;
}

const NOWHERE: Location = { city: null, country: null };

/** RFC 1918 and friends — an address that means "inside this building". */
export function isPrivateAddress(ip: string): boolean {
  const clean = ip.trim().replace(/^::ffff:/i, '');
  if (!clean) return true;
  if (clean === '::1' || clean === '127.0.0.1') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(clean)) return true;
  if (/^fe80:/i.test(clean)) return true;

  const parts = clean.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

type Reader = { city(ip: string): { city?: { names?: Record<string, string> }; country?: { names?: Record<string, string> } } };

let reader: Reader | null = null;
let tried = false;

/** Loaded once, and only if a database was actually configured. */
async function loadReader(): Promise<Reader | null> {
  if (tried) return reader;
  tried = true;

  const path = env().MAXMIND_DB_PATH;
  if (!path) return null;

  try {
    /*
     * The specifier is a variable so this stays a runtime import: `maxmind`
     * is not a dependency of this project and must not become one for a
     * feature that is optional. A deployment that wants cities installs it
     * itself and sets MAXMIND_DB_PATH; everywhere else this throws on the
     * first call and the CRM carries on without cities.
     */
    const specifier = 'maxmind';
    const maxmind = (await import(/* @vite-ignore */ specifier)) as unknown as {
      open: (file: string) => Promise<Reader>;
    };
    reader = await maxmind.open(path);
    logger.info('loaded the GeoIP database', { path });
  } catch (err) {
    /* A missing optional package or a missing file is a reason to carry on
       without cities, not a reason to refuse to start. */
    logger.info('no GeoIP database, so sign-ins will have no city', {
      reason: err instanceof Error ? err.message : String(err),
    });
    reader = null;
  }
  return reader;
}

export async function lookupLocation(ip: string | null | undefined): Promise<Location> {
  if (!ip || isPrivateAddress(ip)) return NOWHERE;

  const db = await loadReader();
  if (!db) return NOWHERE;

  try {
    const result = db.city(ip.replace(/^::ffff:/i, ''));
    return {
      city: result?.city?.names?.en ?? null,
      country: result?.country?.names?.en ?? null,
    };
  } catch {
    return NOWHERE;
  }
}

/** Test helper: forget the loaded database. */
export function resetGeoipForTesting(): void {
  reader = null;
  tried = false;
}
