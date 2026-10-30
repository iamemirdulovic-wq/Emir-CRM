import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { blockUntilPasswordChanged, currentUser, requireAuth } from '../middleware/auth.js';
import { ownerPredicate, visibleUserIds } from '../../auth/scope.js';
import { query } from '../../db/client.js';
import { likeTerm, looksLikePhone, phoneTail } from '../../leads/search-terms.js';

/**
 * What the command palette asks the server.
 *
 * Two kinds of thing: leads, fenced to what the signed-in person may see, and
 * projects, which everybody may see. Deliberately small and deliberately fast:
 * it runs on every keystroke after a short pause, so it is two indexed LIKE
 * queries with a hard cap and nothing else. No counts, no joins for display
 * fields the palette will not show.
 */
export const searchRouter = Router();
searchRouter.use(requireAuth, blockUntilPasswordChanged);

const schema = z.object({
  q: z.string().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(10).default(6),
});

export interface SearchHit {
  id: string;
  label: string;
  hint: string | null;
  to: string;
}

searchRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      res.json({ leads: [], projects: [] });
      return;
    }
    const { q, limit } = parsed.data;
    const user = currentUser(req);
    const visible = await visibleUserIds(user);

    const [leads, projects] = await Promise.all([
      searchLeads(q, visible, limit),
      searchProjects(q, limit),
    ]);

    res.json({ leads, projects });
  }),
);

async function searchLeads(q: string, visible: string[] | null, limit: number): Promise<SearchHit[]> {
  const scope = ownerPredicate('o.owner_user_id', visible);
  const like = likeTerm(q);
  /* Only add the phone clause when the query is actually a number. */
  const tail = looksLikePhone(q) ? phoneTail(q) : null;

  const rows = await query<{
    opportunity_id: string;
    contact_id: string;
    full_name: string | null;
    phone_e164: string | null;
    project_name: string | null;
    stage: string;
  }>(
    `SELECT o.id AS opportunity_id, o.contact_id, c.full_name, c.phone_e164,
            o.project_name, s.\`key\` AS stage
       FROM opportunities o
       JOIN contacts c ON c.id = o.contact_id
       JOIN pipeline_stages s ON s.id = o.stage_id
      WHERE o.deleted_at IS NULL AND ${scope.sql}
        AND (c.full_name LIKE ? OR c.email LIKE ? OR o.project_name LIKE ?
             ${tail ? 'OR c.phone_e164 LIKE ?' : ''})
      ORDER BY o.last_contact_at IS NULL, o.last_contact_at DESC, o.created_at DESC
      LIMIT ?`,
    [...scope.params, like, like, like, ...(tail ? [tail] : []), limit],
  );

  return rows.map((row) => ({
    id: row.opportunity_id,
    label: row.full_name?.trim() || row.phone_e164 || 'Unnamed lead',
    hint: [row.project_name, STAGE_WORDS[row.stage] ?? null].filter(Boolean).join(' · ') || null,
    to: `/contacts/${row.contact_id}`,
  }));
}

async function searchProjects(q: string, limit: number): Promise<SearchHit[]> {
  const like = likeTerm(q);
  const rows = await query<{
    id: string;
    name: string;
    developer: string;
    community: string | null;
    area: string | null;
    sale_status: string;
  }>(
    `SELECT id, name, developer, community, area, sale_status
       FROM projects
      WHERE archived_at IS NULL
        AND (name LIKE ? OR developer LIKE ? OR community LIKE ? OR area LIKE ?)
      ORDER BY starred DESC, name ASC
      LIMIT ?`,
    [like, like, like, like, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    label: row.name,
    hint: [row.developer, row.community ?? row.area].filter(Boolean).join(' · ') || null,
    to: `/projects?project=${encodeURIComponent(row.id)}`,
  }));
}

/** Stage keys as a person reads them, for the one line under a lead's name. */
const STAGE_WORDS: Record<string, string> = {
  new_lead: 'New',
  attempted_contact: 'Trying to reach',
  engaged_qualified: 'Engaged',
  appointment_scheduled: 'Appointment',
  deal_sent: 'Deal sent',
  won: 'Won',
  lost: 'Lost',
};
