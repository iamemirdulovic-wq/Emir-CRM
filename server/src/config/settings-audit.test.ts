import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every change to a setting or a secret is written to `audit_log`.
 *
 * That is true because `saveSetting`, `saveSecret` and `clearSecret` all write
 * an audit row themselves — so the way it stops being true is somebody writing
 * to `app_settings` or `app_secrets` directly. This scans for that rather than
 * trusting it, the same way the hook-order and schema-map checks do.
 *
 * "All sections, each change audit-logged" is the whole of what Step 15 asked
 * for, and a comment promising it is not a check.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The one file allowed to write these tables — it is where the audit lives. */
const OWNER_FILE = path.join('config', 'secrets.ts');

const SETTINGS_TABLES = ['app_settings', 'app_secrets'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(ROOT).map((file) => ({
  file,
  relative: path.relative(ROOT, file),
  text: readFileSync(file, 'utf8'),
}));

describe('settings and secrets are only written where they are audited', () => {
  it('found the source tree', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  for (const table of SETTINGS_TABLES) {
    it(`nothing but secrets.ts writes to ${table}`, () => {
      const writers = FILES.filter((entry) => {
        if (entry.relative === OWNER_FILE) return false;
        /* Migrations are SQL files, not TypeScript, so only runtime code is
           in scope here. */
        const write = new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+\`?${table}\`?`, 'i');
        return write.test(entry.text);
      }).map((entry) => entry.relative);

      expect(writers, `${writers.join(', ')} writes ${table} without going through saveSetting/saveSecret`)
        .toEqual([]);
    });
  }

  it('the helpers that own those tables do write an audit row', () => {
    const secrets = FILES.find((entry) => entry.relative === OWNER_FILE);
    expect(secrets, 'config/secrets.ts moved').toBeDefined();
    const text = secrets?.text ?? '';

    for (const fn of ['saveSetting', 'saveSecret', 'clearSecret']) {
      const start = text.indexOf(`export async function ${fn}`);
      expect(start, `${fn} is gone`).toBeGreaterThan(-1);
      /* The body up to the next top-level export. */
      const rest = text.slice(start);
      const end = rest.indexOf('\nexport ', 1);
      const body = end === -1 ? rest : rest.slice(0, end);
      expect(body, `${fn} no longer writes an audit row`).toMatch(/writeAudit\(/);
    }
  });

  it('the company and messaging routes save through those helpers', () => {
    const route = FILES.find((entry) => entry.relative === path.join('http', 'routes', 'company.ts'));
    expect(route, 'the company route moved').toBeDefined();
    const text = route?.text ?? '';
    expect(text).toMatch(/saveSetting\(/);
    /* And a record of the change as a whole, not only per field. */
    expect(text).toMatch(/action: 'company\.updated'/);
    expect(text).toMatch(/action: 'company\.messaging_limits_changed'/);
  });

  it('only an owner or an admin may change the company', () => {
    const route = FILES.find((entry) => entry.relative === path.join('http', 'routes', 'company.ts'));
    const text = route?.text ?? '';
    /* Every write verb on this router is behind requireAdmin. */
    const writes = [...text.matchAll(/companyRouter\.(put|post|delete)\(\s*'[^']*',\s*([a-zA-Z]+)/g)];
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const match of writes) {
      expect(match[2], `${match[0]} is not behind requireAdmin`).toBe('requireAdmin');
    }
  });
});
