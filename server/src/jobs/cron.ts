import { execute, query, queryOne } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { enqueue } from './queue.js';
import type { JobType } from './types.js';

/**
 * Recurring work, scheduled from inside the worker rather than from a system
 * crontab — Hostinger's cron granularity is coarse and we need a 10-minute
 * Meta backfill.
 *
 * Each schedule is claimed through the `jobs` table's unique dedupe key, so
 * several workers produce one run per window, not one each.
 */

type Schedule = {
  name: string;
  type: JobType;
  everyMinutes: number;
  payload?: Record<string, unknown>;
  /** Some schedules fan out over rows, e.g. one job per Meta form. */
  expand?: () => Promise<Array<Record<string, unknown>>>;
  /**
   * Once a day, at this hour in Dubai.
   *
   * A plain `everyMinutes: 1440` would fire at whatever time of day the
   * epoch happens to land on, which for a morning summary is the whole
   * point missed. With this set, the window is the Dubai date and the job
   * is only offered during that hour.
   */
  atDubaiHour?: number;
};

const SCHEDULES: Schedule[] = [
  {
    // "Run a backfill cron every 10 minutes using /{form_id}/leads."
    name: 'meta_backfill',
    type: 'meta.backfill_form',
    everyMinutes: 10,
    expand: async () => {
      const forms = await query<{ form_id: string }>(
        `SELECT DISTINCT form_id FROM form_field_map WHERE source = 'meta_lead_ads' AND form_id IS NOT NULL
         UNION
         SELECT DISTINCT form_id FROM opportunities
          WHERE source = 'meta_lead_ads' AND form_id IS NOT NULL
            AND created_at > DATE_SUB(NOW(3), INTERVAL 30 DAY)`,
      );
      return forms.map((f) => ({ formId: f.form_id, sinceMinutes: 60 }));
    },
  },
  { name: 'template_sync', type: 'templates.sync', everyMinutes: 60 },
  { name: 'imap_poll', type: 'email.imap_poll', everyMinutes: 2 },
  // Recycling untouched leads is a daily decision, not an hourly one: an agent
  // who has not called a lead since this morning has not neglected them.
  { name: 'list_recycle', type: 'list.recycle', everyMinutes: 60 * 6 },
  /*
   * Every five minutes. The reminder window is half an hour by default, so this
   * is fine-grained enough that a nudge lands close to when it was meant to,
   * and coarse enough that the sweep is almost always a single cheap query
   * returning nothing.
   */
  { name: 'task_reminders', type: 'task.reminder_sweep', everyMinutes: 5 },
  { name: 'cleanup', type: 'maintenance.cleanup', everyMinutes: 60 },
  /*
   * The owners' morning summary. 09:00 Dubai, because it is written to be
   * read with the first coffee and a summary that lands at 3am is read at
   * 3pm, by which point the day it describes is over.
   */
  { name: 'owner_summary', type: 'reports.owner_summary', everyMinutes: 60, atDubaiHour: 9 },
  /* The wall's own posts, at 09:00 Dubai: anniversaries every day, and the
     week's roundup on a Monday. */
  { name: 'wall_daily', type: 'wall.daily', everyMinutes: 60, atDubaiHour: 9 },
  /*
   * The nightly second opinion on lead quality. 03:00 Dubai, because it spends
   * model calls in a batch and nobody is waiting on it: by the time the first
   * agent opens the app the verdicts are already on the cards. Running it in
   * the working day would put a queue of AI calls in front of the ones an
   * agent is actually waiting for.
   */
  { name: 'ai_review', type: 'ai.review_sweep', everyMinutes: 60, atDubaiHour: 3 },
];

/** Dubai is UTC+4 all year, so there is no DST to think about. */
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

/** The Dubai calendar date, as `2026-10-30`. */
export function dubaiDateKey(now: Date): string {
  return new Date(now.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function dubaiHour(now: Date): number {
  return new Date(now.getTime() + DUBAI_OFFSET_MS).getUTCHours();
}

/** Window key: the same for every worker inside one interval. */
function windowKey(everyMinutes: number, now: Date): string {
  const bucket = Math.floor(now.getTime() / (everyMinutes * 60 * 1000));
  return String(bucket);
}

let lastRunAt = 0;

/** Called by the worker loop. Cheap enough to run every poll. */
export async function runDueCrons(now: Date = new Date()): Promise<number> {
  // The schedules have minute granularity; checking more than once every 30
  // seconds is wasted queries.
  if (now.getTime() - lastRunAt < 30_000) return 0;
  lastRunAt = now.getTime();

  let queued = 0;
  for (const schedule of SCHEDULES) {
    /* A daily schedule is offered only during its hour, and its window is
       the Dubai date so it fires once a day rather than once an hour. */
    if (schedule.atDubaiHour !== undefined && dubaiHour(now) !== schedule.atDubaiHour) continue;

    const key = schedule.atDubaiHour !== undefined
      ? `cron:${schedule.name}:${dubaiDateKey(now)}`
      : `cron:${schedule.name}:${windowKey(schedule.everyMinutes, now)}`;
    try {
      if (schedule.expand) {
        const payloads = await schedule.expand();
        for (const [index, payload] of payloads.entries()) {
          const result = await enqueue(schedule.type, payload, { dedupeKey: `${key}:${index}`, priority: 7 });
          if (result.enqueued) queued += 1;
        }
      } else {
        const result = await enqueue(schedule.type, schedule.payload ?? {}, { dedupeKey: key, priority: 7 });
        if (result.enqueued) queued += 1;
      }
    } catch (err) {
      logger.warn('failed to schedule a cron job', {
        schedule: schedule.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (queued > 0) logger.debug('scheduled recurring jobs', { queued });
  return queued;
}

/** Old cron dedupe keys pile up; drop the finished ones. */
export async function pruneCronKeys(): Promise<number> {
  const result = await execute(
    `DELETE FROM jobs WHERE dedupe_key LIKE 'cron:%' AND status IN ('done','cancelled')
       AND finished_at < DATE_SUB(NOW(3), INTERVAL 2 DAY)`,
  );
  return result.affectedRows;
}

export async function cronHealth(): Promise<Array<{ name: string; lastRunAt: Date | null; status: string | null }>> {
  const out = [];
  for (const schedule of SCHEDULES) {
    const row = await queryOne<{ finished_at: Date | null; status: string }>(
      `SELECT finished_at, status FROM jobs WHERE type = ? ORDER BY created_at DESC LIMIT 1`,
      [schedule.type],
    );
    out.push({ name: schedule.name, lastRunAt: row?.finished_at ?? null, status: row?.status ?? null });
  }
  return out;
}
