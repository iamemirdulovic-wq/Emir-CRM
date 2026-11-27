import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { Icon, type IconName } from '../../design/index.js';
import { Spinner, ErrorNote } from '../../design/ui.js';
import { SettingsShell, SettingsTitle } from './Shell.js';
import '../../styles/v2-integrations.css';

/**
 * Settings → Connections.
 *
 * Emir asked for this on 27 November, the day he connected Meta: nothing on
 * any screen told him whether it had worked. The CRM had been recording the
 * answer all along — `inbound_events` holds every webhook that ever arrived
 * and `conversion_events` everything we ever sent back — and no screen read
 * either table.
 *
 * The rule the page is built on is the one System health learned the hard
 * way: **a key being set is not the same as a thing working.** So a row that
 * is switched on but has never done anything says exactly that, in amber,
 * instead of showing a green tick and letting somebody find out in a month.
 * Every number is counted from rows that really exist.
 */

type State = 'live' | 'quiet' | 'failing' | 'off';

interface Row {
  key: string;
  group: string;
  title: string;
  what: string;
  state: State;
  detail: string;
  todo: string | null;
}

const WORD: Record<State, string> = {
  live: 'Working',
  quiet: 'Nothing yet',
  failing: 'Not working',
  off: 'Not connected',
};

const CHIP: Record<State, string> = {
  live: 'd-green',
  quiet: 'd-amber',
  failing: 'd-red',
  off: '',
};

const ICONS: Record<string, IconName> = {
  meta_lead_ads: 'megaphone',
  whatsapp_in: 'message-circle',
  website: 'globe',
  google_forms: 'search',
  property_investment: 'building',
  meta_capi: 'trending-up',
  google_offline: 'trending-up',
  email: 'mail',
  push: 'bell',
  homes_ai: 'sparkles',
};

export function V2SettingsIntegrations() {
  const got = useAsync<{ items: Row[] }>(() => api.get('/api/v2/integrations'), []);

  if (got.error) {
    return (
      <SettingsShell page="p-integrations">
        <div className="d-set-body"><ErrorNote>{got.error}</ErrorNote></div>
      </SettingsShell>
    );
  }
  if (!got.data) {
    return (
      <SettingsShell page="p-integrations">
        <div className="d-set-body"><Spinner /></div>
      </SettingsShell>
    );
  }

  const rows = got.data.items;
  const groups = [...new Set(rows.map((one) => one.group))];
  const working = rows.filter((one) => one.state === 'live');
  const broken = rows.filter((one) => one.state === 'failing');
  const quiet = rows.filter((one) => one.state === 'quiet');

  return (
    <SettingsShell page="p-integrations">
      <div className="d-set-body">
        <SettingsTitle
          title="Connections"
          note="What the CRM is plugged into, and whether anything is coming through."
        />

        <section className="d-card v2-int-top">
          <span className={`v2-int-big${broken.length === 0 ? ' v2-int-big-ok' : ' v2-int-big-bad'}`}>
            <Icon name={broken.length === 0 ? 'check' : 'alert-triangle'} />
          </span>
          <div className="d-grow">
            <h2>
              {broken.length > 0
                ? `${broken.length} connection${broken.length === 1 ? ' is' : 's are'} not working`
                : `${working.length} of ${rows.length} connections working`}
            </h2>
            <p>
              {broken.length > 0
                ? broken.map((one) => one.title).join(', ')
                : quiet.length > 0
                  ? `${quiet.length} switched on but nothing has come through yet.`
                  : 'Everything that is switched on has something coming through it.'}
            </p>
          </div>
        </section>

        <p className="d-small d-muted v2-int-rule">
          A connection only counts as working when something has actually arrived
          or been sent through it. Having the key is not the same thing.
        </p>

        {groups.map((group) => (
          <section className="d-card v2-int-group" key={group}>
            <h3>{group}</h3>
            <div className="v2-int-list">
              {rows.filter((one) => one.group === group).map((one) => (
                <div className={`v2-int-row v2-int-is-${one.state}`} key={one.key}>
                  <span className="v2-int-ico"><Icon name={ICONS[one.key] ?? 'link'} /></span>
                  <div className="d-grow">
                    <div className="v2-int-head">
                      <b>{one.title}</b>
                      <span className={`d-chip d-pip ${CHIP[one.state]}`}>{WORD[one.state]}</span>
                    </div>
                    <p className="v2-int-what">{one.what}</p>
                    <p className="v2-int-detail">{one.detail}</p>
                    {one.todo && (
                      <p className="v2-int-todo">
                        <Icon name="arrow-right" />
                        <span>{one.todo}</span>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <p className="d-small d-muted v2-int-foot">
          Keys and tokens live in the hosting settings. They are never shown on this page.
        </p>
      </div>
    </SettingsShell>
  );
}
