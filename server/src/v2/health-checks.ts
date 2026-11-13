/**
 * Is everything working? Checked by itself every five minutes.
 *
 * `design/web/system-health.html` draws six services, each with a thirty-day
 * bar, a response time, an uptime percentage and a status chip, and under
 * them a timeline of past problems. None of that could be true before, for a
 * simple reason: **nothing was recorded**. The page could only say what was
 * configured at the instant you opened it, so the bars would have been thirty
 * green rectangles drawn because nobody was counting.
 *
 * So this measures, and writes down what it measured. `runChecks()` is called
 * by the `health.check` job every five minutes and by the page's own "Run a
 * check now" button; `serviceHistory()` reads the rows back as the bars, the
 * percentages and the incidents.
 *
 * Three rules it keeps:
 *
 *  - **No secret ever leaves here.** Whether a key is set is operational.
 *    What it is, is not — not the value, not a hint, not a length.
 *  - **"Not configured" and "configured but slow" are different states.**
 *    Collapsing them is how an owner ends up phoning an agent about a push
 *    problem that is really a missing key.
 *  - **A number nobody measured is left out, not guessed.** The design's
 *    "last backup today 03:00" and "6.2 of 50 GB" both need facts about the
 *    hosting that the CRM is not told, so the backup line is absent and the
 *    storage line says what is used without inventing a ceiling. Written down
 *    in `docs/decisions-to-confirm.md`.
 */
import { stat, readdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getPool, query, queryOne, execute, type Executor } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { secret } from '../config/secrets.js';
import { env } from '../config/env.js';
import { monthSpend, usd } from '../ai/usage.js';
import { AI_NAME } from '../ai/name.js';
import { logger } from '../lib/logger.js';

export type ServiceState = 'ok' | 'slow' | 'down';

/** The six the design names, in the design's order. */
export const SERVICE_KEYS = [
  'site', 'database', 'notifications', 'links', 'storage', 'ai',
] as const;

export type ServiceKey = (typeof SERVICE_KEYS)[number];

export interface ServiceMeta {
  key: ServiceKey;
  title: string;
  /** The second line, which the design fills with what the service is for. */
  about: string;
  /** Where an owner goes when it is not green. */
  to: string;
  /**
   * Whether the name takes "are" rather than "is".
   *
   * The design writes "Notifications **are** slow since 14:20", and a page
   * that says "Notifications is slow" to the owner of the company reads as
   * carelessly as it sounds.
   */
  plural?: boolean;
}

export const SERVICES: Record<ServiceKey, ServiceMeta> = {
  site: {
    key: 'site',
    title: 'CRM website and sign-in',
    about: 'crm.homes.me',
    to: '/v2/settings/health',
  },
  database: {
    key: 'database',
    title: 'Database',
    about: 'Leads, notes, history',
    to: '/v2/settings/health',
  },
  notifications: {
    key: 'notifications',
    title: 'Notifications',
    about: 'Phone and computer alerts',
    to: '/v2/settings/team',
    plural: true,
  },
  links: {
    key: 'links',
    title: 'Tracked links',
    about: 'Brochure links and client opens',
    to: '/v2/settings/health',
    plural: true,
  },
  storage: {
    key: 'storage',
    title: 'File storage',
    about: 'Brochures, IDs, booking forms',
    to: '/v2/settings/health',
  },
  ai: {
    key: 'ai',
    title: AI_NAME,
    about: 'In short, voice notes, chat',
    to: '/v2/settings/ai',
  },
};

/** Anything above this and the service is answering, but not usefully. */
const SLOW_MS = 1_000;

export interface Measured {
  service: ServiceKey;
  state: ServiceState;
  ms: number | null;
  note: string | null;
}

/* ── measuring ─────────────────────────────────────────────────────────── */

async function timed<T>(work: () => Promise<T>): Promise<{ ms: number; value: T | null; failed: boolean }> {
  const began = Date.now();
  try {
    const value = await work();
    return { ms: Date.now() - began, value, failed: false };
  } catch {
    return { ms: Date.now() - began, value: null, failed: true };
  }
}

/**
 * Measure every service once.
 *
 * Nothing here calls out to another company: a check that spends money or
 * depends on Google being up is a check that reports Google's weather rather
 * than ours, and it would run 288 times a day. Each of these measures work
 * the CRM itself does.
 */
export async function measureAll(exec: Executor = getPool()): Promise<Measured[]> {
  const [database, storage, links, notifications, ai] = await Promise.all([
    measureDatabase(exec),
    measureStorage(),
    measureLinks(exec),
    measureNotifications(exec),
    measureAi(exec),
  ]);

  /*
   * The site itself. This code is running inside the process that serves it,
   * so "is it up" is answered by the fact that the check happened at all —
   * which is honest rather than circular: a process that is not running
   * writes no row, and a gap in the rows is what the bars show as a problem.
   *
   * The number beside it is the round trip the sign-in path actually makes:
   * resolving a session is one indexed lookup, and that is what is timed.
   */
  const session = await timed(() => queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM sessions WHERE expires_at > NOW(3)', [], exec,
  ));
  const site: Measured = {
    service: 'site',
    state: session.failed ? 'down' : session.ms > SLOW_MS ? 'slow' : 'ok',
    ms: session.ms,
    note: session.failed ? 'Sign-in cannot reach the database' : null,
  };

  return [site, database, notifications, links, storage, ai];
}

async function measureDatabase(exec: Executor): Promise<Measured> {
  const ping = await timed(() => queryOne<{ one: number }>('SELECT 1 AS one', [], exec));
  const leads = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM contacts WHERE deleted_at IS NULL', [], exec,
  ).catch(() => null);
  return {
    service: 'database',
    state: ping.failed ? 'down' : ping.ms > SLOW_MS ? 'slow' : 'ok',
    ms: ping.ms,
    note: ping.failed
      ? 'The database did not answer'
      : leads ? `${Number(leads.n).toLocaleString('en-GB')} leads` : null,
  };
}

/**
 * Can a file actually be written, and how much is already there.
 *
 * "The disk is full" is the failure this catches, and it is one that otherwise
 * surfaces as an agent's brochure upload silently not appearing.
 */
async function measureStorage(): Promise<Measured> {
  const root = path.resolve(env().UPLOAD_DIR);
  const probe = path.join(root, '.health-probe');
  const write = await timed(async () => {
    await writeFile(probe, 'ok');
    await unlink(probe);
  });
  if (write.failed) {
    return {
      service: 'storage', state: 'down', ms: write.ms,
      note: 'Files cannot be written. Uploads will fail.',
    };
  }
  const bytes = await folderBytes(root).catch(() => null);
  return {
    service: 'storage',
    state: write.ms > SLOW_MS ? 'slow' : 'ok',
    ms: write.ms,
    note: bytes === null ? null : `${gb(bytes)} used`,
  };
}

/** One level of recursion is enough: uploads are one folder per kind. */
async function folderBytes(root: string, depth = 2): Promise<number> {
  let total = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0) total += await folderBytes(full, depth - 1).catch(() => 0);
    } else {
      total += (await stat(full).catch(() => null))?.size ?? 0;
    }
  }
  return total;
}

function gb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** The brochure links the CRM hands out, and whether anybody opened one. */
async function measureLinks(exec: Executor): Promise<Measured> {
  const counted = await timed(() => queryOne<{ opens: number }>(
    `SELECT COUNT(*) AS opens FROM brochure_views
      WHERE viewed_at >= DATE_SUB(NOW(3), INTERVAL 7 DAY)`,
    [], exec,
  ));
  if (counted.failed) {
    return { service: 'links', state: 'down', ms: counted.ms, note: 'Opens cannot be counted' };
  }
  const opens = Number(counted.value?.opens ?? 0);
  return {
    service: 'links',
    state: counted.ms > SLOW_MS ? 'slow' : 'ok',
    ms: counted.ms,
    note: `${opens} in 7 days`,
  };
}

/**
 * Whether an alert could reach anybody.
 *
 * Two separate failures, and the design draws them as one row: the server has
 * no credentials, or it has them and nobody's phone is registered. The second
 * is the one that caught the owner out — the five-minute rule fires, the lead
 * bounces, and it bounces off somebody who was never told.
 */
async function measureNotifications(exec: Executor): Promise<Measured> {
  const cfg = env();
  const configured = Boolean(cfg.FCM_PROJECT_ID && cfg.FCM_CLIENT_EMAIL && cfg.FCM_PRIVATE_KEY);
  if (!configured) {
    return {
      service: 'notifications', state: 'down', ms: null,
      note: 'No phone-alert key is set, so no alert is sent',
    };
  }
  const devices = await timed(() => queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM push_tokens', [], exec,
  ));
  const n = Number(devices.value?.n ?? 0);
  if (n === 0) {
    return {
      service: 'notifications', state: 'slow', ms: devices.ms,
      note: 'no phone is registered',
    };
  }
  return {
    service: 'notifications',
    state: 'ok',
    ms: devices.ms,
    note: `${n} device${n === 1 ? '' : 's'}`,
  };
}

/** Whether a key is set, and what the month has cost. Never the key itself. */
async function measureAi(exec: Executor): Promise<Measured> {
  const key = Boolean(await secret('GEMINI_API_KEY', exec).catch(() => null));
  if (!key) {
    return {
      service: 'ai', state: 'down', ms: null,
      note: `No key, so every ${AI_NAME} answer fails`,
    };
  }
  const spend = await monthSpend(exec).catch(() => null);
  const capped = spend !== null && spend.capMicros > 0 && spend.micros >= spend.capMicros;
  return {
    service: 'ai',
    state: capped ? 'slow' : 'ok',
    ms: null,
    note: spend === null
      ? null
      : `$${usd(spend.micros)} of $${usd(spend.capMicros)}${capped ? ' · paused until the 1st' : ''}`,
  };
}

/* ── recording ─────────────────────────────────────────────────────────── */

export async function runChecks(exec: Executor = getPool()): Promise<Measured[]> {
  const measured = await measureAll(exec);
  for (const one of measured) {
    try {
      await execute(
        'INSERT INTO service_checks (id, service, state, ms, note) VALUES (?, ?, ?, ?, ?)',
        [newId(), one.service, one.state, one.ms, one.note?.slice(0, 200) ?? null],
        exec,
      );
    } catch (err) {
      /* A check that cannot be written is not worth failing the job for: the
         gap in the rows is itself the record that something was wrong. */
      logger.warn('health check not recorded', { service: one.service, err: String(err) });
    }
  }
  return measured;
}

/* ── reading it back ───────────────────────────────────────────────────── */

export interface ServiceReport extends ServiceMeta {
  state: ServiceState;
  ms: number | null;
  note: string | null;
  checkedAt: string | null;
  /** One entry per day, oldest first. `null` is a day with no check at all. */
  days: Array<{ date: string; state: ServiceState | null }>;
  /** Share of recorded checks that were fine, or null with nothing recorded. */
  upPercent: number | null;
  samples: number;
}

export interface Incident {
  service: ServiceKey;
  title: string;
  state: ServiceState;
  detail: string | null;
  from: string;
  to: string | null;
  open: boolean;
}

export interface HealthReport {
  services: ServiceReport[];
  /** How many are not fine right now. */
  outstanding: number;
  fine: number;
  checkedAt: string | null;
  incidents: Incident[];
  /** True until the first check has ever run, so the page can say so. */
  neverChecked: boolean;
  days: number;
}

const WINDOW_DAYS = 30;

/** Worst wins: one bad check in a day colours that day's bar. */
function worse(a: ServiceState | null, b: ServiceState): ServiceState {
  const rank: Record<ServiceState, number> = { ok: 0, slow: 1, down: 2 };
  if (a === null) return b;
  return rank[b] > rank[a] ? b : a;
}

function dateKeys(days: number): string[] {
  /* Dubai is UTC+4 with no daylight saving, so a fixed offset is correct and
     a timezone library would be wrong here. */
  const today = new Date(Date.now() + 4 * 3_600_000);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

export async function serviceHistory(exec: Executor = getPool()): Promise<HealthReport> {
  const rows = await query<{
    service: string; state: ServiceState; ms: number | null; note: string | null;
    checked_at: Date | string;
  }>(
    `SELECT service, state, ms, note, checked_at FROM service_checks
      WHERE checked_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)
      ORDER BY checked_at`,
    [WINDOW_DAYS],
    exec,
  );

  const keys = dateKeys(WINDOW_DAYS);
  const perService = new Map<string, {
    byDay: Map<string, ServiceState>; ok: number; total: number;
    last: typeof rows[number] | null;
  }>();

  for (const row of rows) {
    const at = row.checked_at instanceof Date ? row.checked_at : new Date(row.checked_at);
    const day = new Date(at.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
    const found = perService.get(row.service)
      ?? { byDay: new Map<string, ServiceState>(), ok: 0, total: 0, last: null };
    found.byDay.set(day, worse(found.byDay.get(day) ?? null, row.state));
    found.total += 1;
    if (row.state === 'ok') found.ok += 1;
    found.last = row;
    perService.set(row.service, found);
  }

  /* Nothing recorded yet: the page gets the live reading so it is not blank
     on the first morning, and says the bars will fill in. */
  const live = rows.length === 0 ? await measureAll(exec) : null;
  const liveBy = new Map(live?.map((one) => [one.service as string, one]) ?? []);

  const services: ServiceReport[] = SERVICE_KEYS.map((key) => {
    const found = perService.get(key);
    const fallback = liveBy.get(key);
    const last = found?.last ?? null;
    const at = last
      ? (last.checked_at instanceof Date ? last.checked_at.toISOString() : String(last.checked_at))
      : null;
    return {
      ...SERVICES[key],
      state: last?.state ?? fallback?.state ?? 'ok',
      ms: last ? last.ms : fallback?.ms ?? null,
      note: last ? last.note : fallback?.note ?? null,
      checkedAt: at,
      days: keys.map((date) => ({ date, state: found?.byDay.get(date) ?? null })),
      upPercent: found && found.total > 0 ? Math.round((found.ok / found.total) * 1000) / 10 : null,
      samples: found?.total ?? 0,
    };
  });

  const outstanding = services.filter((one) => one.state !== 'ok').length;
  const newest = services
    .map((one) => one.checkedAt)
    .filter((one): one is string => Boolean(one))
    .sort()
    .pop() ?? null;

  return {
    services,
    outstanding,
    fine: services.length - outstanding,
    checkedAt: newest,
    incidents: incidentsFrom(rows),
    neverChecked: rows.length === 0,
    days: WINDOW_DAYS,
  };
}

/**
 * The timeline of past problems.
 *
 * A run of consecutive non-ok checks for one service is one incident, which is
 * what a person means by "notifications were slow this afternoon". Listing
 * every five-minute sample would be 288 rows a day and tell nobody anything.
 */
function incidentsFrom(rows: Array<{
  service: string; state: ServiceState; note: string | null; checked_at: Date | string;
}>): Incident[] {
  const open = new Map<string, Incident>();
  const closed: Incident[] = [];

  const iso = (at: Date | string) =>
    (at instanceof Date ? at : new Date(at)).toISOString();

  for (const row of rows) {
    const running = open.get(row.service);
    if (row.state === 'ok') {
      if (running) {
        running.to = iso(row.checked_at);
        running.open = false;
        closed.push(running);
        open.delete(row.service);
      }
      continue;
    }
    if (running) {
      /* A slow stretch that becomes a down one is still one incident, named
         by the worst state it reached. */
      running.state = worse(running.state, row.state);
      running.title = titleFor(row.service as ServiceKey, running.state);
      if (row.note) running.detail = row.note;
      continue;
    }
    open.set(row.service, {
      service: row.service as ServiceKey,
      title: titleFor(row.service as ServiceKey, row.state),
      state: row.state,
      detail: row.note,
      from: iso(row.checked_at),
      to: null,
      open: true,
    });
  }

  /* Still-open ones first, then the most recent: what is wrong now matters
     more than what was wrong last week. */
  return [...open.values(), ...closed.reverse()].slice(0, 6);
}

function titleFor(service: ServiceKey, state: ServiceState): string {
  const name = SERVICES[service]?.title ?? service;
  return state === 'down' ? `${name} not working` : `${name} slow`;
}
