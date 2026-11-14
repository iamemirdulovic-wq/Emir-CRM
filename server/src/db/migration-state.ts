/**
 * What happened to the database schema when this server booted.
 *
 * Written because the calendar was broken on the live site for days and
 * nobody could see why. The reason — a migration that failed on every boot —
 * went only to a server log that neither the owner nor I can read, so it was
 * diagnosed by guesswork three times and got it wrong twice.
 *
 * The owner can read this on the System health screen. It answers the three
 * questions that were impossible to answer from outside: which build is
 * actually running, whether the schema is up to date, and if not, what went
 * wrong.
 */
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './client.js';

export interface BootMigrationState {
  /** When this process started. Shows at a glance whether a deploy landed. */
  startedAt: string;
  /** Migrations this boot applied. Empty on a normal boot. */
  applied: string[];
  /** The failure, in the database's own words, or null. */
  error: string | null;
  /** Whether the run finished. False means it threw partway. */
  ok: boolean;
}

const state: BootMigrationState = {
  startedAt: new Date().toISOString(),
  applied: [],
  error: null,
  ok: false,
};

export function recordBootMigrations(applied: string[]): void {
  state.applied = applied;
  state.error = null;
  state.ok = true;
}

export function recordBootMigrationFailure(err: unknown): void {
  state.error = err instanceof Error ? err.message : String(err);
  state.ok = false;
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/**
 * The schema's state right now, read fresh rather than from boot.
 *
 * `pending` is the important one: a migration file on disk that the database
 * has no record of. One that stays pending across restarts is stuck, and
 * everything behind it is stuck too, because the runner stops at the first
 * failure.
 */
export async function schemaState(): Promise<{
  boot: BootMigrationState;
  appliedCount: number;
  pending: string[];
  lastApplied: string | null;
}> {
  let onDisk: string[] = [];
  let done = new Set<string>();
  let lastApplied: string | null = null;
  try {
    onDisk = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const rows = await query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY applied_at DESC',
    );
    done = new Set(rows.map((r) => r.name));
    lastApplied = rows[0]?.name ?? null;
  } catch {
    /* A database that cannot answer this is itself the finding; the screen
       shows the boot error instead of failing. */
  }
  return {
    boot: state,
    appliedCount: done.size,
    pending: onDisk.filter((f) => !done.has(f)),
    lastApplied,
  };
}
