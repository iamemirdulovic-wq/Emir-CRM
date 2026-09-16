import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { clientIp } from '../middleware/auth.js';
import { execute, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { notFound } from '../../lib/errors.js';
import { getVerifiedProjectBySlug } from '../../services/projects.js';
import { enqueue } from '../../jobs/queue.js';
import { addActivity } from '../../ingestion/ingest.js';
import { withRetryingTransaction } from '../../db/client.js';

export const brochureRouter = Router();

/**
 * Branded brochure links: /b/{project}?a={agent}&c={contact}
 *
 * Public by design — the lead clicks it from WhatsApp. It records the open and
 * notifies the agent, then redirects to the real file.
 */
brochureRouter.get(
  '/:slug',
  asyncHandler(async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    const agentUserId = typeof req.query.a === 'string' ? req.query.a : null;
    const contactId = typeof req.query.c === 'string' ? req.query.c : null;

    // Only a verified project has a brochure we are willing to serve.
    const project = await getVerifiedProjectBySlug(slug);
    if (!project?.brochure_url) throw notFound('That brochure is not available');

    await execute(
      `INSERT INTO brochure_views (id, project_id, project_slug, agent_user_id, contact_id, ip, user_agent, referrer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        project.id,
        slug,
        agentUserId,
        contactId,
        clientIp(req),
        (req.get('user-agent') ?? '').slice(0, 500) || null,
        (req.get('referer') ?? '').slice(0, 1000) || null,
      ],
    );

    // Notify the agent that the lead opened it — a strong buying signal, but
    // only once per contact per hour so a slow PDF load is not a flurry.
    if (agentUserId && contactId) {
      const recent = await queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM brochure_views
          WHERE contact_id = ? AND project_slug = ? AND viewed_at > DATE_SUB(NOW(3), INTERVAL 1 HOUR)`,
        [contactId, slug],
      );
      if (Number(recent?.n ?? 0) <= 1) {
        const contact = await queryOne<{ full_name: string | null }>('SELECT full_name FROM contacts WHERE id = ?', [contactId]);
        await enqueue(
          'push.send',
          {
            userId: agentUserId,
            title: 'Brochure opened',
            body: `${contact?.full_name ?? 'A lead'} just opened the ${project.name} brochure.`,
            link: `/contacts/${contactId}`,
          },
          { priority: 3, dedupeKey: `brochure:${contactId}:${slug}:${Math.floor(Date.now() / 3_600_000)}`, contactId },
        );

        await withRetryingTransaction(async (tx) => {
          await addActivity(tx, {
            contactId,
            type: 'brochure.opened',
            title: `Opened the ${project.name} brochure`,
            meta: { projectSlug: slug, agentUserId },
          });
        }).catch((err) => logger.warn('could not record the brochure open', { error: String(err) }));
      }
    }

    res.redirect(302, project.brochure_url);
  }),
);
