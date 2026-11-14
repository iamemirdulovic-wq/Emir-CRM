/**
 * Where a live-CRM path goes in v2.
 *
 * One search endpoint and one notifications table feed both front ends, so
 * both write the live CRM's own addresses: `/contacts/c-1`, `/my-leads`,
 * `/inbox/cv-3`. A v2 screen that shows one of those rows has to turn it into
 * a v2 address before it can link to it.
 *
 * Until now both of them did that by writing `/v2` in front of whatever came
 * back. That is right for `/incoming` and `/wall`, and wrong for everything
 * else: `/contacts/c-1` became `/v2/contacts/c-1`, which is not a route, so
 * every lead in the search results and every notification about a lead landed
 * on "That page does not exist" and threw the agent out of v2 altogether.
 * Emir, 14 Nov: *"The top search still links to /v2/contacts and opens the old
 * 'page does not exist'."*
 *
 * So the move is a table rather than a prefix, and `dead-links.test.ts` checks
 * every line of it against the real router. A link that points nowhere is two
 * minutes of an agent's day and the end of their patience.
 */

/** The live-CRM paths that have a v2 screen of their own, exactly. */
const SAME_RECORD: Record<string, string> = {
  /* `notify.ts` falls back to `/dashboard` for anything without a link of its
     own, and in v2 everybody's first screen is My Day. `/v2/dashboard` is the
     owner's report, which is a different screen and not an agent's to open. */
  '/dashboard': '/v2',
  '/my-leads': '/v2/leads',
  '/leads': '/v2/leads',
  /* The list, not a record: `/contacts` redirects to My Leads in v1 too. */
  '/contacts': '/v2/leads',
  /* Workflow A's "nobody could take this one" alert. The leads nobody is
     working on are Incoming in v2. */
  '/unassigned': '/v2/incoming',
};

/**
 * The v2 address for a path the server wrote.
 *
 * Anything already under `/v2` is left exactly as it is — most of the newer
 * notifications are written that way — and anything with no v2 screen of its
 * own keeps the prefix behaviour, which is right for the screens whose name
 * did not change.
 */
export function v2Path(link: string | null | undefined): string {
  const raw = (link ?? '').trim();
  if (!raw.startsWith('/')) return '/v2';
  if (raw === '/v2' || raw.startsWith('/v2/') || raw.startsWith('/v2?')) return raw;

  const cut = raw.indexOf('?');
  const path = cut < 0 ? raw : raw.slice(0, cut);
  const search = cut < 0 ? '' : raw.slice(cut);

  const named = SAME_RECORD[path];
  if (named) return named;

  /*
   * A lead. The search endpoint carries the enquiry as well as the person
   * (`?lead=o-7`), because a contact with two enquiries was opened on
   * whichever came back first — so when it is there, go straight to that
   * lead's page and spend no round trip finding it again.
   */
  const contact = /^\/contacts\/([^/]+)$/.exec(path);
  if (contact) {
    const lead = new URLSearchParams(search).get('lead');
    /* Encoded, because it arrives as a query value and leaves as a path
       segment, and those are not the same alphabet. */
    return lead ? `/v2/leads/${encodeURIComponent(lead)}` : `/v2/contacts/${contact[1] as string}`;
  }

  /* One conversation. v2's inbox opens on its own list rather than on a
     thread, so the thread id is dropped rather than put in an address that
     does not read it. */
  if (/^\/inbox\/[^/]+$/.test(path)) return '/v2/inbox';

  return `/v2${raw}`;
}
