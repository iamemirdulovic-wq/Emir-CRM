import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { Icon } from '../../design/index.js';
import { ErrorNote, useToast } from '../../design/ui.js';
import { SettingsShell, SettingsTitle } from './Shell.js';
import { usePhoneHead } from '../phone.js';

/**
 * Sign-in and security — `design/screens/Security.dc.html`, and the
 * "Security" tab of `design/web/profile.html`.
 *
 * The audit found two dead links reaching this screen and no screen behind
 * them, so **an agent in v2 could not change their own password.** That is
 * what this is for, and it is the one thing on the design's page the server
 * really does.
 *
 * Three things the designs draw are deliberately **not** built, because
 * nothing behind them exists and a control that silently does nothing is
 * worse than none. All three are written up in
 * `docs/v2/phone-questions-c.md`:
 *
 *  - **The signed-in device list.** `listSessionsForUser()` exists in
 *    `server/src/auth/sessions.ts` and no endpoint serves it to the person
 *    whose sessions they are; `/api/activity/sessions` is the owner's
 *    team-wide sign-in log and needs `reports:team`.
 *  - **"Sign out of all other devices"** as a button of its own. There is no
 *    endpoint for it. Changing the password does exactly that, which is said
 *    here in words instead.
 *  - **Two-step sign-in.** There is no second factor anywhere in this build —
 *    CLAUDE.md's LOGIN section is email and password only, "no OTP". So the
 *    block states that rather than offering a switch.
 */

/** The centred phone title, set after `SettingsTitle` has set the words. */
function PhoneTitleShape({ title, sub }: { title: string; sub: string }) {
  usePhoneHead({ compact: true, title, sub });
  return null;
}

export function V2SettingsSecurity() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function change() {
    if (!current) { setProblem('Write your password.'); return; }
    if (next.length < 8) { setProblem('At least 8 letters or numbers.'); return; }
    if (next !== again) { setProblem('Write the new password again.'); return; }
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/api/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      });
      setCurrent('');
      setNext('');
      setAgain('');
      toast('Password changed · other devices are signed out');
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const leave = () => {
    void signOut().then(() => navigate('/login', { replace: true }));
  };

  return (
    <SettingsShell>
      <div className="d-set-body">
        {/* `SettingsTitle` hands the title and the note to the phone header
            and the settings stylesheet hides this copy under 768px, so the
            words are the design's own and there is only ever one of them. */}
        <SettingsTitle
          title="Security"
          note="Password and signed-in devices"
        />
        {/* `Security.dc.html` draws §1.4 pattern A — the 17px title centred
            between the back button and nothing. `SettingsTitle` owns the
            words; this sets the shape, and it has to be a later sibling of
            it, because effects run in tree order. */}
        <PhoneTitleShape title="Security" sub="Password and signed-in devices" />

        <section className="d-card">
          <div className="d-card-head"><h3>Change password</h3></div>
          <div className="d-col d-gap-16">
            <div className="d-field">
              <label htmlFor="pw-now">Current password</label>
              <input
                id="pw-now"
                className="d-input"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => { setCurrent(e.target.value); setProblem(null); }}
              />
            </div>
            <div className="d-field">
              <label htmlFor="pw-new">New password</label>
              <input
                id="pw-new"
                className="d-input"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => { setNext(e.target.value); setProblem(null); }}
              />
              <span className="d-hint">
                At least 8 characters. Mixing letters and numbers makes it stronger.
              </span>
            </div>
            <div className="d-field">
              <label htmlFor="pw-again">New password again</label>
              <input
                id="pw-again"
                className="d-input"
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={(e) => { setAgain(e.target.value); setProblem(null); }}
              />
            </div>

            {problem && <ErrorNote>{problem}</ErrorNote>}

            <div className="d-btn-row">
              <button type="button" className="d-btn d-primary" disabled={busy} onClick={change}>
                <Icon name="key-round" />{busy ? 'Changing…' : 'Change password'}
              </button>
            </div>
            <p className="d-small d-muted">
              Changing it signs you out everywhere except here. Forgot it? Owners and admin
              can reset it from <Link to="/v2/settings/team">Team and roles</Link>.
            </p>
          </div>
        </section>

        <section className="d-card">
          <div className="d-card-head"><h3>Signed-in devices</h3></div>
          <div className="d-switch-row" style={{ paddingTop: 0 }}>
            <span className="d-card-icon"><Icon name="smartphone" /></span>
            <div className="d-txt">
              <b>This device</b>
              <span>
                Signed in as {user?.email ?? 'you'}. A session lasts 7 days, or 12 hours
                without “keep me signed in”.
              </span>
            </div>
            <span className="d-chip d-green">In use</span>
          </div>
          {/*
            * The design lists every device with its place and a Sign out
            * button beside each. Nothing serves this person their own
            * sessions, so the honest version is the one thing that does sign
            * the others out — and it says so rather than drawing three rows
            * of invented devices.
            */}
          <p className="d-small d-muted">
            The CRM does not yet show you your other devices. Changing your password above
            signs every one of them out at once.
          </p>
          <div className="d-btn-row">
            <button type="button" className="d-btn d-danger" onClick={leave}>
              <Icon name="log-out" />Sign out here
            </button>
          </div>
        </section>

        <section className="d-card">
          <div className="d-card-head"><h3>Two-step sign-in</h3></div>
          <div className="d-switch-row" style={{ paddingTop: 0, paddingBottom: 0 }}>
            <span className="d-card-icon"><Icon name="shield" /></span>
            <div className="d-txt">
              <b>Not switched on for anybody yet</b>
              <span>
                The CRM signs you in with your email and password. Your account is protected
                by that password and by the 15-minute lock after five wrong tries.
              </span>
            </div>
          </div>
        </section>
      </div>
    </SettingsShell>
  );
}
