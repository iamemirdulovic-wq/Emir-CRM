import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.js';
import { usePushDevice } from '../../lib/push-device.js';
import { Icon } from '../../design/index.js';
import { Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { SettingsRow, SettingsShell, SettingsSwitch, SettingsTitle } from './Shell.js';
import { usePhoneHead } from '../phone.js';
import type { Notify, NotifyGroup, TestPush } from './notify.js';

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
  /* What the server said the last time "Send a test" was pressed. Null until
     it is — never a default of "test sent just now", which is what the old
     screen showed whether or not anything had been sent. */
  const [tested, setTested] = useState<TestPush | null>(null);
  const [testing, setTesting] = useState(false);
  const device = usePushDevice();
  const toast = useToast();

  useEffect(() => { if (got.data) setDraft(got.data); }, [got.data]);

  /**
   * Press the button, say what the server said.
   *
   * No claim is made here at all: `say` is written on the server beside the
   * send, where the outcome is actually known. "It works" is one of six
   * answers and it is the only one the server writes when a device accepted
   * it — see `server/src/v2/test-push.ts`.
   */
  async function sendTest() {
    setTesting(true);
    try {
      const result = await api.post<TestPush>('/api/v2/notifications/test');
      setTested(result);
      toast(result.say);
      /* A rejected token was just deleted on the server, and the heading
         counts devices, so re-read rather than leave a stale count. */
      if (result.outcome === 'token-rejected') got.reload();
    } catch (err) {
      setTested(null);
      toast(err instanceof Error ? err.message : 'The test could not be sent. Try again.');
    } finally {
      setTesting(false);
    }
  }

  /** Register or unregister the device this screen is open on. */
  async function toggleDevice() {
    const { state, said } = await device.toggle();
    toast(said);
    /* The server now knows about one more or one fewer device, and the
       heading is counting them. */
    if (state === 'on' || state === 'off') got.reload();
  }


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

        {/* The heading is the server's sentence, not a claim this screen
            makes. It used to read "Notifications are on" whatever was true —
            with no Firebase key set, with no device ever registered — which
            is half of what cost the owner an hour on 15 Nov. The other half
            was the button below it. */}
        <section className="d-card v2-ntf-top">
          <span
            className={draft.alerts.state === 'ok'
              ? 'd-card-icon d-accent v2-ntf-mark'
              : 'd-card-icon v2-ntf-mark'}
          >
            <Icon name={draft.alerts.state === 'ok' ? 'bell' : 'bell-off'} />
          </span>
          <div className="d-grow">
            <h2>{draft.alerts.say}</h2>
            <p className="d-small d-muted d-mt-4">
              {tested ? tested.say : restingLine(draft)}
              {(tested ? tested.to : draft.alerts.to) && (
                <>
                  {' '}
                  <Link
                    className="v2-ntf-go"
                    to={(tested ? tested.to : draft.alerts.to) ?? '/v2/home'}
                  >
                    Open My Day
                  </Link>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="d-btn d-primary"
            disabled={testing}
            onClick={() => void sendTest()}
          >
            <Icon name="bell" />
            {testing ? 'Sending…' : 'Send a test'}
          </button>
        </section>

        <section className="d-card">
          <div className="d-card-head"><h4>Where alerts go</h4></div>
          <div>
            <div className="d-switch-row v2-ntf-device" style={{ paddingTop: 0 }}>
              <span className="d-card-icon"><Icon name="smartphone" /></span>
              <div className="d-txt">
                <b>Phone app</b>
                <span>The main place. Works when the CRM is closed.</span>
              </div>
              {/* The design draws a status chip here ("On · iPhone") and the
                  build had none, so the row said nothing about whether this
                  device was registered. It is read from the browser and the
                  server every time, never from a saved preference. */}
              <span className={chipFor(device.look.tone)}>{device.look.label}</span>
              <Link className="d-btn d-sm" to="/v2/settings/phone-app">How to install</Link>
              {/* The switch that was missing entirely. Until 15 Nov the only
                  thing in the whole of v2 that could register a device was
                  the "Turn on notifications" card on My Day — and one "not
                  now" hid that for good, which left an owner with no way to
                  turn alerts on anywhere. */}
              <label className="d-switch">
                <input
                  type="checkbox"
                  checked={device.look.on}
                  disabled={!device.look.canToggle || device.busy}
                  aria-label="Get alerts on the device I am using now"
                  onChange={() => void toggleDevice()}
                />
                <span className="d-track" />
              </label>
              {/* A line break for the phone, and nothing at all on a
                  computer. Four controls do not fit across 390px, and
                  squeezing them wraps "The main place" one syllable a line.
                  A zero-height item with a full-width basis is how flexbox
                  is made to break where you want it. */}
              <span className="v2-ntf-break" aria-hidden="true" />
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
          {/* Why the phone switch is the way it is, under both rows rather
              than between them — a line in the middle takes the top border
              off the row beneath it. */}
          {deviceFoot(device.look, device.said) && (
            <div className="d-card-foot">{deviceFoot(device.look, device.said)}</div>
          )}
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
 * The line under the heading when nobody has pressed the test button yet.
 *
 * It says what is true now. The old screen printed "Phone app and this
 * computer" in every case, including the case where no phone had ever been
 * registered and no key was set — the two cases where nothing at all could
 * arrive.
 */
function restingLine(draft: Notify): string {
  switch (draft.alerts.state) {
    case 'no-key':
      return 'The Firebase values are not on the server yet. Alerts still wait for you in '
        + 'the bell inside the CRM, and nothing is lost — they just cannot reach a closed app.';
    case 'no-device':
      return 'Tap "Turn on notifications" at the top of My Day, on the phone you want the '
        + 'alerts on.';
    default:
      return draft.computer ? 'Phone app and this computer' : 'Phone app only';
  }
}

/** The design's status chip, in the colour the state deserves. */
function chipFor(tone: 'ok' | 'warn' | 'plain'): string {
  if (tone === 'ok') return 'd-chip d-green d-pip';
  if (tone === 'warn') return 'd-chip d-amber';
  return 'd-chip';
}

/**
 * The line under the two rows: what the device switch cannot do, and why.
 *
 * `said` wins once the switch has been pressed, because the answer to what
 * just happened matters more than the standing explanation.
 */
function deviceFoot(look: { label: string; needsInstallFirst: boolean; canToggle: boolean },
  said: string | null): string | null {
  if (said) return said;
  if (look.needsInstallFirst) {
    return 'On an iPhone, alerts only work once the CRM is on the home screen. A Safari tab '
      + 'gets none at all — that is Apple’s rule, not ours.';
  }
  if (look.label === 'Blocked in your phone settings') {
    return 'This device is refusing alerts for homes.me and only you can undo it — the CRM '
      + 'cannot ask again. iPhone: Settings, Notifications, homes.me. Android: hold the app '
      + 'icon, App info, Notifications.';
  }
  if (look.label === 'Not set up yet') {
    return 'The Firebase values are not on the server yet, so no device can be registered.';
  }
  if (look.label === 'Not possible in this browser') {
    return 'This browser cannot show notifications at all. Use the CRM on a phone, or in '
      + 'Chrome, Edge or Firefox.';
  }
  if (!look.canToggle) return null;
  return 'The switch turns alerts on for the device you are using right now. Do it again on '
    + 'each phone or computer you want them on.';
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
