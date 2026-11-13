import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../design/index.js';
import { useToast } from '../../design/ui.js';
import { SettingsShell, SettingsTitle } from './Shell.js';

/**
 * Settings → Phone app.
 *
 * From `design/web/install-guide.html`. It is a page of instructions, which
 * is unusual for this CRM, and it earns its place: an agent whose phone is
 * not set up hears nothing, and the five-minute rule then only works while
 * they happen to have the CRM open on a laptop.
 *
 * The iPhone steps are the fiddly ones and the design is right to spell them
 * out — on iOS only Safari can install a web app, and an agent who tries it
 * in Chrome will not find the option and will conclude the CRM is broken.
 */

const IPHONE = [
  {
    icon: 'globe' as const,
    title: 'Open the CRM in Safari',
    note: 'Only Safari can install the app on an iPhone. Chrome cannot — the option is simply not there.',
  },
  {
    icon: 'upload' as const,
    title: 'Tap the Share button',
    note: 'The square with the arrow coming out of it, at the bottom of Safari.',
  },
  {
    icon: 'plus' as const,
    title: 'Tap "Add to Home Screen"',
    note: 'Scroll down the list if you do not see it, then tap Add.',
  },
  {
    icon: 'building' as const,
    title: 'Open homes.me from the home screen',
    note: 'Not from Safari. Sign in with your work email.',
  },
  {
    icon: 'bell' as const,
    title: 'Tap "Turn on notifications", then Allow',
    note: 'The card is at the top of My Day.',
  },
];

const ANDROID = [
  {
    icon: 'globe' as const,
    title: 'Open the CRM in Chrome',
    note: 'Sign in with your work email.',
  },
  {
    icon: 'download' as const,
    title: 'Tap the ⋮ menu, then "Install app"',
    note: 'On some phones it says "Add to Home screen" instead.',
  },
  {
    icon: 'building' as const,
    title: 'Open homes.me from the home screen',
    note: 'It opens like a normal app, with no address bar.',
  },
  {
    icon: 'bell' as const,
    title: 'Tap "Turn on notifications", then Allow',
    note: 'The card is at the top of My Day.',
  },
];

export function V2SettingsPhoneApp() {
  const [phone, setPhone] = useState<'iphone' | 'android'>('iphone');
  const toast = useToast();

  /* Whether this browser can be asked at all. On a desktop the answer is
     usually yes and it is still not the point — the phone is. */
  const canAsk = typeof Notification !== 'undefined';
  const state = canAsk ? Notification.permission : 'unsupported';

  const steps = phone === 'iphone' ? IPHONE : ANDROID;

  return (
    <SettingsShell page="p-install">
      <div className="d-set-body">
        <SettingsTitle
          title="Phone app"
          note="Put the CRM on your phone and turn on alerts. It takes two minutes."
        />

        <section className="d-card d-ig-top">
          <div className="d-grow">
            <h2>Open the CRM on your phone</h2>
            <p className="d-muted d-mt-4">
              Type the same address you use here into your phone&apos;s browser, then follow the
              steps below.
            </p>
            <div className="d-seg d-mt-16" role="group" aria-label="Which phone">
              <button type="button" className={phone === 'iphone' ? 'd-on' : undefined} onClick={() => setPhone('iphone')}>
                <Icon name="smartphone" />iPhone
              </button>
              <button type="button" className={phone === 'android' ? 'd-on' : undefined} onClick={() => setPhone('android')}>
                <Icon name="smartphone" />Android
              </button>
            </div>
          </div>
          <div className="d-ig-state">
            <span className={state === 'granted' ? 'd-chip d-green d-pip d-lg' : 'd-chip d-lg'}>
              {state === 'granted'
                ? 'Alerts are on, on this computer'
                : state === 'denied'
                  ? 'Alerts are blocked on this computer'
                  : 'Alerts are not on yet here'}
            </span>
            <span className="d-small d-muted">Your phone is the one that matters</span>
          </div>
        </section>

        <div className="d-ig-cols">
          <section className="d-card">
            <div className="d-card-head">
              <h3>{phone === 'iphone' ? 'iPhone' : 'Android'} · {steps.length} steps</h3>
              <span className={phone === 'iphone' ? 'd-chip d-amber' : 'd-chip'}>
                {phone === 'iphone' ? 'Safari only' : 'Chrome'}
              </span>
            </div>
            <div className="d-ig-steps">
              {steps.map((step, i) => (
                <div className="d-ig-step" key={step.title}>
                  <span className="d-n">{i + 1}</span>
                  <span className="d-card-icon"><Icon name={step.icon} /></span>
                  <div className="d-grow">
                    <b>{step.title}</b>
                    <span>{step.note}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="d-small d-muted d-mt-12">
              {phone === 'iphone'
                ? 'An older iPhone? Open Settings → General → Software Update first.'
                : 'No alerts afterwards? Open phone Settings → Apps → homes.me → Notifications and allow them.'}
            </p>
          </section>

          <div className="d-col d-gap-16">
            <section className="d-card d-ig-phone">
              <h4>What you will see</h4>
              <div className="d-ig-n">
                <span className="d-ic d-accent"><Icon name="crown" /></span>
                <div className="d-grow">
                  <b>VIP lead</b>
                  <span>Call within 30 minutes, or it goes back</span>
                </div>
                <em>now</em>
              </div>
              <div className="d-ig-n">
                <span className="d-ic"><Icon name="clock" /></span>
                <div className="d-grow">
                  <b>Follow-up is due</b>
                  <span>At the time you planned it</span>
                </div>
                <em>11:00</em>
              </div>
              <div className="d-ig-n">
                <span className="d-ic d-blue"><Icon name="calendar-days" /></span>
                <div className="d-grow">
                  <b>Site visit in 2 hours</b>
                  <span>And again fifteen minutes before</span>
                </div>
                <em>14:30</em>
              </div>
            </section>

            <section className="d-card">
              <div className="d-row d-gap-12">
                <span className="d-card-icon d-accent"><Icon name="bell" /></span>
                <div className="d-grow">
                  <b className="d-bold">Alerts on this computer</b>
                  <div className="d-small d-muted">
                    Optional. Your phone is the main place.
                  </div>
                </div>
              </div>
              <div className="d-btn-row d-mt-16">
                <button
                  type="button"
                  className="d-btn d-primary"
                  disabled={!canAsk || state === 'granted'}
                  onClick={async () => {
                    if (!canAsk) return;
                    const answer = await Notification.requestPermission();
                    toast(answer === 'granted'
                      ? 'This computer will show alerts'
                      : 'This computer stays silent. Your phone still gets alerts.');
                  }}
                >
                  <Icon name="bell" />
                  {state === 'granted' ? 'Already on' : 'Turn on alerts here'}
                </button>
                <Link className="d-btn" to="/v2/settings/notifications">Choose my alerts</Link>
              </div>
              {state === 'denied' && (
                <div className="d-card-foot">
                  Blocked in this browser. Click the padlock beside the address and allow
                  notifications.
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </SettingsShell>
  );
}
