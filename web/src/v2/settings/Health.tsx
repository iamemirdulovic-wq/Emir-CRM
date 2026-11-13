import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { Icon, type IconName } from '../../design/index.js';
import { Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { SettingsShell, SettingsTitle } from './Shell.js';

/**
 * Settings → System health.
 *
 * From `design/web/system-health.html`, with one honest difference: the
 * design draws a thirty-day bar per service and a timeline of past
 * incidents. **Nothing records uptime history**, so those bars would be
 * decoration — drawn green because nobody is counting. They are left out and
 * the screen says what it does check instead.
 *
 * What it does check is real and is the point: each of these fails silently
 * and separately. Email answers "SMTP is not configured" inside a
 * conversation nobody is reading. WhatsApp follow-ups never send because no
 * template was approved, so the workflows show zero runs and look idle rather
 * than blocked. Push has no devices registered, so the five-minute rule only
 * works while somebody has the CRM open.
 */

interface Service {
  key: string;
  title: string;
  consequence: string;
  ready: boolean;
  to: string;
}

interface Health {
  services: Service[];
  outstanding: number;
  website: {
    configured: boolean;
    lastLeadAt: string | null;
    leadsLast7Days: number;
  };
  push: {
    configured: boolean;
    agentsWithoutDevice: number;
    agentsTotal: number;
    missing: string[];
  };
}

const ICONS: Record<string, IconName> = {
  email: 'mail',
  whatsapp: 'message-circle',
  push: 'bell',
  ai: 'sparkles',
  attendance: 'pin',
};

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

  const { services, outstanding, push, website } = got.data;
  const fine = services.length - outstanding;
  const allFine = outstanding === 0;

  return (
    <SettingsShell page="p-health">
      <div className="d-set-body">
        <SettingsTitle
          title="System health"
          note="What is connected, and what is quietly doing nothing."
        />

        <section className="d-card d-hl-top">
          <span className={allFine ? 'd-hl-big' : 'd-hl-big v2-hl-warn'}>
            <Icon name={allFine ? 'check' : 'alert-triangle'} />
          </span>
          <div className="d-grow">
            <h2>{fine} of {services.length} services are set up</h2>
            <p className="d-muted d-mt-4">
              {allFine
                ? 'Everything that can reach a client is connected.'
                : 'What is not set up does not fail loudly — it just never happens.'}
            </p>
          </div>
          <button
            type="button"
            className="d-btn d-primary"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              got.reload();
              window.setTimeout(() => { setChecking(false); toast('Checked just now'); }, 600);
            }}
          >
            <Icon name="refresh-cw" />{checking ? 'Checking…' : 'Check now'}
          </button>
        </section>

        <section className="d-card">
          <div className="d-card-head">
            <h3>Services</h3>
            <span className="d-small d-muted">Read from where the features read</span>
          </div>
          <div className="d-divide">
            {services.map((one) => (
              <div className="d-hl-row" key={one.key}>
                <span className="d-card-icon"><Icon name={ICONS[one.key] ?? 'shield'} /></span>
                <div className="d-hl-name">
                  <b>{one.title}</b>
                  <span>{one.consequence}</span>
                </div>
                <span className="d-grow" />
                {one.ready
                  ? <span className="d-chip d-green d-pip">Connected</span>
                  : (
                    <>
                      <Link className="d-btn d-xs" to={one.to}>Set it up</Link>
                      <span className="d-chip d-amber d-pip">Not set up</span>
                    </>
                  )}
              </div>
            ))}
          </div>
        </section>

        {/* Push needs two things and the checklist only counts one. A server
            with credentials and nobody's phone registered sends nothing. */}
        {push.agentsWithoutDevice > 0 && (
          <section className="d-card">
            <div className="d-card-head"><h3>Who will not hear an alert</h3></div>
            <div className="d-banner d-amber">
              <Icon name="alert-triangle" />
              <span className="d-grow">
                <b>{push.agentsWithoutDevice} of {push.agentsTotal} have no phone registered.</b>{' '}
                A VIP lead given to one of them can run out of time with nobody hearing a thing.
              </span>
            </div>
            {push.missing.length > 0 && (
              <p className="d-small d-muted d-mt-12">
                {push.missing.join(' · ')}
                {push.agentsWithoutDevice > push.missing.length
                  ? ` and ${push.agentsWithoutDevice - push.missing.length} more`
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
              <b>{website.configured ? 'Yes' : 'No key set'}</b>
            </div>
            <div>
              <span className="d-grow">Leads in the last 7 days</span>
              <b>{website.leadsLast7Days}</b>
            </div>
            <div>
              <span className="d-grow">Last one</span>
              <b>{website.lastLeadAt ? ago(website.lastLeadAt) : 'None yet'}</b>
            </div>
          </div>
          {website.configured && website.leadsLast7Days === 0 && (
            <div className="d-card-foot">
              Connected but silent for a week. Worth checking the form on the website itself.
            </div>
          )}
        </section>

        <div className="d-banner">
          <Icon name="info" />
          <span className="d-grow">
            Nothing here records history yet, so there are no uptime bars and no list of past
            problems. What you see is true right now, checked when you open the page.
          </span>
        </div>

        <div className="d-row">
          <span className="d-small d-muted d-grow">
            Something else wrong? Send it as a report marked “It stops me working”.
          </span>
          <Link className="d-btn" to="/v2/feedback">
            <Icon name="message-square" />Report a problem
          </Link>
        </div>
      </div>
    </SettingsShell>
  );
}

function ago(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / (60 * 24))} days ago`;
}
