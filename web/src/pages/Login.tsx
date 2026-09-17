import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { api, ApiError } from '../lib/api.js';
import { t } from '../lib/i18n.js';

/**
 * Email, password, a sign-in button. Nothing else.
 *
 * There is no public sign-up and no forgot-password flow by design: an owner or
 * admin creates accounts and resets passwords from Settings, so the only way in
 * is a credential a person already has.
 *
 * Ported from the login screen in design/emir-crm-design.html.
 */
export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * A CRM that has just been deployed has no accounts, so every password here
   * would fail with nothing to explain why. Ask once, and send the first person
   * to the page that can help them.
   */
  useEffect(() => {
    let cancelled = false;
    void api
      .get<{ needed: boolean }>('/api/setup/status')
      .then((status) => {
        if (!cancelled && status.needed) navigate('/setup', { replace: true });
      })
      // An older server has no such endpoint, and a network blip is not this
      // page's problem: either way, show the login.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await signIn(email, password, rememberMe);
      navigate(user.mustChangePassword ? '/change-password' : '/dashboard', { replace: true });
    } catch (err) {
      // The server deliberately does not say which of the two was wrong.
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
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
            <h2>{t('signInHeadline')}</h2>
            <p>{t('signInBlurb')}</p>
          </div>
          {/* The stripes are the pipeline in miniature, in stage order. */}
          <div className="stripes" aria-hidden="true">
            <span style={{ background: 'var(--s-new)', height: '100%' }} />
            <span style={{ background: 'var(--s-att)', height: '78%' }} />
            <span style={{ background: 'var(--s-eng)', height: '58%' }} />
            <span style={{ background: 'var(--s-apt)', height: '40%' }} />
            <span style={{ background: 'var(--s-deal)', height: '26%' }} />
            <span style={{ background: 'var(--s-won)', height: '16%' }} />
          </div>
        </div>

        <div className="login-form">
          <form onSubmit={onSubmit} noValidate>
            <h1>{t('signIn')}</h1>
            <p className="sub">{t('signInSubtitle')}</p>

            {error && (
              <div className="err" style={{ display: 'block' }} role="alert">
                {error}
              </div>
            )}

            <label className="field">
              <span>{t('email')}</span>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="field">
              <span>{t('password')}</span>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            <div className="row-between" style={{ marginBottom: 20 }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                {t('keepSignedIn')}
              </label>
            </div>

            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? `${t('signIn')}…` : t('signIn')}
            </button>
            <p className="hint">{t('forgotPassword')}</p>
          </form>
        </div>
      </div>
    </section>
  );
}
