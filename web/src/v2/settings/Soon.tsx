import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../design/index.js';
import { SettingsShell, SettingsTitle } from './Shell.js';

/**
 * A settings page in the design that has nothing behind it yet.
 *
 * Shown inside the real shell with the real nav, so the section list matches
 * `design/web/settings.html` and clicking one of these is not a dead link.
 * It says plainly that it is not built, and where the nearest thing that does
 * work lives — which is more use than an empty page with a spinner.
 */
export function SettingsSoon({
  title, note, icon, what, insteadTo, insteadLabel,
}: {
  title: string;
  note: string;
  icon: IconName;
  /** What this page will do, in the owner's words. */
  what: string[];
  insteadTo?: string;
  insteadLabel?: string;
}) {
  return (
    <SettingsShell>
      <div className="d-set-body">
        <SettingsTitle title={title} note={note} />
        <section className="d-card">
          <div className="d-card-head">
            <h3>Not built yet</h3>
            <span className="d-chip d-amber">coming</span>
          </div>
          <div className="d-row d-gap-16 d-top">
            <span className="d-card-icon"><Icon name={icon} /></span>
            <div className="d-grow">
              <p className="d-small d-muted">This page is in the design and will do this:</p>
              <ul className="v2-soon-list">
                {what.map((one) => <li key={one}>{one}</li>)}
              </ul>
              {insteadTo && insteadLabel && (
                <p className="d-small d-muted d-mt-12">
                  Until then: <Link className="d-link" to={insteadTo}>{insteadLabel}</Link>
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </SettingsShell>
  );
}

export const V2SettingsTeam = () => (
  <SettingsSoon
    title="Team and roles"
    note="Who can sign in, what they can do, and who gets alerts."
    icon="users"
    what={[
      'Everyone, with their role and when they last signed in',
      'Change a role, invite somebody, deactivate somebody',
      'Who has notifications on, and a reminder for who does not',
      'What each role can and cannot do, as a table',
    ]}
    insteadTo="/settings/users"
    insteadLabel="the older people and roles screen, which works"
  />
);

export const V2SettingsHealth = () => (
  <SettingsSoon
    title="System health"
    note="Whether the parts that reach a client are actually working."
    icon="shield"
    what={[
      'WhatsApp, email, push, Meta and Google: connected or not',
      'What has failed to send, and why',
      'When each one last did something',
    ]}
    insteadTo="/settings/integrations"
    insteadLabel="the older integrations screen, which shows the same keys"
  />
);

export const V2SettingsPhoneApp = () => (
  <SettingsSoon
    title="Phone app"
    note="How to put the CRM on a phone, so alerts arrive when it is closed."
    icon="smartphone"
    what={[
      'Step-by-step for iPhone and for Android',
      'How to allow notifications, with the screen each person will see',
      'A check that says whether this phone is set up',
    ]}
    insteadTo="/install"
    insteadLabel="the older install guide"
  />
);
