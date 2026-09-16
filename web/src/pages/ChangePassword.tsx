import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { t } from '../lib/i18n.js';
import { Icon } from '../components/ui.js';

/** Shown until a temporary password has been replaced. */
export function ChangePassword() {
  const { refresh, user } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = newPassword.length > 0 && newPassword.length < 8;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (tooShort || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      await refresh();
      navigate('/board', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-sand-50 px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Icon name="lock_reset" />
          </span>
          <div>
            <h1 className="text-base font-semibold text-slate-900">{t('changePassword')}</h1>
            {user?.mustChangePassword ? (
              <p className="text-xs text-slate-500">Your temporary password must be replaced before you continue.</p>
            ) : null}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="current">
            {t('currentPassword')}
          </label>
          <input
            id="current"
            className="field"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="next">
            {t('newPassword')}
          </label>
          <input
            id="next"
            className="field"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <p className={`mt-1 text-xs ${tooShort ? 'text-rose-600' : 'text-slate-400'}`}>At least 8 characters.</p>
        </div>

        <div>
          <label className="label" htmlFor="confirm">
            Confirm new password
          </label>
          <input
            id="confirm"
            className="field"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {mismatch ? <p className="mt-1 text-xs text-rose-600">The passwords do not match.</p> : null}
        </div>

        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn-primary w-full" disabled={busy || tooShort || mismatch || !newPassword}>
          {t('save')}
        </button>
      </form>
    </div>
  );
}
