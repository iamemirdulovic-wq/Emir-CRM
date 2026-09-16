import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { t } from '../lib/i18n.js';

const MIN_LENGTH = 8;

/**
 * The gate in front of a temporary password. An admin hands out a one-time
 * password; this is where it stops being one.
 */
export function ChangePassword() {
  const { user, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmation) return setError('The two new passwords do not match.');
    if (newPassword.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);

    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      await refresh();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="login">
      <div className="login-card">
        <div className="login-art">
          <div className="brand">
            <div className="brand-mark">E</div>
            Emir CRM
          </div>
          <div>
            <h2>Choose your own password.</h2>
            <p>Your admin gave you a temporary one. Replace it and you are in.</p>
          </div>
          <div className="stripes" aria-hidden="true">
            <span style={{ background: 'var(--s-new)', height: '100%' }} />
            <span style={{ background: 'var(--s-eng)', height: '62%' }} />
            <span style={{ background: 'var(--s-won)', height: '30%' }} />
          </div>
        </div>

        <div className="login-form">
          <form onSubmit={onSubmit} noValidate>
            <h1>{t('changePassword')}</h1>
            <p className="sub">{user ? `Signed in as ${user.email}` : ''}</p>

            {error && (
              <div className="err" style={{ display: 'block' }} role="alert">
                {error}
              </div>
            )}

            <label className="field">
              <span>{t('currentPassword')}</span>
              <input
                id="current"
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>

            <label className="field">
              <span>{t('newPassword')}</span>
              <input
                id="next"
                className="input"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_LENGTH}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Repeat the new password</span>
              <input
                id="confirm"
                className="input"
                type="password"
                autoComplete="new-password"
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>

            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? `${t('save')}…` : t('save')}
            </button>
            <p className="hint">
              At least {MIN_LENGTH} characters.{' '}
              <button type="button" className="rowbtn" onClick={() => void signOut()}>
                {t('signOut')}
              </button>
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
