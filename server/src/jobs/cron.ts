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
];

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
    const key = `cron:${schedule.name}:${windowKey(schedule.everyMinutes, now)}`;
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
