import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { blockUntilPasswordChanged, currentUser, requireAuth } from '../middleware/auth.js';
import { execute, query } from '../../db/client.js';
import { badRequest } from '../../lib/errors.js';

/**
 * One person's own choices: how far through the tour they got, and whether
 * they have been shown the keyboard shortcuts.
 *
 * Kept on the server rather than in the browser because somebody who finished
 * the tour on their laptop should not be walked through it again on their
 * phone. Everything here is scoped to the caller by construction — the user id
 * comes from the session, never from the request — so there is no path by
 * which one person reads or writes another's.
 *
 * The names are a fixed list. A preference nobody wrote code for is a typo,
 * and a table anybody can write arbitrary keys into becomes a dumping ground
 * for things that should have been columns.
 */
export const prefsRouter = Router();
prefsRouter.use(requireAuth, blockUntilPasswordChanged);

/*
 * Deliberately short. What the palette was last used for stays in the
 * browser — which screens somebody jumps to on their laptop are not the ones
 * they jump to on their phone, and a write to the database on every Cmd+K
 * would be a lot of rows for very little.
 */
export const PREF_NAMES = ['tour_state', 'shortcuts_seen'] as const;
export type PrefName = (typeof PREF_NAMES)[number];

const putSchema = z.object({
  name: z.enum(PREF_NAMES),
  /** Null clears it, which is how the tour is reset to be replayed. */
  value: z.string().max(1000).nullable(),
});

prefsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const rows = await query<{ name: string; value: string | null }>(
      'SELECT name, value FROM user_prefs WHERE user_id = ?',
      [user.id],
    );
    const prefs: Record<string, string | null> = {};
    for (const row of rows) prefs[row.name] = row.value;
    res.json({ prefs });
  }),
);

prefsRouter.put(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('That is not a preference this app keeps.', parsed.error.issues);
    const user = currentUser(req);

    if (parsed.data.value === null) {
      await execute('DELETE FROM user_prefs WHERE user_id = ? AND name = ?', [user.id, parsed.data.name]);
    } else {
      await execute(
        `INSERT INTO user_prefs (user_id, name, value) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [user.id, parsed.data.name, parsed.data.value],
      );
    }

    /*
     * Not audited. `audit_log` is for things that change the business — a
     * reassigned lead, an edited price, a deleted project — and burying those
     * under one row per tour step would make it useless for the thing it is
     * for.
     */
    res.json({ ok: true });
  }),
);
