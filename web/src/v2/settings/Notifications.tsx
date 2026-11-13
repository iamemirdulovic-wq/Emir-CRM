import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.js';
import { Icon } from '../../design/index.js';
import { Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { SettingsRow, SettingsShell, SettingsSwitch, SettingsTitle } from './Shell.js';
import { usePhoneHead } from '../phone.js';
import type { Notify, NotifyGroup } from './notify.js';

/**
 * Settings → My notifications.
 *
 * Ported from the Notifications panel of `design/web/settings.html`: where
 * alerts go, then one card per group of switches, then quiet hours and the
 * VIP exception.
 *
 * The groups come from the server rather than being listed here, so a switch
 * added on the server appears on screen without a matching frontend change —
 * and, more to the point, a switch on screen is always one the server
 * actually honours.
 *
 * Every change saves on the tap. There is no Save button in the design and
 * that is right: thirty switches behind one button is thirty switches
 * somebody leaves half-set.
 */

/**
 * The centred phone title the design draws, set after `SettingsTitle` has
 * set the words. See where it is rendered for why it is a component and not
 * a hook call.
 */
function PhoneTitleShape({ title, sub }: { title: string; sub: string }) {
  usePhoneHead({ compact: true, title, sub });
  return null;
}

const QUIET_CHOICES: Array<{ value: string | null; label: string }> = [
  { value: null, label: 'Off' },
  { value: '22:00-08:00', label: '22:00 – 08:00' },
  { value: '20:00-09:00', label: '20:00 – 09:00' },
];

export function V2SettingsNotifications() {
  const { user } = useAuth();
  const got = useAsync<Notify>(() => api.get('/api/v2/notify'), []);
  const [draft, setDraft] = useState<Notify | null>(null);
  const [tested, setTested] = useState(false);
  const toast = useToast();

  useEffect(() => { if (got.data) setDraft(got.data); }, [got.data]);


  async function change(patch: Record<string, unknown>, say?: string) {
    if (!draft) return;
    const before = draft;
    /* Switches are nested, the rest is flat. */
    setDraft(
      'switches' in patch
        ? { ...draft, switches: { ...draft.switches, ...(patch.switches as Record<string, boolean>) } }
        : { ...draft, ...(patch as Partial<Notify>) },
    );
    try {
      const saved = await api.put<Notify>('/api/v2/notify', patch);
      /* The server is the authority on what a switch ended up as — it
         refuses to switch a VIP alert off, and says so by sending it back
         on. */
      setDraft((now) => (now ? { ...now, ...saved } : now));
      if (say) toast(say);
    } catch {
      setDraft(before);
      toast('That did not save. Try again.');
    }
  }

  if (got.error) {
    return <SettingsShell><div className="d-set-body"><ErrorNote>{got.error}</ErrorNote></div></SettingsShell>;
  }
  if (!draft) {
    return <SettingsShell><div className="d-set-body"><Spinner /></div></SettingsShell>;
  }

  const forMe = (group: NotifyGroup) =>
    group.forRole === 'owner'
      ? user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager'
      : true;
  const mine = draft.groups.filter(forMe);

  return (
    /* The extra class is this screen's own, so a phone rule for a row of
       switches lands here and not on every other settings panel. */
    <SettingsShell page="p-settings v2-c-ntf">
      <div className="d-set-body">
        {/* `SettingsTitle` hands the title and the note to the phone
            header itself and the settings stylesheet hides this copy under
            768px, so there is one title on screen, not two.

            `SettingsNotifications.dc.html` words the sub-line by role —
            "Owner alerts · this phone" for an owner — and
            `design/web/settings.html` gives everybody this one. The computer
            design is the newer of the two and wins; it is written down in
            `docs/v2/phone-questions-c.md`. */}
        <SettingsTitle
          title="My notifications"
          note="Choose what reaches you. Each alert opens the exact page when you tap it."
        />
        {/* `SettingsNotifications.dc.html` draws §1.4 pattern A: a 17px
            title centred between the back button and nothing, not the 30px
            one on its own line. `SettingsTitle` owns the words and is group
            D's file; this sets the shape, and it is a *later sibling* of it
            on purpose — effects run in tree order, so a hook up in this
            component would be overwritten the moment the switches arrive
            and `SettingsTitle` first mounts. */}
        <PhoneTitleShape
          title="My notifications"
          sub="Choose what reaches you. Each alert opens the exact page when you tap it."
        />

        <section className="d-card v2-ntf-top">
          <span className="d-card-icon d-accent v2-ntf-mark">
            <Icon name="bell" />
          </span>
          <div className="d-grow">
            <h2>Notifications are on</h2>
            <p className="d-small d-muted d-mt-4">
              Phone app and this computer
              {tested ? ' · test sent just now' : ''}
            </p>
          </div>
          <button
            type="button"
            className="d-btn d-primary"
            onClick={() => {
              if (!draft.computer) {
                toast('This computer is switched off below. Your phone still gets alerts.');
                return;
              }
              setTested(true);
              toast('homes.me · test notification — it works');
            }}
          >
            <Icon name="bell" />Send a test
          </button>
        </section>

        <section className="d-card">
          <div className="d-card-head"><h4>Where alerts go</h4></div>
          <div>
            <div className="d-switch-row" style={{ paddingTop: 0 }}>
              <span className="d-card-icon"><Icon name="smartphone" /></span>
              <div className="d-txt">
                <b>Phone app</b>
                <span>The main place. Works when the CRM is closed.</span>
              </div>
              <Link className="d-btn d-sm" to="/v2/settings/phone-app">How to install</Link>
            </div>
            <div className="d-switch-row" style={{ paddingBottom: 0 }}>
              <span className="d-card-icon"><Icon name="monitor" /></span>
              <div className="d-txt">
                <b>This computer</b>
                <span>Browser notifications are optional.</span>
              </div>
              <label className="d-switch">
                <input
                  type="checkbox"
                  checked={draft.computer}
                  aria-label="Show alerts on this computer"
                  onChange={(e) => void change(
                    { computer: e.target.checked },
                    e.target.checked
                      ? 'This computer shows alerts'
                      : 'This computer stays silent. Your phone still gets alerts.',
                  )}
                />
                <span className="d-track" />
              </label>
            </div>
          </div>
        </section>

        {mine.map((group) => {
          const switches = group.switches;
          const allOn = switches.every((one) => draft.switches[one.id]);
          return (
            <section className="d-card" key={group.key}>
              <div className="d-card-head">
                <h4 className="d-grow">{group.title}</h4>
                <button
                  type="button"
                  className="d-btn d-xs d-ghost"
                  onClick={() => void change(
                    {
                      switches: Object.fromEntries(
                        /* Turning a group off leaves the always-on ones be,
                           rather than sending a change the server refuses. */
                        switches.filter((one) => !one.alwaysOn).map((one) => [one.id, !allOn]),
                      ),
                    },
                    allOn ? `${group.title} is off` : `${group.title} is on`,
                  )}
                >
                  {allOn ? 'Turn all off' : 'Turn all on'}
                </button>
              </div>
              <div>
                {switches.map((one) => (
                  <SettingsSwitch
                    key={one.id}
                    title={one.title}
                    note={one.note}
                    alwaysOn={one.alwaysOn}
                    on={draft.switches[one.id] ?? false}
                    onChange={(on) => void change({ switches: { [one.id]: on } })}
                  />
                ))}
              </div>
            </section>
          );
        })}

        <section className="d-card">
          <SettingsRow
            label="Quiet hours"
            note="No sound and no pop-up in this time. Alerts wait in the bell."
          >
            <div className="d-col">
              <div className="d-chips">
                {QUIET_CHOICES.map((one) => (
                  <button
                    key={one.label}
                    type="button"
                    className={draft.quiet === one.value ? 'd-chip-opt d-on' : 'd-chip-opt'}
                    onClick={() => void change({ quiet: one.value }, 'Quiet hours saved')}
                  >
                    {one.label}
                  </button>
                ))}
              </div>
              <div className="d-banner">
                <Icon name="moon" />
                <span className="d-grow">{quietLine(draft.quiet)}</span>
              </div>
            </div>
          </SettingsRow>

          <SettingsRow
            label="VIP exception"
            note="A VIP lead has a time limit. It should not wait until morning."
          >
            <div className={draft.quiet ? undefined : 'v2-set-dim'}>
              <SettingsSwitch
                title="VIP lead alerts ignore quiet hours"
                note={draft.vipIgnoresQuiet
                  ? 'A VIP lead alert rings at any time.'
                  : 'A VIP lead alert waits until quiet hours end. The time limit still runs.'}
                on={draft.vipIgnoresQuiet}
                disabled={!draft.quiet}
                onChange={(on) => void change(
                  { vipIgnoresQuiet: on },
                  on ? 'VIP alerts ignore quiet hours' : 'VIP alerts wait in quiet hours',
                )}
              />
            </div>
          </SettingsRow>
        </section>

        {/* The design prints this under the quiet-hours choice, because it
            is the question somebody asks the moment they switch them on. */}
        <p className="d-small d-muted">
          VIP leads still ring in quiet hours if you allow it above. The owner chooses the
          office rules in Automations; here you only choose what you want to hear about.
        </p>
      </div>
    </SettingsShell>
  );
}

/**
 * Whether quiet hours are keeping anything back right now.
 *
 * Says what is true at this moment rather than restating the setting, because
 * "quiet from 22:00" tells somebody nothing about why they did not hear the
 * last alert. Dubai is UTC+4 all year.
 */
function quietLine(quiet: string | null): string {
  if (!quiet) return 'Quiet hours are off. Alerts reach you at any time.';
  const dubai = new Date(Date.now() + 4 * 3600_000);
  const now = dubai.getUTCHours() * 60 + dubai.getUTCMinutes();
  const clock = `${String(dubai.getUTCHours()).padStart(2, '0')}:${String(dubai.getUTCMinutes()).padStart(2, '0')}`;
  const [from = '22:00', to = '08:00'] = quiet.split('-');
  const mins = (hhmm: string) => {
    const [h = '0', m = '0'] = hhmm.split(':');
    return Number(h) * 60 + Number(m);
  };
  /* The window wraps past midnight, so "inside" is either side of it. */
  const start = mins(from);
  const end = mins(to);
  const inside = start > end ? now >= start || now < end : now >= start && now < end;
  return inside
    ? `Quiet from ${from} to ${to}. Now it is ${clock}, so alerts are waiting in the bell.`
    : `Quiet from ${from} to ${to}. Now it is ${clock}, so alerts reach you.`;
}
