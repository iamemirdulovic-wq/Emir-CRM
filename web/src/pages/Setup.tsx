import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { api, ApiError } from '../lib/api.js';

/**
 * First run: create the owner account in the browser.
 *
 * This is the whole reason the CRM can be deployed without a terminal. It
 * exists only while the `users` table is empty — the server refuses afterwards,
 * whatever this page does — and the sign-in page redirects here on a fresh
 * install so nobody meets a login they cannot pass.
 *
 * Built on the login screen's own markup, so a fresh deployment's first screen
 * looks like the product rather than a setup wizard bolted to the side.
 */
export function Setup() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [checking, setChecking] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [suggestedKey, setSuggestedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await api.get<{ needed: boolean; suggestedEncryptionKey?: string }>('/api/setup/status');
        if (cancelled) return;
        // Already set up: this page must not linger where someone could wonder
        // what it is for.
        if (!status.needed) {
          navigate('/login', { replace: true });
          return;
        }
        setSuggestedKey(status.suggestedEncryptionKey ?? null);
      } catch {
        if (!cancelled) setError('Could not reach the server. Refresh the page to try again.');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/setup/owner', { name, email, password });
      // The server signed us in as part of creating the account.
      await refresh();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the account. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (checking) return null;

  return (
    <section id="login">
      <div className="login-card">
        <div className="login-art">
          <div className="brand">
            <div className="brand-mark">E</div>
            Emir CRM
          </div>
          <div>
            <h2>Let&rsquo;s set up your CRM</h2>
            <p>
              This is the first time anyone has opened it. Create your owner account and you are in — you
              can add your agents afterwards from Settings.
            </p>
          </div>
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
          {/* One child, because .login-form is a flex row: a second sibling
              would sit beside the form rather than under it. */}
          <div style={{ width: '100%' }}>
          <form onSubmit={onSubmit} noValidate>
            <h1>Create your account</h1>
            <p className="sub">You are the owner. This page only works once.</p>

            {error && (
              <div className="err" style={{ display: 'block' }} role="alert">
                {error}
              </div>
            )}

            <label className="field">
              <span>Your name</span>
              <input
                className="input"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Email</span>
              <input
                className="input"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Password again</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </label>

            <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
              At least 8 characters. Length helps more than symbols do.
            </p>

            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? 'Creating your account…' : 'Create account and sign in'}
            </button>
          </form>

          {suggestedKey && (
            /*
             * The one piece of configuration that cannot be done from a
             * browser. Offered here so the owner never needs a terminal: copy
             * it, paste it into the hosting panel, restart. Nothing breaks
             * without it until an integration is connected, which is why this
             * does not block the button above.
             */
            <div className="card" style={{ marginTop: 20, padding: 16 }}>
              <strong style={{ display: 'block', marginBottom: 6 }}>One more thing, when you have a minute</strong>
              <p className="sub" style={{ marginBottom: 10 }}>
                Add this to your hosting panel as <code>ENCRYPTION_KEY</code>, then restart the app. It
                protects saved WhatsApp and Google tokens. Nothing breaks until you connect one of those.
              </p>
              <code
                className="setup-key"
                style={{
                  display: 'block',
                  wordBreak: 'break-all',
                  fontSize: 12,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'var(--glass-2, rgba(0,0,0,0.04))',
                }}
              >
                {suggestedKey}
              </code>
              <button
                type="button"
                className="btn"
                style={{ marginTop: 10 }}
                onClick={() => {
                  void navigator.clipboard?.writeText(suggestedKey).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  );
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
          </div>
        </div>
      </div>
    </section>
  );
}
