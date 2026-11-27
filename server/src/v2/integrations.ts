/**
 * What this CRM is connected to, and whether it is actually working.
 *
 * Emir asked for this on 27 November, straight after connecting Meta: he had
 * no way to see whether anything was flowing. The CRM has recorded all of it
 * from the start — `inbound_events` holds every webhook that arrived,
 * `conversion_events` every report we sent back — and no screen ever read
 * either table.
 *
 * The rule here is the one System health learned the hard way: **a key being
 * present is not the same as a thing working.** So every row carries two
 * separate facts — whether it is switched on, and when it last actually did
 * something — and a row that is switched on but silent says so rather than
 * showing a green tick.
 */
import { env } from '../config/env.js';
import { secret } from '../config/secrets.js';
import { getPool, query, queryOne, type Executor } from '../db/client.js';

export type IntegrationState = 'live' | 'quiet' | 'failing' | 'off';

export interface Integration {
  key: string;
  /** Group heading on the page. */
  group: 'Leads coming in' | 'Reporting back' | 'Talking to clients' | 'The assistant';
  title: string;
  /** One line, in words, of what it does for the business. */
  what: string;
  state: IntegrationState;
  /** What is true right now. Never a guess. */
  detail: string;
  /** What to do about it, when there is something to do. */
  todo: string | null;
}

const DAY = 24 * 60 * 60 * 1000;

function ago(at: Date | null): string | null {
  if (!at) return null;
  const mins = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} hours ago`;
  const days = Math.round(mins / (60 * 24));
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** The last thing that arrived from one source, and how many this week. */
async function inbound(source: string, exec: Executor) {
  const row = await queryOne<{ last_at: Date | null; week: number }>(
    `SELECT MAX(received_at) AS last_at,
            SUM(received_at >= DATE_SUB(NOW(3), INTERVAL 7 DAY)) AS week
       FROM inbound_events WHERE source = ?`,
    [source],
    exec,
  );
  return { lastAt: row?.last_at ?? null, week: Number(row?.week ?? 0) };
}

/**
 * One source of leads, read the same way every time.
 *
 * "Switched on but nothing for two weeks" is the state worth naming: it is
 * what a broken Meta webhook looks like, and it is indistinguishable from
 * working if all a screen checks is whether the key is set.
 */
function fromInbound(
  base: Omit<Integration, 'state' | 'detail' | 'todo'>,
  on: boolean,
  seen: { lastAt: Date | null; week: number },
  offTodo: string,
): Integration {
  if (!on) {
    return { ...base, state: 'off', detail: 'Not connected yet', todo: offTodo };
  }
  if (!seen.lastAt) {
    return {
      ...base,
      state: 'quiet',
      detail: 'Connected, but nothing has ever arrived',
      todo: 'Send one test lead through to prove the connection works.',
    };
  }
  const quiet = Date.now() - new Date(seen.lastAt).getTime() > 14 * DAY;
  return {
    ...base,
    state: quiet ? 'quiet' : 'live',
    detail: `${seen.week} this week · last one ${ago(seen.lastAt)}`,
    todo: quiet ? 'Nothing for two weeks. Check the connection is still live at their end.' : null,
  };
}

/**
 * Meta's half of the loop, which is the one Emir paid for.
 *
 * A refusal beats the test-mode notice on purpose: a wrong token in test mode
 * is still a wrong token, and a screen that says "TEST MODE" over the top of
 * it would hide the one thing worth knowing.
 */
function metaCapi(
  on: boolean,
  back: { sent: number; failed: number; lastAt: Date | null; error: string | null },
  testing: boolean,
): Pick<Integration, 'state' | 'detail' | 'todo'> {
  if (!on) {
    return {
      state: 'off',
      detail: 'Not connected yet',
      todo: 'Add META_DATASET_ID and META_CAPI_ACCESS_TOKEN in your hosting settings.',
    };
  }
  if (back.failed > 0 && back.failed >= back.sent) {
    return {
      state: 'failing',
      detail: `${back.failed} refused by Meta in 30 days · ${back.error ?? 'no reason given'}`,
      todo: 'Meta is refusing these. Usually the token expired or the dataset id is wrong.',
    };
  }
  if (testing) {
    return {
      state: 'quiet',
      detail: back.sent > 0
        ? `TEST MODE · ${back.sent} sent to Meta's test window in 30 days`
        : 'TEST MODE · nothing sent yet',
      todo: 'Events only land in Events Manager → Test events and do not count. '
        + 'When the test looks right, remove META_CAPI_TEST_EVENT_CODE and redeploy.',
    };
  }
  if (back.sent === 0) {
    return {
      state: 'quiet',
      detail: 'Connected, but nothing reported yet',
      todo: 'Move one lead to Attempted and check Events Manager → Test events.',
    };
  }
  return {
    state: 'live',
    detail: `${back.sent} reported in 30 days · last ${ago(back.lastAt)}`
      + (back.failed > 0 ? ` · ${back.failed} refused` : ''),
    todo: back.failed > 0 ? `Some were refused: ${back.error ?? ''}` : null,
  };
}

/**
 * Meta said it delivered. Did a lead actually land?
 *
 * Arriving and landing are two different things here, done by two different
 * credentials, and only the first one leaves a mark that `inbound_events`
 * can see. A row that counts arrivals alone is the exact mistake this whole
 * page was built to stop, one level further in.
 */
function metaForms(
  row: Integration,
  stuck: { n: number; error: string | null; lastAt: Date | null },
  hasToken: boolean,
): Integration {
  if (row.state === 'off') return row;
  if (stuck.n > 0) {
    return {
      ...row,
      state: 'failing',
      detail: `${stuck.n} lead${stuck.n === 1 ? '' : 's'} arrived in 7 days but could not be read`
        + ` \u00b7 ${stuck.error ?? 'no reason given'}`,
      todo: 'Meta delivered these and the CRM could not fetch the answers, so they are '
        + 'not in your leads. Usually the page access token expired.',
    };
  }
  if (!hasToken) {
    return {
      ...row,
      state: 'failing',
      detail: 'No Meta access token \u00b7 nothing can be read even when Meta delivers',
      todo: 'Add META_SYSTEM_USER_TOKEN (or META_PAGE_ACCESS_TOKEN) in your hosting '
        + 'settings, or every lead Meta sends is lost.',
    };
  }
  return row;
}

export async function integrations(exec: Executor = getPool()): Promise<Integration[]> {
  const cfg = env();

  const [meta, whats, web, google, pi] = await Promise.all([
    inbound('meta_lead_ads', exec),
    inbound('whatsapp', exec),
    inbound('website', exec),
    inbound('google_ads', exec),
    inbound('property_investment', exec),
  ]);

  /* What we have reported back, and whether Meta accepted it. */
  const sentBack = await query<{ destination: string; status: string; n: number; last_at: Date | null; error: string | null }>(
    `SELECT destination, status, COUNT(*) AS n, MAX(sent_at) AS last_at,
            SUBSTRING_INDEX(GROUP_CONCAT(error ORDER BY sent_at DESC SEPARATOR '|~|'), '|~|', 1) AS error
       FROM conversion_events
      WHERE created_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY)
      GROUP BY destination, status`,
    [],
    exec,
  );
  const backTo = (where: string) => {
    const rows = sentBack.filter((one) => one.destination === where);
    const sent = rows.find((one) => one.status === 'sent');
    const failed = rows.find((one) => one.status === 'failed');
    return {
      sent: Number(sent?.n ?? 0),
      failed: Number(failed?.n ?? 0),
      lastAt: sent?.last_at ?? null,
      error: failed?.error ?? null,
    };
  };
  const toMeta = backTo('meta');
  const toGoogle = backTo('google');

  /*
   * The Meta webhook carries only ids. The answers are fetched afterwards by
   * a `meta.fetch_lead` job, with a different token from the one that signs
   * the webhook. So Meta can be delivering perfectly while every lead dies in
   * that job, and the webhook's own count says "working" the whole time.
   *
   * Jasser asked the right question before a launch -- "are you sure leads
   * are going to the CRM?" -- and nothing on any screen could answer it. This
   * is the answer: the job's own failures, in Meta's own words.
   */
  const stuck = await queryOne<{ n: number; last_error: string | null; last_at: Date | null }>(
    `SELECT COUNT(*) AS n,
            SUBSTRING_INDEX(GROUP_CONCAT(last_error ORDER BY updated_at DESC SEPARATOR '|~|'), '|~|', 1) AS last_error,
            MAX(updated_at) AS last_at
       FROM jobs
      WHERE type = 'meta.fetch_lead' AND status = 'failed'
        AND updated_at >= DATE_SUB(NOW(3), INTERVAL 7 DAY)`,
    [],
    exec,
  ).then((row) => ({
    n: Number(row?.n ?? 0),
    error: row?.last_error ?? null,
    lastAt: row?.last_at ?? null,
  }));

  const capiOn = Boolean(cfg.META_DATASET_ID && cfg.META_CAPI_ACCESS_TOKEN);
  const fcm = Boolean(cfg.FCM_PROJECT_ID && cfg.FCM_CLIENT_EMAIL);
  const phones = await queryOne<{ registered: number; people: number }>(
    `SELECT (SELECT COUNT(DISTINCT user_id) FROM push_tokens) AS registered,
            (SELECT COUNT(*) FROM users WHERE is_active = 1) AS people`,
    [],
    exec,
  ).then((row) => ({
    registered: Number(row?.registered ?? 0),
    people: Number(row?.people ?? 0),
  }));
  const aiKey = Boolean(await secret('CLAUDE_API_KEY', exec).catch(() => null));

  const rows: Integration[] = [
    metaForms(
      fromInbound(
        {
          key: 'meta_lead_ads',
          group: 'Leads coming in',
          title: 'Facebook & Instagram lead forms',
          what: 'A person fills in your ad form and lands here within seconds.',
        },
        Boolean(cfg.META_APP_SECRET),
        meta,
        'Add META_APP_SECRET and the page token, then point the webhook at this CRM.',
      ),
      stuck,
      Boolean(cfg.META_SYSTEM_USER_TOKEN ?? cfg.META_PAGE_ACCESS_TOKEN),
    ),
    fromInbound(
      {
        key: 'whatsapp_in',
        group: 'Leads coming in',
        title: 'WhatsApp',
        what: 'Messages and click-to-WhatsApp ads become leads and conversations.',
      },
      Boolean(cfg.WHATSAPP_ACCESS_TOKEN),
      whats,
      'Connect the WhatsApp Business API in Settings.',
    ),
    fromInbound(
      {
        key: 'website',
        group: 'Leads coming in',
        title: 'Your website forms',
        what: 'Anyone who fills a form on your site becomes a lead here.',
      },
      Boolean(cfg.WEBSITE_FORM_HMAC_SECRET),
      web,
      'Add the website form secret and put the form code on your site.',
    ),
    fromInbound(
      {
        key: 'google_forms',
        group: 'Leads coming in',
        title: 'Google lead forms',
        what: 'Lead forms on Google Ads arrive here too.',
      },
      Boolean(cfg.GOOGLE_LEAD_FORM_KEY),
      google,
      'Add GOOGLE_LEAD_FORM_KEY and set the same key in Google Ads.',
    ),
    fromInbound(
      {
        key: 'property_investment',
        group: 'Leads coming in',
        title: 'property-investment.ae',
        what: 'Their leads come in, and your stage changes go back to them.',
      },
      Boolean(await secret('PROPERTY_INVESTMENT_HMAC_SECRET', exec).catch(() => null)),
      pi,
      'Add the shared secret they gave you.',
    ),

    /* Reporting back: this is the half that is worth money and the half
       nobody can see without a screen like this one. */
    {
      key: 'meta_capi',
      group: 'Reporting back',
      title: 'Facebook Conversions API',
      what: 'Tells Meta which leads turned into real buyers, so the ads find more of them.',
      ...metaCapi(capiOn, toMeta, Boolean(cfg.META_CAPI_TEST_EVENT_CODE)),
    },
    {
      key: 'google_offline',
      group: 'Reporting back',
      title: 'Google offline conversions',
      what: 'The same thing for Google Ads: which clicks became real deals.',
      state: cfg.GOOGLE_ADS_DEVELOPER_TOKEN
        ? (toGoogle.sent > 0 ? 'live' : 'quiet')
        : 'off',
      detail: cfg.GOOGLE_ADS_DEVELOPER_TOKEN
        ? (toGoogle.sent > 0
          ? `${toGoogle.sent} reported in 30 days · last ${ago(toGoogle.lastAt)}`
          : 'Connected, but nothing reported yet')
        : 'Not connected yet',
      todo: cfg.GOOGLE_ADS_DEVELOPER_TOKEN ? null : 'Needs a Google Ads developer token.',
    },

    {
      key: 'email',
      group: 'Talking to clients',
      title: 'Email',
      what: 'Sends from your own address, and replies come back into the inbox.',
      state: cfg.SMTP_HOST ? 'live' : 'off',
      detail: cfg.SMTP_HOST ? `Sending through ${cfg.SMTP_HOST}` : 'Not connected yet',
      todo: cfg.SMTP_HOST ? null : 'Add your SMTP details in Settings.',
    },
    {
      key: 'push',
      group: 'Talking to clients',
      title: 'Phone alerts',
      what: 'A new lead buzzes the agent’s phone within seconds.',
      /* Firebase being connected is not the same as anybody being reachable:
         for most of this build the keys were set and one phone in fourteen
         had ever registered, so the alerts went nowhere and nothing said so. */
      ...(() => {
        if (!fcm) {
          return {
            state: 'off' as const,
            detail: 'Not connected yet',
            todo: 'Add the Firebase keys in your hosting settings.',
          };
        }
        if (phones.registered === 0) {
          return {
            state: 'quiet' as const,
            detail: `Firebase connected · no phone has registered yet`,
            todo: 'Nobody will be buzzed. Each person opens the CRM on their '
              + 'phone and allows notifications once.',
          };
        }
        const thin = phones.registered * 2 < phones.people;
        return {
          state: thin ? ('quiet' as const) : ('live' as const),
          detail: `${phones.registered} of ${phones.people} people have a phone registered`,
          todo: thin
            ? 'Most of the team will not be buzzed. They each need to open the '
              + 'CRM on their phone once and allow notifications.'
            : null,
        };
      })(),
    },
    {
      key: 'homes_ai',
      group: 'The assistant',
      title: 'Homes AI',
      what: 'Answers questions about your own leads, and writes messages for your agents.',
      state: aiKey ? 'live' : 'off',
      detail: aiKey ? 'Claude connected' : 'Not connected yet',
      todo: aiKey ? null : 'Add the Claude API key in Settings → Homes AI.',
    },
  ];

  return rows;
}
