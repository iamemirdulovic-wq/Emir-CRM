/**
 * What Emir AI is allowed to look at when someone asks it a question.
 *
 * Every tool here is **read-only** and **scoped to the person asking**. That
 * second part is the whole design: an agent asking "which leads should I call
 * first?" must not be handed their colleague's pipeline, and no phrasing of
 * the question should change that. So the scope is applied in the SQL, from
 * the session's own user — never from anything the model passes in.
 *
 * The model chooses which of these to call and with what arguments. It cannot
 * reach the database any other way, cannot write, and cannot widen its own
 * view, because the `WHERE owner_user_id IN (…)` is not something it supplies.
 */
import { query, queryOne, type SqlParam } from '../db/client.js';
import { visibleUserIds } from '../auth/scope.js';
import type { Role } from '../auth/rbac.js';

export type Asker = { id: string; role: Role };

/** A tool as Gemini needs to be told about it. */
export type ToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });

export const TOOLS: ToolDeclaration[] = [
  {
    name: 'search_leads',
    description:
      'Find leads by name, phone, project, stage or how long since they were contacted. '
      + 'Use this for "which leads should I call", "who has not been contacted", "hot leads".',
    parameters: {
      type: 'object',
      properties: {
        text: str('Part of a name, phone number, project or community. Optional.'),
        stage: str('One of: new, attempted, engaged, appointment, deal_sent, won, lost. Optional.'),
        minScore: int('Only leads scoring at least this (0-100). 70 or more is hot. Optional.'),
        staleDays: int('Only leads with no activity for at least this many days. Optional.'),
        limit: int('How many to return, at most 25. Defaults to 10.'),
      },
    },
  },
  {
    name: 'get_lead',
    description: 'Everything about one lead: their details, stage, score, budget, project and recent activity.',
    parameters: {
      type: 'object',
      properties: { contactId: str('The contact id, as returned by search_leads.') },
      required: ['contactId'],
    },
  },
  {
    name: 'get_pipeline_stats',
    description:
      'How many leads sit in each stage, and how many arrived recently. '
      + 'Use this for "how is the pipeline", "how many leads this week".',
    parameters: {
      type: 'object',
      properties: { days: int('Look at leads that arrived in the last N days. Defaults to 30.') },
    },
  },
  {
    name: 'get_source_quality',
    description:
      'Which sources and campaigns bring leads, and how those leads turn out — contacted, '
      + 'qualified, won, or marked invalid. Use this for "which campaign works best", '
      + '"why so many junk leads".',
    parameters: {
      type: 'object',
      properties: { days: int('Over the last N days. Defaults to 30.') },
    },
  },
  {
    name: 'get_agent_stats',
    description:
      'How each agent is doing: leads held, how fast they respond, and how many they win. '
      + 'Use this for "how is Raj doing", "who is behind".',
    parameters: {
      type: 'object',
      properties: { days: int('Over the last N days. Defaults to 30.') },
    },
  },
  {
    name: 'get_conversation',
    description: 'The recent messages with one contact, so you can summarise what was said.',
    parameters: {
      type: 'object',
      properties: {
        contactId: str('The contact id.'),
        limit: int('How many messages, at most 40. Defaults to 20.'),
      },
      required: ['contactId'],
    },
  },
  {
    name: 'get_projects',
    description:
      'The off-plan projects the brokerage sells, with their real prices, handover dates and '
      + 'payment plans. This is the ONLY source for a price — never state one that is not here.',
    parameters: {
      type: 'object',
      properties: {
        text: str('Part of a project name, developer or community. Optional.'),
        limit: int('How many, at most 20. Defaults to 10.'),
      },
    },
  },
];

/** A row the model may see: never a full phone or email, and never a token. */
type LeadRow = {
  contact_id: string;
  name: string | null;
  stage: string | null;
  score: number | null;
  project: string | null;
  budget: string | null;
  owner: string | null;
  last_activity: string | null;
};

const clamp = (value: unknown, fallback: number, max: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
};

/**
 * Run one tool.
 *
 * `asker` comes from the session, never from the model's arguments — which is
 * what makes "and also show me Sara's leads" impossible rather than merely
 * discouraged.
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  asker: Asker,
): Promise<unknown> {
  const visible = await visibleUserIds(asker);
  // null means unrestricted; otherwise every query is fenced to these owners.
  const fence = visible === null
    ? { clause: '', params: [] as SqlParam[] }
    : {
      clause: visible.length
        ? ` AND o.owner_user_id IN (${visible.map(() => '?').join(',')})`
        : ' AND 1 = 0',
      params: visible as SqlParam[],
    };

  switch (name) {
    case 'search_leads': {
      const limit = clamp(args.limit, 10, 25);
      const where: string[] = ["o.status = 'open'"];
      const params: SqlParam[] = [];

      if (typeof args.text === 'string' && args.text.trim()) {
        where.push('(c.full_name LIKE ? OR c.phone_e164 LIKE ? OR o.project_name LIKE ? OR o.preferred_location LIKE ?)');
        const like = `%${args.text.trim().slice(0, 60)}%`;
        params.push(like, like, like, like);
      }
      if (typeof args.stage === 'string' && args.stage.trim()) {
        where.push('s.`key` = ?');
        params.push(args.stage.trim());
      }
      if (args.minScore !== undefined) {
        where.push('o.lead_score >= ?');
        params.push(clamp(args.minScore, 0, 100));
      }
      if (args.staleDays !== undefined) {
        where.push(
          '(SELECT MAX(a.created_at) FROM activities a WHERE a.opportunity_id = o.id) '
          + 'IS NULL OR (SELECT MAX(a.created_at) FROM activities a WHERE a.opportunity_id = o.id) '
          + '< DATE_SUB(NOW(3), INTERVAL ? DAY)',
        );
        params.push(clamp(args.staleDays, 7, 365));
      }

      return query<LeadRow>(
        `SELECT o.contact_id, c.full_name AS name, s.\`key\` AS stage, o.lead_score AS score,
                o.project_name AS project, o.budget_band AS budget, u.name AS owner,
                DATE_FORMAT((SELECT MAX(a.created_at) FROM activities a
                               WHERE a.opportunity_id = o.id), '%Y-%m-%d') AS last_activity
           FROM opportunities o
           JOIN contacts c ON c.id = o.contact_id
           LEFT JOIN pipeline_stages s ON s.id = o.stage_id
           LEFT JOIN users u ON u.id = o.owner_user_id
          WHERE ${where.join(' AND ')}${fence.clause}
          ORDER BY o.lead_score DESC, o.created_at DESC
          LIMIT ${limit}`,
        [...params, ...fence.params],
      );
    }

    case 'get_lead': {
      const id = String(args.contactId ?? '');
      if (!id) return { error: 'No contact id given.' };

      const lead = await queryOne(
        `SELECT o.contact_id, c.full_name AS name, c.language,
                s.\`key\` AS stage, o.sub_status, o.lead_score AS score, o.project_name AS project, o.developer,
                o.emirate, o.preferred_location, o.budget_band, o.budget_min_aed, o.budget_max_aed,
                o.unit_type, o.purpose, o.timeline, o.source, o.campaign_name, u.name AS owner,
                DATE_FORMAT(o.created_at, '%Y-%m-%d') AS created,
                DATE_FORMAT((SELECT MAX(a.created_at) FROM activities a
                               WHERE a.opportunity_id = o.id), '%Y-%m-%d %H:%i') AS last_activity
           FROM opportunities o
           JOIN contacts c ON c.id = o.contact_id
           LEFT JOIN pipeline_stages s ON s.id = o.stage_id
           LEFT JOIN users u ON u.id = o.owner_user_id
          WHERE o.contact_id = ?${fence.clause}
          ORDER BY o.created_at DESC LIMIT 1`,
        [id, ...fence.params],
      );
      if (!lead) return { error: 'No lead by that id that you are allowed to see.' };

      const activity = await query(
        `SELECT a.type AS kind, LEFT(COALESCE(a.body, a.title), 200) AS body, DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i') AS at
           FROM activities a WHERE a.contact_id = ? ORDER BY a.created_at DESC LIMIT 8`,
        [id],
      );
      return { lead, activity };
    }

    case 'get_pipeline_stats': {
      const days = clamp(args.days, 30, 365);
      return query(
        `SELECT s.\`key\` AS stage, s.name AS label, COUNT(*) AS leads,
                SUM(o.created_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)) AS recent
           FROM opportunities o
           LEFT JOIN pipeline_stages s ON s.id = o.stage_id
          WHERE o.status = 'open'${fence.clause}
          GROUP BY s.\`key\`, s.name, s.position
          ORDER BY s.position`,
        [days, ...fence.params],
      );
    }

    case 'get_source_quality': {
      const days = clamp(args.days, 30, 365);
      return query(
        `SELECT COALESCE(o.campaign_name, o.source, 'unknown') AS source,
                COUNT(*) AS leads,
                SUM(o.sub_status = 'invalid') AS invalid,
                SUM(EXISTS (SELECT 1 FROM activities a WHERE a.opportunity_id = o.id)) AS touched,
                SUM(o.status = 'won') AS won,
                ROUND(AVG(o.lead_score), 1) AS average_score
           FROM opportunities o
          WHERE o.created_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)${fence.clause}
          GROUP BY source
          HAVING COUNT(*) > 0
          ORDER BY COUNT(*) DESC
          LIMIT 20`,
        [days, ...fence.params],
      );
    }

    case 'get_agent_stats': {
      const days = clamp(args.days, 30, 365);
      return query(
        `SELECT u.name AS agent, COUNT(*) AS leads,
                SUM(o.status = 'won') AS won,
                SUM(o.status = 'open'
                    AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.opportunity_id = o.id)) AS never_touched,
                ROUND(AVG(o.lead_score), 1) AS average_score
           FROM opportunities o
           JOIN users u ON u.id = o.owner_user_id
          WHERE o.created_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)${fence.clause}
          GROUP BY u.id, u.name
          ORDER BY COUNT(*) DESC
          LIMIT 25`,
        [days, ...fence.params],
      );
    }

    case 'get_conversation': {
      const id = String(args.contactId ?? '');
      if (!id) return { error: 'No contact id given.' };

      // The fence is applied through the opportunity, so a conversation is
      // only readable by someone who may see the lead it belongs to.
      const allowed = await queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM opportunities o WHERE o.contact_id = ?${fence.clause}`,
        [id, ...fence.params],
      );
      if (!Number(allowed?.n ?? 0)) return { error: 'No lead by that id that you are allowed to see.' };

      return query(
        `SELECT m.direction, m.channel, LEFT(m.body, 400) AS body,
                DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i') AS at
           FROM messages m
           JOIN conversations cv ON cv.id = m.conversation_id
          WHERE cv.contact_id = ? AND m.body IS NOT NULL
          ORDER BY m.created_at DESC
          LIMIT ${clamp(args.limit, 20, 40)}`,
        [id],
      );
    }

    case 'get_projects': {
      const limit = clamp(args.limit, 10, 20);
      const params: SqlParam[] = [];
      let where = "p.archived_at IS NULL";
      if (typeof args.text === 'string' && args.text.trim()) {
        where += ' AND (p.name LIKE ? OR p.developer LIKE ? OR p.community LIKE ?)';
        const like = `%${args.text.trim().slice(0, 60)}%`;
        params.push(like, like, like);
      }
      return query(
        `SELECT p.name, p.developer, p.community, p.emirate, p.property_type,
                p.starting_price_aed, p.handover_date, p.payment_plan, p.sale_status,
                p.verified_at IS NOT NULL AS verified
           FROM projects p WHERE ${where}
          ORDER BY p.starred DESC, p.name LIMIT ${limit}`,
        params,
      );
    }

    default:
      return { error: `No tool called ${name}.` };
  }
}
