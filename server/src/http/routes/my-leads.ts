import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAdmin, requireAuth,
  requirePermission,
} from '../middleware/auth.js';
import { ownerPredicate, visibleUserIds } from '../../auth/scope.js';
import { isManagerOrAbove } from '../../auth/rbac.js';
import { query, queryOne } from '../../db/client.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { leadBrief, refreshNotesDigest } from '../../ai/lead-review.js';
import { isLeadTab, TABS, LEAD_TABS, type LeadTab } from '../../leads/tabs.js';
import { leadTabCounts } from '../../leads/counts.js';
import { contact360 } from '../../services/contacts.js';
import {
  LEAD_ACTIONS, LOST_REASONS, PROBLEM_REASONS, WON_SIGNED, runLeadAction,
} from '../../leads/actions.js';
import {
  PAYMENTS, PURPOSES, TIMELINES, WANT_CHOICES, fieldHistory, updateWants,
} from '../../leads/wants.js';
import { handoverChain } from '../../leads/handovers.js';
import {
  FILE_FOLDERS, FOLDER_LABELS, filesForContact, isFileFolder,
} from '../../leads/note-files.js';
import { addNote } from '../../leads/notes.js';
import { MOVE_LIMIT, moveLeads } from '../../leads/move.js';
import {
  asleepNow, awakeNow, countriesClause, countriesMatching, countryClause, countryOf,
  languageName, languagesMatching,
} from '../../leads/countries.js';
import { toCsvRow } from '../../imports/csv.js';
import { writeAudit } from '../../audit/audit.js';
import { leadFacets } from '../../leads/facets.js';
import { DAILY_GOALS } from '../../v2/home.js';
import { DAY_END, DAY_START } from '../../v2/dubai.js';

/**
 * My Leads: the screen an agent lives in.
 *
 * Every query is fenced to what the signed-in person may see, in SQL, by the
 * same `ownerPredicate` the rest of the CRM uses. An agent asking for the
 * "all" tab gets all of *theirs*; there is no parameter that widens it.
 */
export const myLeadsRouter = Router();
myLeadsRouter.use(requireAuth, blockUntilPasswordChanged);

const listSchema = z.object({
  tab: z.string().optional(),
  search: z.string().max(120).optional(),
  /* Manager+ only; an agent asking for someone else's leads is ignored
     rather than refused, because the fence below makes it moot anyway. */
  agent: z.string().max(36).optional(),
  stage: z.string().max(48).optional(),
  source: z.string().max(48).optional(),
  project: z.string().max(160).optional(),
  band: z.enum(['hot', 'warm', 'cold']).optional(),
  /*
   * The country chips. An ISO 3166-1 alpha-2 code the dialling table holds,
   * or `unknown` for a number whose code we cannot read. A value that is
   * neither is ignored rather than refused: a hand-typed `?country=xx` in
   * the URL should not empty somebody's screen.
   */
  country: z.string().max(12).optional(),
  /* `contacts.language` as stored, or `unknown` for a blank one. */
  language: z.string().max(12).optional(),
  /*
   * "Added: any time / Today / This week / This month" — picture 02's own
   * words. Every boundary is Dubai's: a lead added at 02:00 Dubai was added
   * today, whatever the server's clock thinks.
   */
  added: z.enum(['today', 'week', 'month']).optional(),
  /* `namespace:value`, e.g. `batch:expo-2026-30oct-a3f2` — how one upload is
     found again after the fact. */
  tag: z.string().max(160).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(30),
});

interface Filters {
  where: string[];
  args: Array<string | number>;
}

/**
 * What the search box understands.
 *
 * It always matched a name, a number, an email and a project. Emir, 14
 * November 2026: *"also in the search button... our search button should be
 * very advance"*. So it now also takes:
 *
 *   - a country — "india", "uae", "ae", "971", "+971", "moscow"
 *   - a language — "arabic", "ar", "russian"
 *   - "asleep" / "awake", which agents ask for out loud, because the one
 *     thing they want before a calling session is the list they may ring
 *     right now
 *
 * All of it is plain matching against real columns: the country comes out of
 * the digits of the number, the language out of `contacts.language`, and
 * asleep out of the clock in the client's own zone. No model is asked.
 *
 * The terms are OR'd on top of the four original fields rather than replacing
 * them, so typing a word that happens to be both — a project called "India",
 * say — finds everything it could reasonably mean. The screen says what it
 * understood; it never silently narrows.
 *
 * Written once and used by the list, the counts, the facets, "select all" and
 * the "next lead" walk, which each had their own copy of the four-field
 * version and would otherwise have drifted the moment this grew.
 */
export function searchClause(search: string, now: Date = new Date()): Filters | null {
  const term = search.trim();
  if (!term) return null;

  const parts = ['c.full_name LIKE ?', 'c.phone_e164 LIKE ?', 'c.email LIKE ?', 'o.project_name LIKE ?'];
  const like = `%${term}%`;
  const args: Array<string | number> = [like, like, like, like];

  const countries = countriesMatching(term);
  if (countries.length > 0) {
    const clause = countriesClause('c.phone_e164', countries);
    if (clause) { parts.push(clause.sql); args.push(...clause.params); }
  }

  const languages = languagesMatching(term);
  if (languages.length > 0) {
    parts.push(`LOWER(TRIM(COALESCE(c.language, ''))) IN (${languages.map(() => '?').join(', ')})`);
    args.push(...languages);
  }

  /* "asleep", "sleeping", "night" — one word for one idea, and the hours are
     `countries.ts`'s, which is the same rule as the moon on the chip. */
  /* One space between words, so "night  time" is the same question as
     "night time" — somebody typing into a phone keyboard, not a form. */
  const word = term.toLowerCase().replace(/\s+/g, ' ');
  const asleep = ['asleep', 'sleeping', 'night', 'night time', 'do not call'].includes(word);
  const awake = ['awake', 'daytime', 'day time', 'ok to call', 'can call'].includes(word);
  if (asleep || awake) {
    const clause = countriesClause('c.phone_e164', asleep ? asleepNow(now) : awakeNow(now));
    if (clause) { parts.push(clause.sql); args.push(...clause.params); }
  }

  return { where: [`(${parts.join(' OR ')})`], args };
}

/**
 * The filters that apply whichever tab is open.
 *
 * `except` leaves one of them out, which is what a chip's own count needs: a
 * country chip's number is the list as it would be without the country chip,
 * or picking UAE would make every other country read 0.
 */
function buildFilters(
  params: z.infer<typeof listSchema>,
  visible: string[] | null,
  except: 'country' | 'language' | null = null,
): Filters {
  const scope = ownerPredicate('o.owner_user_id', visible);
  const where = [scope.sql];
  const args: Array<string | number> = [...scope.params];

  if (params.search) {
    const clause = searchClause(params.search);
    if (clause) {
      where.push(...clause.where);
      args.push(...clause.args);
    }
  }
  /*
   * Which country the number is from, worked out from its dialling code.
   *
   * Deliberately not `contacts.country`, which exists and means something
   * else — where the person told us they live, filled in by a form. The chips
   * are about the number an agent is about to ring.
   */
  if (params.country && except !== 'country') {
    const clause = countryClause('c.phone_e164', params.country);
    if (clause) {
      where.push(clause.sql);
      args.push(...clause.params);
    }
  }
  /*
   * When the lead arrived. Counted in Dubai time with the fixed +04:00
   * offset the rest of this file uses — Dubai has no daylight saving and the
   * fixed offset is deliberate, not an oversight.
   */
  if (params.added) {
    const DUBAI_MIDNIGHT = "CONVERT_TZ(DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00')), '+04:00', '+00:00')";
    if (params.added === 'today') where.push(`o.created_at >= ${DUBAI_MIDNIGHT}`);
    /* Seven days back from this morning, not "this calendar week": an agent
       asking what came in this week on a Monday means the last few days. */
    if (params.added === 'week') where.push(`o.created_at >= DATE_SUB(${DUBAI_MIDNIGHT}, INTERVAL 7 DAY)`);
    if (params.added === 'month') where.push(`o.created_at >= DATE_SUB(${DUBAI_MIDNIGHT}, INTERVAL 30 DAY)`);
  }
  if (params.language && except !== 'language') {
    if (params.language === 'unknown') {
      where.push("TRIM(COALESCE(c.language, '')) = ''");
    } else {
      where.push("LOWER(TRIM(COALESCE(c.language, ''))) = ?");
      args.push(params.language.toLowerCase());
    }
  }
  /* A manager narrowing to one of their agents. The scope above already
     limits which agents that can be, so no extra check is needed. */
  if (params.agent) {
    where.push('o.owner_user_id = ?');
    args.push(params.agent);
  }
  if (params.stage) {
    where.push('o.stage_key = ?');
    args.push(params.stage);
  }
  if (params.source) {
    where.push('o.source = ?');
    args.push(params.source);
  }
  /*
   * The project filter, matched on the letters and digits alone.
   *
   * `o.project_name` is free text — it arrives from a Meta form, an import
   * column, an agent typing, and the library's own name — so an exact `=`
   * against it is a filter that can return nothing while the list plainly
   * shows leads on that project. "Sei Saadiyat" and "Sei  Saadiyat" are the
   * same project to everybody except `=`.
   *
   * Stripping everything but letters and digits also makes the slugs the
   * dashboards link with work: `?project=valia` finds "Valia", and
   * `?project=sei-saadiyat` finds "Sei Saadiyat". `design/web/all-leads.html`
   * does the same thing, in `slug()`, for the same reason.
   */
  if (params.project) {
    where.push(
      "LOWER(REGEXP_REPLACE(COALESCE(o.project_name,''), '[^a-zA-Z0-9]', ''))"
      + " = LOWER(REGEXP_REPLACE(?, '[^a-zA-Z0-9]', ''))",
    );
    args.push(params.project);
  }
  if (params.band) {
    where.push('o.score_band = ?');
    args.push(params.band);
  }
  /*
   * EXISTS rather than a join: a contact can carry a dozen tags, and joining
   * would multiply every lead by its tag count before the DISTINCT that would
   * then be needed to undo it.
   */
  if (params.tag) {
    const [namespace, ...rest] = params.tag.split(':');
    const value = rest.join(':');
    if (namespace && value) {
      where.push(
        'EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id'
        + ' WHERE ct.contact_id = c.id AND t.namespace = ? AND t.value = ?)',
      );
      args.push(namespace, value);
    }
  }
  return { where, args };
}

const SELECT = `
  SELECT o.id, o.contact_id, o.stage_key, o.sub_status, o.status, o.project_name, o.source,
         o.budget_min_aed, o.budget_max_aed, o.lead_score, o.score_band, o.score_reason,
         o.next_step_type, o.next_step_at, o.next_step_note, o.last_contact_at,
         o.no_answer_count, o.created_at, o.owner_user_id, o.unit_type, o.preferred_location,
         /* The three lines of "What the client wants" that were never sent:
            the columns have existed since the first migration. */
         o.purpose, o.payment_method, o.timeline, o.budget_band,
         /* The deal, for a lead that is Won. Recorded by the Won dialog and
            worth nothing if the page cannot show it back. */
         o.deal_value_aed, o.won_paid_aed, o.won_signed, o.won_unit, o.lost_reason_v2,
         /* v2: the VIP tag on a row, and the lead that came back. Added to
            the existing shape rather than a second endpoint -- one list, one
            query, whichever version is asking. */
         o.is_vip, o.returned_at,
         /*
          * When this lead was given to the agent who holds it.
          *
          * Talha, 14 Nov 2026, over a screenshot of 105 identical new lead
          * cards: "you need to put dates on the leads once they assign, so we
          * know which one is today leads, which one is yesterday". The column
          * has been on the opportunities table since migration 0001 and is
          * written by every assignment path -- Workflow A, Incoming, a
          * transfer, a bulk move, an import -- and was never once selected
          * into this list.
          *
          * It is deliberately NOT created_at. The two differ exactly where
          * it matters: a lead moved between agents, and an old list imported
          * months after those people enquired. NULL means never given out
          * (or returned to the pool), and the screens say so rather than
          * substituting another date.
          */
         o.assigned_at,
         c.full_name, c.phone_e164, c.email, c.language, c.dnc, c.last_inbound_at,
         u.name AS owner_name
    FROM opportunities o
    JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
    LEFT JOIN users u ON u.id = o.owner_user_id`;

/**
 * The next lead to work after this one.
 *
 * Emir, 10 Nov 2026: "next in the right should be button, next leads, so it
 * will be going next leads, so it's easy." An agent with forty leads was
 * going back to the list and finding their place again after every single
 * call, which is forty detours a day.
 *
 * Oldest first among the open leads this person can see, skipping the one
 * they are on. Oldest because that is the one going coldest, which is the
 * order Incoming uses and the order an agent would pick by hand.
 *
 * Scoped with `visibleUserIds`, the same rule as the list itself, and not
 * `owner_user_id = me`. I wrote it the narrow way first and the button
 * simply never appeared for Emir: an owner personally holds almost no leads,
 * so "the next one of mine" was empty every time while the screen behind it
 * showed hundreds. An agent still gets only their own, because that is what
 * `visibleUserIds` returns for an agent.
 */
/*
 * How far "Next lead" will walk before it stops offering one.
 *
 * Nobody presses the button four thousand times, and an unbounded window
 * over every lead in the CRM is the kind of query that took the site down
 * on 10 Nov.
 */
const WALK_LIMIT = 4000;

myLeadsRouter.get(
  '/:id/next',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const here = String(req.params.id);
    const visible = await visibleUserIds(user);
    const scope = ownerPredicate('o.owner_user_id', visible);

    /*
     * The one AFTER this one, in the order of the list the agent came from.
     *
     * The first version asked for "the oldest open lead that is not this
     * one", which is not a next at all: from the oldest you get the second,
     * and from the second you get the oldest again. Emir's agents, 11 Nov:
     * "it's just repeating only first two leads all over again." They were
     * right, and it had been doing that since the button was built.
     *
     * So it walks the real list. Same tab, same filters, same ORDER BY as
     * My Leads, and `o.id` last so the order is settled: a file of six
     * hundred imported leads shares a `created_at` to the second, and
     * without a tiebreaker MySQL may hand them back in a different order
     * each time -- which on its own is enough to make a walk go in circles.
     *
     * Bounded at WALK_LIMIT. An agent is not pressing this four thousand
     * times, and an unbounded window over every lead in the CRM is the kind
     * of query that took the site down on 10 Nov.
     */
    const tab: LeadTab = isLeadTab(req.query.tab) ? req.query.tab : 'all';
    const definition = TABS[tab];
    const args: (string | number)[] = [...scope.params];

    let clause = `${scope.sql} AND ${definition.where} AND o.owner_user_id IS NOT NULL`;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    /* The same clause the list is built from — `searchClause`, not a second
       copy of it, so the walk cannot skip a lead the list is showing. */
    const typed = searchClause(search);
    if (typed) {
      clause += ` AND ${typed.where.join(' AND ')}`;
      args.push(...typed.args);
    }

    const next = await queryOne<{ id: string; contact_id: string; full_name: string | null }>(
      `WITH walk AS (
         SELECT o.id, o.contact_id, c.full_name,
                ROW_NUMBER() OVER (ORDER BY ${definition.orderBy}, o.id ASC) AS seat
           FROM opportunities o
           JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
          WHERE ${clause}
          ORDER BY ${definition.orderBy}, o.id ASC
          LIMIT ${WALK_LIMIT}
       )
       SELECT id, contact_id, full_name FROM walk
        WHERE seat > COALESCE((SELECT seat FROM walk WHERE id = ?), 0)
        ORDER BY seat ASC
        LIMIT 1`,
      [...args, here],
    );

    /* Null rather than a 404: "nothing left" is an answer the button shows,
       not an error it has to handle. */
    res.json({ next: next ?? null });
  }),
);

myLeadsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const params = listSchema.parse(req.query);
    const tab: LeadTab = isLeadTab(params.tab) ? params.tab : 'today';
    const visible = await visibleUserIds(user);
    const { where, args } = buildFilters(params, visible);

    const definition = TABS[tab];
    const clause = [definition.where, ...where].join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const items = await query(
      `${SELECT} WHERE ${clause} ORDER BY ${definition.orderBy} LIMIT ${params.pageSize} OFFSET ${offset}`,
      args,
    );
    const total = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
        WHERE ${clause}`,
      args,
    );

    /*
     * How many leads were given out on each day, over the whole filtered
     * list rather than the fifty on this page.
     *
     * The screen groups the rows it has under a heading per day, and that
     * heading carries a count. Counting the rows in hand made every band on
     * a long list read "50 leads", because fifty is the page size -- the
     * owner saw "Thursday 12 Nov · 50 leads" above a book of 2,041 and was
     * right to doubt it. A number on a screen has to be the answer to the
     * question it appears to answer.
     *
     * Dubai is UTC+4 with no daylight saving, and the fixed offset is used
     * on purpose everywhere in this file.
     */
    const days = await query<{ day: string | null; n: number }>(
      `SELECT DATE(CONVERT_TZ(o.assigned_at, '+00:00', '+04:00')) AS day, COUNT(*) AS n
         FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
        WHERE ${clause}
        GROUP BY day
        ORDER BY day DESC`,
      args,
    );

    res.json({
      tab,
      items,
      page: params.page,
      pageSize: params.pageSize,
      total: Number(total?.n ?? 0),
      /* `day` is null for the leads nobody has been given. */
      givenDays: days.map((d) => ({
        day: d.day === null ? null : String(d.day).slice(0, 10),
        count: Number(d.n),
      })),
      empty: { title: definition.emptyTitle, hint: definition.emptyHint },
    });
  }),
);

/**
 * The number on each tab.
 *
 * The query lives in `leads/counts.ts`, with the one that the v2 home screen
 * reads, so a tab and the list under it cannot be counted two different ways.
 * They were, until 12 November: "All" was a plain `COUNT(*)` here while the
 * list was built from `TABS.all.where`, which excludes deleted leads. The tab
 * read one too high for every lead anybody had ever deleted, silently.
 */
myLeadsRouter.get(
  '/counts',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const params = listSchema.parse(req.query);
    const visible = await visibleUserIds(user);
    /* The scope is already inside `leadTabCounts`; what comes back from
       `buildFilters` on top of it is the screen's own narrowing. */
    const { where, args } = buildFilters(params, visible);
    const mine = where.slice(1);
    const mineArgs = args.slice(ownerPredicate('o.owner_user_id', visible).params.length);

    /*
     * The two numbers in the black bar above the table — picture 01, point 9:
     * *"Black bar on top: leads ready to call, calls today with progress,
     * Start calling."*
     *
     * Counted here rather than fetched from `/api/v2/home`, which is the
     * agent's home screen and a different request: this screen already asks
     * for the counts, and a second round trip for one integer is a second
     * spinner. `DAILY_GOALS.calls` is Emir's own 40 from his design package,
     * sent from the server so that when Settings can set it per agent there
     * is one place to change.
     *
     * `call_logs` is per person, so a manager or an owner sees their own
     * calls, not the team's. That is what the bar says — "18 of 40 calls
     * today" is about the person reading it.
     */
    const today = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM call_logs
        WHERE user_id = ? AND started_at >= ${DAY_START} AND started_at < ${DAY_END}`,
      [user.id],
    );

    res.json({
      ...await leadTabCounts(visible, { where: mine, args: mineArgs }),
      callsToday: Number(today?.n ?? 0),
      callGoal: DAILY_GOALS.calls,
    });
  }),
);

/**
 * The country and language chips, with their real counts.
 *
 * Fenced exactly like every other query on this screen: an agent's chips add
 * up to their own leads and nobody else's, a manager's to their team, an
 * owner's to the whole book. The fence is `ownerPredicate` in SQL, inside
 * `buildFilters`, so there is no parameter that widens it.
 *
 * Registered above `/:id` with `/counts` and `/projects`: Express matches in
 * declaration order, and `/:id` placed first would swallow this for ever.
 */
myLeadsRouter.get(
  '/facets',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const params = listSchema.parse(req.query);
    const tab: LeadTab = isLeadTab(params.tab) ? params.tab : 'all';
    const visible = await visibleUserIds(user);
    const definition = TABS[tab];

    /* Each facet is counted over the list the *other* filters allow, so the
       chips you are not standing on still say how many are behind them. */
    const forCountries = buildFilters(params, visible, 'country');
    const forLanguages = buildFilters(params, visible, 'language');

    res.json(await leadFacets(
      { where: [definition.where, ...forCountries.where], args: forCountries.args },
      { where: [definition.where, ...forLanguages.where], args: forLanguages.args },
      /* So a chip that is chosen always comes back, even at zero: otherwise
         it disappears from the row the moment the other chip empties it. */
      { country: params.country, language: params.language },
    ));
  }),
);

/**
 * The projects to put in the project filter.
 *
 * Not the library — the projects the leads in front of this person are
 * actually on. The screen filled the dropdown from `/api/projects` and then
 * matched it against `opportunities.project_name`, so it offered library rows
 * no lead carries (pick one, get nothing) and offered the same name twice
 * whenever the library held it twice, which it can: `projects.name` has no
 * unique key, only `slug`. That is the "Sei Saadiyat, twice" the owner saw.
 *
 * Grouped on the letters and digits alone, exactly as the filter matches, so
 * "Sei Saadiyat" and "Sei  saadiyat" are one option with one count — and
 * every option in the list has at least one lead behind it by construction.
 * `MAX(name)` picks one spelling to show; `n` is the real number.
 *
 * Registered above `/:id`, like `/counts`: Express matches in declaration
 * order and `/:id` would swallow it for ever, silently.
 */
myLeadsRouter.get(
  '/projects',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const visible = await visibleUserIds(user);
    const scope = ownerPredicate('o.owner_user_id', visible);

    const items = await query<{ name: string; n: number }>(
      `SELECT MAX(o.project_name) AS name, COUNT(*) AS n
         FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
        WHERE o.deleted_at IS NULL AND ${scope.sql}
          AND o.project_name IS NOT NULL AND TRIM(o.project_name) <> ''
        GROUP BY LOWER(REGEXP_REPLACE(o.project_name, '[^a-zA-Z0-9]', ''))
        ORDER BY name`,
      scope.params,
    );

    res.json({ items: items.map((one) => ({ name: one.name, leads: Number(one.n) })) });
  }),
);

/**
 * "Export" — the button beside the lead count on the owner's book.
 *
 * Picture 02, §7 of the 14 November fix list. Owner and admin only, and
 * audited, because this is the endpoint that can walk out of the building
 * with the whole book: the same `requireAdmin` + `requirePermission('export')`
 * pair the list export uses, and the same fence in SQL under it, so even an
 * admin only ever gets the leads they may see.
 *
 * Exactly the rows the filters are showing, in the order the screen shows
 * them. Capped, because a browser asking for 100,000 rows over one request
 * is the kind of query that took the site down on 10 Nov.
 *
 * Registered above `/:id`, like `/counts`, `/facets` and `/projects`.
 */
const EXPORT_LIMIT = 5000;

myLeadsRouter.get(
  '/export.csv',
  requireAdmin,
  requirePermission('export'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const params = listSchema.parse(req.query);
    const tab: LeadTab = isLeadTab(params.tab) ? params.tab : 'all';
    const visible = await visibleUserIds(user);
    const { where, args } = buildFilters(params, visible);
    const definition = TABS[tab];

    const rows = await query<Record<string, unknown>>(
      `${SELECT} WHERE ${[definition.where, ...where].join(' AND ')}
        ORDER BY ${definition.orderBy} LIMIT ${EXPORT_LIMIT}`,
      args,
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${tab}.csv"`);
    res.write(toCsvRow([
      'Name', 'Phone', 'Email', 'Country', 'Language', 'Project', 'Stage',
      'Agent', 'Given out', 'Last contact', 'Next step', 'Source',
    ]));
    for (const row of rows) {
      /* The country is read off the number the same way the chips count it,
         and left blank — never guessed — where the dialling code is not one
         the table holds. */
      const origin = countryOf(row.phone_e164 as string | null);
      res.write(toCsvRow([
        row.full_name, row.phone_e164, row.email,
        origin?.name ?? '',
        /* Never a raw code in a file somebody opens in Excel. */
        row.language ? languageName(String(row.language)) : '',
        row.project_name, row.stage_key, row.owner_name,
        row.assigned_at, row.last_contact_at, row.next_step_note, row.source,
      ]));
    }
    res.end();

    await writeAudit({
      actor: actorFrom(req),
      action: 'leads.exported',
      entityType: 'opportunity',
      entityId: null,
      after: { tab, rows: rows.length, filters: { ...params, page: undefined, pageSize: undefined } },
    });
  }),
);

const actionSchema = z.object({
  action: z.enum(LEAD_ACTIONS),
  reason: z.string().max(60).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  nextStep: z.object({
    type: z.enum(['call', 'whatsapp', 'email', 'meeting', 'viewing', 'other']),
    at: z.string().min(4),
    note: z.string().max(255).nullable().optional(),
  }).nullable().optional(),
  meetingAt: z.string().nullable().optional(),
  meetingKind: z.string().max(60).nullable().optional(),
  meetingWhere: z.string().max(200).nullable().optional(),
  wonProject: z.string().max(160).nullable().optional(),
  wonUnit: z.string().max(60).nullable().optional(),
  /*
   * The money on a Won deal. Whole dirhams, never a float, and never more
   * than the price for the amount paid — checked again in `runLeadAction`,
   * because a deposit larger than the price is a typo every time.
   */
  wonPriceAed: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
  wonPaidAed: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
  wonSigned: z.enum(WON_SIGNED).nullable().optional(),
});

/**
 * One of the nine buttons.
 *
 * The permission check is "can I see this lead", because an agent acting on
 * their own lead is the normal case and a manager acting on their team's is
 * the other one. Anything outside that is already invisible to them.
 */
myLeadsRouter.post(
  '/:id/action',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const opportunityId = String(req.params.id);
    const parsed = actionSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('That is not an action this lead can take.', parsed.error.issues);

    const visible = await visibleUserIds(user);
    const scope = ownerPredicate('o.owner_user_id', visible);
    const allowed = await queryOne<{ id: string }>(
      `SELECT o.id FROM opportunities o WHERE o.id = ? AND o.deleted_at IS NULL AND ${scope.sql}`,
      [opportunityId, ...scope.params],
    );
    if (!allowed) throw badRequest('That lead is not yours to work.');

    if (parsed.data.action === 'lost' && parsed.data.reason
      && !(LOST_REASONS as readonly string[]).includes(parsed.data.reason)) {
      throw badRequest('That is not one of the reasons a deal is lost.');
    }
    if (parsed.data.action === 'problem' && parsed.data.reason
      && !(PROBLEM_REASONS as readonly string[]).includes(parsed.data.reason)) {
      throw badRequest('That is not one of the problems a lead can have.');
    }

    res.json(await runLeadAction(actorFrom(req), { opportunityId, ...parsed.data }));
  }),
);

const nextStepSchema = z.object({
  type: z.enum(['call', 'whatsapp', 'email', 'meeting', 'viewing', 'other']),
  at: z.string().min(4),
  note: z.string().max(255).nullable().optional(),
});

/** Setting or changing what is owed next, on its own. */
myLeadsRouter.post(
  '/:id/next-step',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const opportunityId = String(req.params.id);
    const body = nextStepSchema.parse(req.body);

    const visible = await visibleUserIds(user);
    const scope = ownerPredicate('o.owner_user_id', visible);
    const allowed = await queryOne<{ id: string; contact_id: string }>(
      `SELECT o.id, o.contact_id FROM opportunities o
        WHERE o.id = ? AND o.deleted_at IS NULL AND ${scope.sql}`,
      [opportunityId, ...scope.params],
    );
    if (!allowed) throw badRequest('That lead is not yours to work.');

    const result = await runLeadAction(actorFrom(req), {
      opportunityId,
      /* Recorded as a callback being set rather than a silent field edit:
         who promised what, and when, is worth keeping. */
      action: 'call_back',
      nextStep: body,
    });
    res.json(result);
  }),
);

/**
 * The brief at the top of the lead page: what the notes add up to, what the AI
 * makes of the lead, and what to do next.
 *
 * A plain read — no model call — so opening a lead is never slower because of
 * it. The notes summary is whatever was last worked out, with a `stale` flag
 * when somebody has added a note since; the screen offers a Refresh button
 * rather than spending a model call on every page load.
 */
myLeadsRouter.get(
  '/:id/brief',
  asyncHandler(async (req: Request, res: Response) => {
    const opportunityId = String(req.params.id);
    await assertLeadIsVisible(req, opportunityId);
    const brief = await leadBrief(opportunityId);
    if (!brief) throw notFound('That lead no longer exists.');
    res.json(brief);
  }),
);

/** Re-read the notes. Rate-limited, because each one is a model call. */
myLeadsRouter.post(
  '/:id/brief',
  rateLimit({ windowMs: 60_000, max: 10, keyFor: (req: Request) => `brief:${currentUser(req).id}` }),
  asyncHandler(async (req: Request, res: Response) => {
    const opportunityId = String(req.params.id);
    await assertLeadIsVisible(req, opportunityId);
    const digest = await refreshNotesDigest(opportunityId, { force: true });
    const brief = await leadBrief(opportunityId);
    res.json({ ...brief, refreshed: digest !== null });
  }),
);

/* ── Moving several leads at once ─────────────────────────────────────── */

const moveSchema = z.object({
  moves: z.array(z.object({
    id: z.string().min(1).max(36),
    /* Null is Incoming — the free-leads queue any agent can claim from. */
    toUserId: z.string().min(1).max(36).nullable(),
  })).min(1).max(MOVE_LIMIT),
});

/**
 * The "Move N leads" panel's own endpoint.
 *
 * One request for the whole batch, and it answers with where every lead came
 * from — which is what makes the design's Undo possible: the browser sends
 * the inverse list straight back here.
 *
 * Manager and up. An agent cannot give their leads away from this screen;
 * that is what a transfer request is for, and it has its own rules.
 */
myLeadsRouter.post(
  '/move',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    /* Stated as who may rather than who may not: an accountant is not an
       agent either, and the scope below would hand them an empty result
       instead of a plain no. */
    if (!isManagerOrAbove(user.role)) {
      throw badRequest('Only a manager or an owner can move leads. Ask for a transfer instead.');
    }
    const body = moveSchema.parse(req.body);
    const visible = await visibleUserIds(user);
    res.json(await moveLeads(actorFrom(req), visible, body.moves));
  }),
);

/**
 * Every id behind the filters, for "Select all 863".
 *
 * The design's bar offers to select the whole list rather than the page, and
 * a move needs the ids to do it. Capped at the same number one press may
 * move, so the screen can say plainly when the list is larger than that
 * instead of half-moving it.
 */
myLeadsRouter.get(
  '/ids',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const params = listSchema.parse(req.query);
    const tab: LeadTab = isLeadTab(params.tab) ? params.tab : 'all';
    const visible = await visibleUserIds(user);
    const { where, args } = buildFilters(params, visible);
    const definition = TABS[tab];

    const rows = await query<{ id: string }>(
      `SELECT o.id FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
        WHERE ${[definition.where, ...where].join(' AND ')}
        ORDER BY ${definition.orderBy}
        LIMIT ${MOVE_LIMIT}`,
      args,
    );
    res.json({ ids: rows.map((one) => one.id), limit: MOVE_LIMIT });
  }),
);

/* ── "What the client wants": click a line to edit ────────────────────── */

const wantsSchema = z.object({
  project: z.string().max(160).nullable().optional(),
  unit: z.string().max(64).nullable().optional(),
  /* Free text, on purpose: an agent writes "2M", "1.5–2M" or "needs a
     mortgage first", and `parseBudget` reads a figure out of it where there
     is one and keeps their words where there is not. */
  budget: z.string().max(120).nullable().optional(),
  purpose: z.enum(PURPOSES).optional(),
  timeline: z.enum(TIMELINES).optional(),
  payment: z.enum(PAYMENTS).optional(),
  language: z.string().max(12).nullable().optional(),
});

/**
 * The seven lines in the right-hand column, which the design makes editable
 * in place and the build had read-only.
 *
 * The three enum lines are offered as choices the column can actually hold —
 * `WANT_CHOICES` is sent to the screen rather than written there twice, so a
 * choice on the page is never one the database will refuse.
 */
myLeadsRouter.patch(
  '/:id/wants',
  asyncHandler(async (req: Request, res: Response) => {
    const opportunityId = String(req.params.id);
    await assertLeadIsVisible(req, opportunityId);
    const parsed = wantsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('That is not something this lead can say.', parsed.error.issues);
    }
    const result = await updateWants(actorFrom(req), opportunityId, parsed.data);
    res.json({
      ...result,
      said: result.changed.length === 0
        ? 'Nothing changed.'
        : `${result.changed.join(', ')} changed`,
    });
  }),
);

/** What the choices are, for the three lines that are not free text. */
myLeadsRouter.get(
  '/wants/choices',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(WANT_CHOICES);
  }),
);

/**
 * The change history on the Info tab — "Rocky changed Budget · 1.5M → 2M".
 *
 * `audit_log` has held every one of these rows since the first week; there
 * was simply no endpoint that served one record's history.
 */
myLeadsRouter.get(
  '/:id/history',
  asyncHandler(async (req: Request, res: Response) => {
    const opportunityId = String(req.params.id);
    await assertLeadIsVisible(req, opportunityId);
    res.json({ items: await fieldHistory(opportunityId) });
  }),
);

/**
 * Who has had this lead — the owner's "two dates".
 *
 * The first hand-out with its date, and every move since with the date and
 * who it came from. `opportunities.assigned_at` only holds the current
 * holder's date, so the second date can only come from `lead_assignments`;
 * `leads/handovers.ts` says which table is the truth and why.
 *
 * Fenced by the same `assertLeadIsVisible` as everything else on this screen,
 * so an agent can read the history of their own leads and of nobody else's.
 * Registered above `/:id`, like `/:id/history` — Express matches in
 * declaration order.
 */
myLeadsRouter.get(
  '/:id/handover',
  asyncHandler(async (req: Request, res: Response) => {
    const opportunityId = String(req.params.id);
    await assertLeadIsVisible(req, opportunityId);
    res.json({ items: await handoverChain(opportunityId) });
  }),
);

/* ── Files ─────────────────────────────────────────────────────────────── */

/**
 * The Files tab.
 *
 * Files live on a note, which is the right place for them — a photo keeps the
 * words that came with it — but the lead page needs them as one list with
 * folders over it, which is what `note_files.contact_id` was put there for.
 */
myLeadsRouter.get(
  '/:id/files',
  asyncHandler(async (req: Request, res: Response) => {
    const opportunityId = String(req.params.id);
    await assertLeadIsVisible(req, opportunityId);
    const lead = await queryOne<{ contact_id: string }>(
      'SELECT contact_id FROM opportunities WHERE id = ? AND deleted_at IS NULL',
      [opportunityId],
    );
    if (!lead) throw notFound('That lead no longer exists.');

    const items = await filesForContact(lead.contact_id);
    res.json({
      items,
      folders: FILE_FOLDERS.map((key) => ({
        key,
        label: FOLDER_LABELS[key],
        count: items.filter((one) => one.folder === key).length,
      })),
    });
  }),
);

/**
 * Adding a file from the Files tab: "+ Photo", "+ Booking form",
 * "+ ID or passport".
 *
 * A file has to hang off a note, so one is written for it saying where it
 * came from. That keeps the file in the timeline as well as in the folder,
 * and means nothing on this lead is a file nobody can account for.
 *
 * The bytes go up through `POST /api/notes/item/:noteId/files`, which already
 * knows the size limit, the allowed types and how to put a file on disk. This
 * endpoint makes the note and hands the id back.
 */
const fileNoteSchema = z.object({
  folder: z.enum(FILE_FOLDERS),
  filename: z.string().max(255).optional(),
});

myLeadsRouter.post(
  '/:id/files/note',
  asyncHandler(async (req: Request, res: Response) => {
    const opportunityId = String(req.params.id);
    await assertLeadIsVisible(req, opportunityId);
    const body = fileNoteSchema.parse(req.body);
    const lead = await queryOne<{ contact_id: string }>(
      'SELECT contact_id FROM opportunities WHERE id = ? AND deleted_at IS NULL',
      [opportunityId],
    );
    if (!lead) throw notFound('That lead no longer exists.');

    const folder = isFileFolder(body.folder) ? body.folder : 'other';
    const note = await addNote(actorFrom(req), {
      contactId: lead.contact_id,
      opportunityId,
      type: 'general',
      body: [FOLDER_LABELS[folder], body.filename].filter(Boolean).join(' · '),
    });
    res.status(201).json({ noteId: note.id, folder });
  }),
);

/**
 * One lead, and everything the lead page shows about it.
 *
 * Registered after `/counts` and the other named paths, so `:id` cannot
 * swallow them -- Express matches in the order routes are declared, and a
 * `/:id` placed above `/counts` would make the counts endpoint unreachable
 * for ever, silently.
 *
 * It answers with the opportunity and the contact's full record together,
 * because the page needs both and two requests for one screen is two chances
 * for half of it to arrive.
 */
myLeadsRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const opportunityId = String(req.params.id);
    await assertLeadIsVisible(req, opportunityId);

    const lead = await queryOne<Record<string, unknown>>(
      `${SELECT} WHERE o.id = ? AND o.deleted_at IS NULL`,
      [opportunityId],
    );
    if (!lead) throw notFound('That lead no longer exists.');

    const detail = await contact360(String(lead.contact_id));
    res.json({ lead, ...detail });
  }),
);

/**
 * The same fence as everything else on this screen, in one place: an agent can
 * only reach their own leads, a manager their team's.
 */
async function assertLeadIsVisible(req: Request, opportunityId: string): Promise<void> {
  const visible = await visibleUserIds(currentUser(req));
  const scope = ownerPredicate('o.owner_user_id', visible);
  const allowed = await queryOne<{ id: string }>(
    `SELECT o.id FROM opportunities o WHERE o.id = ? AND o.deleted_at IS NULL AND ${scope.sql}`,
    [opportunityId, ...scope.params],
  );
  if (!allowed) throw badRequest('That lead is not yours to work.');
}
