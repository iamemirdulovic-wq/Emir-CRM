import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { api, ApiError } from '../lib/api.js';
import { locale, setLocale, t } from '../lib/i18n.js';
import { BrandLockup } from '../brand.js';

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
  /* The switch has to redraw this page, so it holds the choice itself. */
  const [lang, setLang] = useState(locale());
  const switchTo = (next: 'en' | 'ar') => { setLocale(next); setLang(next); };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* The sign-in link flow, which lives beside the password rather than
     replacing it: owners and admins keep passwords so somebody can always
     get in on the day email itself is broken. */
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkSent, setLinkSent] = useState<string | null>(null);

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

  /**
   * Ask for a one-time link.
   *
   * The answer is deliberately the same whether or not the address belongs to
   * an account — otherwise this screen becomes a way to find out who works
   * here, one guess at a time.
   */
  async function requestLink() {
    setError(null);
    if (!email.trim()) {
      setError('Type your email address first.');
      return;
    }
    setLinkBusy(true);
    try {
      const result = await api.post<{ message: string }>('/api/auth/magic-link', { email });
      setLinkSent(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send a sign-in link.');
    } finally {
      setLinkBusy(false);
    }
  }

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
        {/*
          * The team, in the office, with the logo on the wall behind them.
          *
          * Two cuts of the same picture rather than one scaled down: the tall
          * one is drawn for this panel, and on a phone the panel becomes a
          * short band across the top, where a portrait crop would show three
          * foreheads. The browser picks by the panel's own shape, not the
          * screen's, which is what `media` here is for.
          */}
        <div className="login-art">
          <picture>
            <source media="(max-width: 760px)" srcSet="/brand/team-wide.webp" />
            <img src="/brand/team-portrait.webp" alt="" width={1200} height={1600} />
          </picture>
          <div className="login-art-said">
            <h2>{t('signInHeadline')}</h2>
            <p>{t('signInBlurb')}</p>
          </div>
        </div>

        <div className="login-form">
          <form onSubmit={onSubmit} noValidate>
            <BrandLockup />
            <h1>{t('welcomeBack')}</h1>
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

            <div className="login-or"><span>or</span></div>

            {linkSent ? (
              <p className="login-link-sent" role="status">
                {linkSent}
              </p>
            ) : (
              <button
                className="btn btn-block"
                type="button"
                disabled={linkBusy}
                onClick={() => void requestLink()}
              >
                {linkBusy ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            )}

            <p className="hint">{t('forgotPassword')}</p>

            {/*
              * The two things both design files put on this page and the
              * build had neither: the language switch, and how to put the
              * CRM on a phone.
              *
              * `design/web/login.html` has "English · العربية" above the
              * form and "Put homes.me on your phone · install guide" below
              * it; `design/screens/Login.dc.html` has the same switch and
              * the same offer written out as "No app to download."
              *
              * The install guide inside the CRM is behind the sign-in, so
              * there is nothing to link to from here. The three steps are
              * the whole of it, so they are written out instead of promising
              * a page that would ask them to sign in first.
              */}
            <div className="login-lang" role="group" aria-label="Language">
              <button
                type="button"
                className={lang === 'en' ? 'on' : undefined}
                onClick={() => switchTo('en')}
              >
                English
              </button>
              <button
                type="button"
                lang="ar"
                className={lang === 'ar' ? 'on' : undefined}
                onClick={() => switchTo('ar')}
              >
                العربية
              </button>
            </div>

            <p className="login-install">
              <b>{t('noAppToDownload')}</b> {t('addToHomeScreen')}
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
