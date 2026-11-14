import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { Icon, type IconName } from '../../design/index.js';
import { Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { SettingsShell, SettingsTitle } from './Shell.js';
import '../../styles/v2-schema-card.css';

/**
 * Settings → System health.
 *
 * Built from `design/web/system-health.html`: the big status, six services
 * each with thirty days of history, a response time and a status chip, then
 * what to do about whatever is not green, and a timeline of past problems.
 *
 * Those bars are the part that had to be earned. They used to be left out,
 * because **nothing recorded uptime** — thirty green rectangles drawn because
 * nobody was counting is worse than no bars at all. Now a job measures all six
 * every five minutes and writes a row (`server/src/v2/health-checks.ts`,
 * `service_checks`), so a bar is a day that was actually sampled, a grey bar
 * is a day nobody checked, and the percentage in the tooltip is arithmetic on
 * real rows. On the first morning after a deploy there is no history, and the
 * page says so rather than looking perfect.
 *
 * **No key or secret ever appears here.** The server returns whether one is
 * set and, for the AI, what the month cost. Never a value, never a hint.
 */

type State = 'ok' | 'slow' | 'down';

interface Service {
  key: string;
  title: string;
  about: string;
  to: string;
  plural?: boolean;
  state: State;
  ms: number | null;
  note: string | null;
  checkedAt: string | null;
  days: Array<{ date: string; state: State | null }>;
  upPercent: number | null;
  samples: number;
}

interface Incident {
  service: string;
  title: string;
  state: State;
  detail: string | null;
  from: string;
  to: string | null;
  open: boolean;
}

interface Health {
  services: Service[];
  outstanding: number;
  fine: number;
  checkedAt: string | null;
  incidents: Incident[];
  neverChecked: boolean;
  days: number;
  setup: Array<{ key: string; title: string; consequence: string; ready: boolean; to: string }>;
  setupOutstanding: number;
  website: { configured: boolean; lastLeadAt: string | null; leadsLast7Days: number };
  push: { configured: boolean; agentsWithoutDevice: number; agentsTotal: number; missing: string[] };
  /* Optional, so an older server that does not send it renders nothing
     rather than throwing on the screen that exists to diagnose it. */
  schema?: {
    boot: { startedAt: string; applied: string[]; error: string | null; ok: boolean };
    appliedCount: number;
    pending: string[];
    lastApplied: string | null;
  };
}

const ICONS: Record<string, IconName> = {
  site: 'globe',
  database: 'list',
  notifications: 'bell',
  links: 'link',
  storage: 'files',
  ai: 'sparkles',
  email: 'mail',
  whatsapp: 'message-circle',
  push: 'bell',
  attendance: 'pin',
};

const WORD: Record<State, string> = { ok: 'Fine', slow: 'Slow', down: 'Not working' };

/**
 * The database's own state, in words the owner can read and quote back.
 *
 * Built on 14 Nov, after the calendar returned "Internal server error" on the
 * live site for days. The reason -- a migration that failed on every single
 * boot, and so blocked every migration queued behind it -- was written only
 * to a server log that neither the owner nor I can reach. It was diagnosed by
 * reasoning three times and got wrong twice.
 *
 * Four facts end that: when this server started (so a deploy can be seen to
 * have landed), how many changes the database has, which ones are stuck, and
 * the database's own words for why.
 */
function SchemaCard({ schema }: { schema: Health['schema'] }) {
  if (!schema) return null;
  const stuck = schema.pending.length > 0;
  const started = new Date(schema.boot.startedAt);
  const ago = Math.max(0, Math.round((Date.now() - started.getTime()) / 60000));
  return (
    <section className={`d-card v2-schema${stuck ? ' v2-schema-stuck' : ''}`}>
      <h3>
        <Icon name={stuck ? 'alert-triangle' : 'list'} />
        {stuck ? 'The database is behind the CRM' : 'The database is up to date'}
      </h3>
      <p className="v2-schema-when">
        This server started {ago < 1 ? 'less than a minute' : `${ago} minute${ago === 1 ? '' : 's'}`} ago
        {' · '}{schema.appliedCount} change{schema.appliedCount === 1 ? '' : 's'} applied
      </p>
      {stuck && (
        <>
          <p className="v2-schema-stuckline">
            {schema.pending.length} change{schema.pending.length === 1 ? ' is' : 's are'} stuck.
            Everything after the first one waits for it, so screens that need
            them will say &quot;Internal server error&quot; until it is fixed.
          </p>
          <ul className="v2-schema-list">
            {schema.pending.map((name) => <li key={name}>{name}</li>)}
          </ul>
        </>
      )}
      {schema.boot.error && (
        <p className="v2-schema-why">
          <strong>What the database said:</strong> {schema.boot.error}
        </p>
      )}
      {!stuck && !schema.boot.error && schema.boot.applied.length > 0 && (
        <p className="v2-schema-when">
          Applied on this start: {schema.boot.applied.join(', ')}
        </p>
      )}
    </section>
  );
}

export function V2SettingsHealth() {
  const got = useAsync<Health>(() => api.get('/api/v2/health'), []);
  const [checking, setChecking] = useState(false);
  const toast = useToast();

  if (got.error) {
    return <SettingsShell page="p-health"><div className="d-set-body"><ErrorNote>{got.error}</ErrorNote></div></SettingsShell>;
  }
  if (!got.data) {
    return <SettingsShell page="p-health"><div className="d-set-body"><Spinner /></div></SettingsShell>;
  }

  const health = got.data;
  const allFine = health.outstanding === 0;
  const worst = health.services.find((one) => one.state === 'down')
    ?? health.services.find((one) => one.state === 'slow');

  async function runCheck() {
    setChecking(true);
    try {
      await api.post('/api/v2/health/check');
      got.reload();
      toast(health.services.length === health.fine
        ? `Check finished · all ${health.services.length} services are fine`
        : 'Check finished');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'The check did not run.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <SettingsShell page="p-health">
      <div className="d-set-body">
        <SettingsTitle
          title="System health"
          note="Is everything working? Checked by itself every 5 minutes."
        />

        <SchemaCard schema={health.schema} />

        <section className="d-card d-hl-top">
          <span className={[
            'd-hl-big',
            allFine ? 'd-ok' : '',
            checking ? 'd-run' : '',
          ].join(' ').trim()}>
            <Icon name={checking ? 'refresh-cw' : 'check'} />
          </span>
          <div className="d-grow">
            <h2>
              {checking
                ? `Checking ${health.services.length} services…`
                : allFine
                  ? `All ${health.services.length} services are fine`
                  : `${health.fine} of ${health.services.length} services are fine`}
            </h2>
            <p className="d-muted d-mt-4">
              {checking ? 'This takes a few seconds.' : (
                <>
                  {worst ? `${verb(worst)}. ${worst.note ?? ''} ` : 'Everything that can reach a client is answering. '}
                  {health.checkedAt
                    ? `Last check ${clock(health.checkedAt)}.`
                    : 'Nothing has been checked yet.'}
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="d-btn d-primary"
            disabled={checking}
            onClick={() => void runCheck()}
          >
            <Icon name="refresh-cw" />{checking ? 'Checking…' : 'Run a check now'}
          </button>
        </section>

        <section className="d-card">
          <div className="d-card-head">
            <h3>Services</h3>
            <span className="d-small d-muted">Bars: last {health.days} days</span>
          </div>
          <div className="d-divide">
            {health.services.map((one) => (
              <div className={checking ? 'd-hl-row d-checking' : 'd-hl-row'} key={one.key}>
                <span className="d-card-icon"><Icon name={ICONS[one.key] ?? 'shield'} /></span>
                <div className="d-hl-name">
                  <b>{one.title}</b>
                  <span>{[one.about, one.note].filter(Boolean).join(' · ')}</span>
                </div>
                {/* One bar per day. Grey is a day with no sample, which on a
                    freshly deployed server is most of them. */}
                <div
                  className="d-hl-strip"
                  title={one.upPercent === null
                    ? `Last ${health.days} days · nothing recorded yet`
                    : `Last ${health.days} days · ${one.upPercent}% up · ${one.samples} checks`}
                >
                  {one.days.map((day) => (
                    <i key={day.date} className={barClass(day.state)} />
                  ))}
                </div>
                <span className="d-hl-ms">
                  {checking ? '' : one.ms === null ? '' : one.ms >= 1000
                    ? `${(one.ms / 1000).toFixed(1)} s`
                    : `${one.ms} ms`}
                </span>
                {checking
                  ? <span className="d-chip d-hl-chip">Checking…</span>
                  : (
                    <span className={`d-chip d-pip d-hl-chip ${
                      one.state === 'ok' ? 'd-green' : one.state === 'slow' ? 'd-amber' : 'd-red'}`}
                    >
                      {WORD[one.state]}
                    </span>
                  )}
              </div>
            ))}
          </div>
          {health.neverChecked && (
            <div className="d-card-foot">
              No check has run yet, so the bars are empty. One runs every five minutes from now,
              or press “Run a check now”.
            </div>
          )}
        </section>

        {/* ── what to do ─────────────────────────────────────────────── */}
        <section className="d-card">
          <div className="d-card-head"><h3>What to do</h3></div>

          {worst ? (
            <div className={worst.state === 'down' ? 'd-banner d-red' : 'd-banner d-amber'}>
              <Icon name="alert-triangle" />
              <span className="d-grow">
                <b>
                  {verb(worst)}
                  {worst.checkedAt ? ` since ${clock(worst.checkedAt)}` : ''}.
                </b>{' '}
                {advice(worst)}
              </span>
              <Link className="d-btn d-xs" to={worst.to}>{action(worst.key)}</Link>
            </div>
          ) : (
            <div className="d-banner d-green">
              <Icon name="check" />
              <span className="d-grow">
                <b>Nothing to do.</b> Every service answered on the last check.
              </span>
            </div>
          )}

          {/* Still-off things that are not one of the six: email sending and
              an approved WhatsApp template are not services this page can
              measure, they are set-up steps nobody has done. */}
          {health.setupOutstanding > 0 && (
            <div className="d-mini-list d-mt-16">
              {health.setup.filter((one) => !one.ready).map((one) => (
                <div key={one.key}>
                  <span className="d-grow">
                    <b>{one.title}</b> — {one.consequence}
                  </span>
                  <span className="d-chip d-amber d-pip">Not set up</span>
                </div>
              ))}
            </div>
          )}

          {health.incidents.length > 0 ? (
            <div className="d-timeline d-mt-16">
              {health.incidents.map((one) => (
                <div className="d-tl-item" key={`${one.service}-${one.from}`}>
                  <span className={`d-tl-dot ${one.state === 'down' ? 'd-red' : one.open ? '' : 'd-green'}`}>
                    <Icon name={one.state === 'down' ? 'x' : one.open ? 'alert-triangle' : 'check'} />
                  </span>
                  <div className="d-tl-body">
                    <b>{one.title}</b>
                    <p>{one.detail ?? 'No detail was recorded.'}</p>
                    <span className="d-tl-time">
                      {stamp(one.from)}
                      {one.to ? ` – ${clock(one.to)} · closed` : ' · still open'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="d-small d-muted d-mt-16">
              No problem has been recorded in the last {health.days} days.
            </p>
          )}

        </section>

        {/* Push needs two things and the service check only knows one of them
            as a number: a server with credentials and nobody's phone
            registered sends nothing, and these are the names to go and ask. */}
        {health.push.agentsWithoutDevice > 0 && (
          <section className="d-card">
            <div className="d-card-head"><h3>Who will not hear an alert</h3></div>
            <div className="d-banner d-amber">
              <Icon name="alert-triangle" />
              <span className="d-grow">
                <b>{health.push.agentsWithoutDevice} of {health.push.agentsTotal} have no phone
                registered.</b>{' '}
                A VIP lead given to one of them can run out of time with nobody hearing a thing.
              </span>
            </div>
            {health.push.missing.length > 0 && (
              <p className="d-small d-muted d-mt-12">
                {health.push.missing.join(' · ')}
                {health.push.agentsWithoutDevice > health.push.missing.length
                  ? ` and ${health.push.agentsWithoutDevice - health.push.missing.length} more`
                  : ''}
              </p>
            )}
            <div className="d-card-foot">
              Each person turns alerts on for themselves. You can only remind them.
            </div>
          </section>
        )}

        <section className="d-card">
          <div className="d-card-head"><h3>The website form</h3></div>
          <div className="d-mini-list">
            <div>
              <span className="d-grow">Connected</span>
              <b>{health.website.configured ? 'Yes' : 'No key set'}</b>
            </div>
            <div>
              <span className="d-grow">Leads in the last 7 days</span>
              <b>{health.website.leadsLast7Days}</b>
            </div>
            <div>
              <span className="d-grow">Last one</span>
              <b>{health.website.lastLeadAt ? ago(health.website.lastLeadAt) : 'None yet'}</b>
            </div>
          </div>
          {health.website.configured && health.website.leadsLast7Days === 0 && (
            <div className="d-card-foot">
              Connected but silent for a week. Worth checking the form on the website itself.
            </div>
          )}
        </section>

        <div className="d-row">
          <span className="d-small d-muted d-grow">
            Something else is wrong? Tell us with a bug report marked “Blocking my work”.
          </span>
          <Link className="d-btn" to="/v2/feedback">
            <Icon name="message-square" />Report a problem
          </Link>
        </div>
      </div>
    </SettingsShell>
  );
}

/**
 * "Notifications are slow", "File storage is not working".
 *
 * The design writes "are" for the two service names that are plural, and a
 * page that tells the owner of the company "Notifications is slow" reads as
 * carelessly as it sounds.
 */
function verb(service: Service): string {
  const be = service.plural ? 'are' : 'is';
  return `${service.title} ${be} ${service.state === 'down' ? 'not working' : 'slow'}`;
}

/** The class on one day's bar. Nothing recorded is grey, not green. */
function barClass(state: State | null): string {
  if (state === null) return 'v2-hl-none';
  if (state === 'down') return 'd-bad';
  if (state === 'slow') return 'd-warn';
  return 'd-ok';
}

/** What an owner can do about this service being down, in plain words. */
function advice(service: Service): string {
  switch (service.key) {
    case 'notifications':
      return 'A VIP lead alert can come late or not at all. Phone the agent when you give a VIP '
        + 'lead, until this is green again.';
    case 'ai':
      return 'Every Homes AI answer comes back as an error, for everybody.';
    case 'storage':
      return 'Brochures, IDs and booking forms cannot be uploaded. Nothing already saved is lost.';
    case 'database':
      return 'Leads, notes and history cannot be read or written. Nobody can work.';
    case 'links':
      return 'A client opening a brochure link is not recorded, so nobody is told.';
    default:
      return 'Press “Run a check now” to see whether it has come back.';
  }
}

function action(key: string): string {
  if (key === 'notifications') return 'Who has notifications on';
  if (key === 'ai') return 'Open Homes AI';
  return 'Look at it';
}

/** 24-hour, Dubai. The CRM is one office in one timezone. */
function clock(at: string): string {
  const dubai = new Date(new Date(at).getTime() + 4 * 3600_000);
  return `${String(dubai.getUTCHours()).padStart(2, '0')}:${String(dubai.getUTCMinutes()).padStart(2, '0')}`;
}

/** "Today 14:20" or "Thu 29 Oct 11:05". */
function stamp(at: string): string {
  const when = new Date(at);
  const dubaiToday = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
  const dubaiThen = new Date(when.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
  if (dubaiThen === dubaiToday) return `Today ${clock(at)}`;
  const date = when.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai',
  });
  return `${date} ${clock(at)}`;
}

function ago(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / (60 * 24))} days ago`;
}
