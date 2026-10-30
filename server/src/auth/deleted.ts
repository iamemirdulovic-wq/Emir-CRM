/**
 * The fence around deleted leads.
 *
 * A deleted contact is a row with `deleted_at` set. It is still there — the
 * whole point is that nothing is destroyed — so every query that a person
 * browses has to say it does not want them. These constants are that
 * sentence, in one place, so a search for `LIVE_CONTACT` finds every site
 * that makes the decision and shows the ones that deliberately do not.
 *
 * **One place must not use them: identity resolution.** When a client who was
 * deleted enquires again, the lookup has to find that row, because the phone
 * number is still unique in the table and inserting a second one would fail.
 * It revives the old record instead, with its history intact — which is
 * better than a new blank lead anyway. See `ingestion/identity.ts`.
 */

/** For `contacts c` — the common alias across the codebase. */
export const LIVE_CONTACT = 'c.deleted_at IS NULL';

/** For an unaliased `FROM contacts`. */
export const LIVE_CONTACT_BARE = 'contacts.deleted_at IS NULL';

/** For `opportunities o`. */
export const LIVE_OPPORTUNITY = 'o.deleted_at IS NULL';

/** For an unaliased `FROM opportunities`. */
export const LIVE_OPPORTUNITY_BARE = 'opportunities.deleted_at IS NULL';
