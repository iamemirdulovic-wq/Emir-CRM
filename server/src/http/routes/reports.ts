import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { blockUntilPasswordChanged, currentUser, requireAuth, requireManager } from '../middleware/auth.js';
import { query, queryOne } from '../../db/client.js';
import { visibleUserIds } from '../../auth/scope.js';
import { cronHealth } from '../../jobs/cron.js';
import { clientCount } from '../../realtime/hub.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, blockUntilPasswordChanged);

const rangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

function range(input: z.infer<typeof rangeSchema>): { from: Date; to: Date } {
  const to = input.to ? new Date(input.to) : new Date();
  const from = input.from ? new Date(input.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * Source quality per ad: CPL → valid% → contacted% → qualified% → appointment%
 * → reservation%.
 *
 * Cost per lead needs ad spend, which lives in Meta Ads, so the report returns
 * the counts and leaves CPL to be joined against spend by the caller — better
 * than inventing a number.
 */
reportsRouter.get(
  '/source-quality',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to } = range(rangeSchema.parse(req.query));

    const rows = await query(
      `SELECT
         o.source,
         o.campaign_id, o.campaign_name,
         o.adset_id, o.adset_name,
         o.ad_id, o.ad_name,
         COUNT(*) AS leads,
         SUM(CASE WHEN o.sub_status <> 'invalid' OR o.sub_status IS NULL THEN 1 ELSE 0 END) AS valid_leads,
         SUM(CASE WHEN o.first_touch_at IS NOT NULL OR o.stage_key <> 'new_lead' THEN 1 ELSE 0 END) AS contacted,
         SUM(CASE WHEN o.stage_key IN ('engaged_qualified','appointment_scheduled','deal_sent','won') THEN 1 ELSE 0 END) AS qualified,
         SUM(CASE WHEN o.stage_key IN ('appointment_scheduled','deal_sent','won') THEN 1 ELSE 0 END) AS appointments,
         SUM(CASE WHEN o.stage_key = 'appointment_scheduled' AND o.sub_status = 'showed' THEN 1 ELSE 0 END) AS shows,
         SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) AS reservations,
         SUM(COALESCE(o.deal_value_aed, 0)) AS deal_value_aed,
         SUM(COALESCE(o.expected_commission_aed, 0)) AS commission_aed,
         AVG(o.lead_score) AS avg_score
       FROM opportunities o
      WHERE o.created_at BETWEEN ? AND ?
      GROUP BY o.source, o.campaign_id, o.campaign_name, o.adset_id, o.adset_name, o.ad_id, o.ad_name
      ORDER BY leads DESC
      LIMIT 500`,
      [from, to],
    );

    const items = (rows as Array<Record<string, number | string | null>>).map((row) => {
      const leads = Number(row.leads ?? 0);
      const pct = (value: unknown) => (leads > 0 ? Math.round((Number(value ?? 0) / leads) * 1000) / 10 : 0);
      return {
        ...row,
        leads,
        validPct: pct(row.valid_leads),
        contactedPct: pct(row.contacted),
        qualifiedPct: pct(row.qualified),
        appointmentPct: pct(row.appointments),
        showPct: pct(row.shows),
        reservationPct: pct(row.reservations),
        // CPL needs ad spend, which the CRM does not hold.
        cplAed: null,
      };
    });

    res.json({ from, to, items, note: 'CPL requires ad spend from Meta/Google Ads; join on campaign_id or ad_id.' });
  }),
);

/**
 * Agent metrics: median speed-to-lead, SLA breaches, contact rate, qualified
 * rate, appointments and reservations. These feed the weekly leaderboard.
 */
reportsRouter.get(
  '/agents',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const { from, to } = range(rangeSchema.parse(req.query));
    const visible = await visibleUserIds(user);

    const scope = visible === null ? '' : `AND o.owner_user_id IN (${visible.map(() => '?').join(',')})`;
    const args: Array<string | Date> = [from, to, ...(visible ?? [])];

    const rows = await query<{
      user_id: string;
      name: string;
      leads: number;
      contacted: number;
      qualified: number;
      appointments: number;
      reservations: number;
      sla_breaches: number;
    }>(
      `SELECT o.owner_user_id AS user_id, u.name,
              COUNT(*) AS leads,
              SUM(CASE WHEN o.first_touch_at IS NOT NULL THEN 1 ELSE 0 END) AS contacted,
              SUM(CASE WHEN o.stage_key IN ('engaged_qualified','appointment_scheduled','deal_sent','won') THEN 1 ELSE 0 END) AS qualified,
              SUM(CASE WHEN o.stage_key IN ('appointment_scheduled','deal_sent','won') THEN 1 ELSE 0 END) AS appointments,
              SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) AS reservations,
              SUM(o.sla_breached) AS sla_breaches
         FROM opportunities o JOIN users u ON u.id = o.owner_user_id
        WHERE o.created_at BETWEEN ? AND ? ${scope}
        GROUP BY o.owner_user_id, u.name`,
      args,
    );

    // Median, not mean: one lead answered three days late would otherwise
    // swamp an agent's whole week.
    const items = [];
    for (const row of rows) {
      const durations = await query<{ seconds: number }>(
        `SELECT TIMESTAMPDIFF(SECOND, o.assigned_at, o.first_touch_at) AS seconds
           FROM opportunities o
          WHERE o.owner_user_id = ? AND o.created_at BETWEEN ? AND ?
            AND o.assigned_at IS NOT NULL AND o.first_touch_at IS NOT NULL
            AND o.first_touch_at >= o.assigned_at
          ORDER BY seconds`,
        [row.user_id, from, to],
      );
      const values = durations.map((d) => Number(d.seconds)).filter((n) => Number.isFinite(n));
      const leads = Number(row.leads ?? 0);
      const pct = (value: unknown) => (leads > 0 ? Math.round((Number(value ?? 0) / leads) * 1000) / 10 : 0);

      items.push({
        userId: row.user_id,
        name: row.name,
        leads,
        medianSpeedToLeadSeconds: median(values),
        slaBreaches: Number(row.sla_breaches ?? 0),
        contactRatePct: pct(row.contacted),
        qualifiedRatePct: pct(row.qualified),
        appointments: Number(row.appointments ?? 0),
        reservations: Number(row.reservations ?? 0),
      });
    }

    // The weekly "King of Emir" leaderboard ranks on outcomes first, speed second.
    const leaderboard = [...items].sort(
      (a, b) =>
        b.reservations - a.reservations ||
        b.appointments - a.appointments ||
        b.qualifiedRatePct - a.qualifiedRatePct ||
        (a.medianSpeedToLeadSeconds ?? Number.MAX_SAFE_INTEGER) - (b.medianSpeedToLeadSeconds ?? Number.MAX_SAFE_INTEGER),
    );

    res.json({ from, to, items, leaderboard, kingOfEmir: leaderboard[0] ?? null });
  }),
);

/** Funnel counts for the dashboard. */
reportsRouter.get(
  '/funnel',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const { from, to } = range(rangeSchema.parse(req.query));
    const visible = await visibleUserIds(user);

    const scope = visible === null ? '' : `AND owner_user_id IN (${visible.map(() => '?').join(',')})`;
    const args: Array<string | Date> = [from, to, ...(visible ?? [])];

    const stages = await query(
      `SELECT stage_key, COUNT(*) AS n, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_n
         FROM opportunities WHERE created_at BETWEEN ? AND ? ${scope}
        GROUP BY stage_key`,
      args,
    );
    const lost = await query(
      `SELECT lost_reason, COUNT(*) AS n FROM opportunities
        WHERE created_at BETWEEN ? AND ? AND status = 'lost' ${scope}
        GROUP BY lost_reason`,
      args,
    );
    const speed = await queryOne<{ median_seconds: number | null; breaches: number }>(
      `SELECT AVG(TIMESTAMPDIFF(SECOND, assigned_at, first_touch_at)) AS median_seconds, SUM(sla_breached) AS breaches
         FROM opportunities WHERE created_at BETWEEN ? AND ? ${scope}`,
      args,
    );

    res.json({ from, to, stages, lostReasons: lost, slaBreaches: Number(speed?.breaches ?? 0) });
  }),
);

/** Operational health: are the webhooks, jobs and crons actually running? */
reportsRouter.get(
  '/health',
  requireManager,
  asyncHandler(async (_req: Request, res: Response) => {
    const jobs = await query(
      `SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`,
    );
    const failing = await query(
      `SELECT type, COUNT(*) AS n, MAX(last_error) AS last_error FROM jobs
        WHERE status = 'failed' GROUP BY type ORDER BY n DESC LIMIT 20`,
    );
    const events = await query(
      `SELECT source, status, COUNT(*) AS n FROM inbound_events
        WHERE received_at > DATE_SUB(NOW(3), INTERVAL 24 HOUR) GROUP BY source, status`,
    );
    const templates = await query(
      `SELECT name, language, status, rejected_reason FROM wa_templates WHERE status <> 'APPROVED' ORDER BY name`,
    );
    const unassigned = await queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM unassigned_queue WHERE resolved_at IS NULL',
    );
    const unverifiedProjects = await queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM projects WHERE is_active = 1 AND verified_at IS NULL',
    );

    res.json({
      jobs,
      failingJobTypes: failing,
      inboundEvents24h: events,
      templatesNotApproved: templates,
      unassignedLeads: Number(unassigned?.n ?? 0),
      unverifiedActiveProjects: Number(unverifiedProjects?.n ?? 0),
      crons: await cronHealth(),
      realtimeClients: clientCount(),
    });
  }),
);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2) : (sorted[mid] as number);
}
