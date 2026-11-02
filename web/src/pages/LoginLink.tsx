import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { ApiError } from '../lib/api.js';
import { BrandLockup } from '../brand.js';

/**
 * Where a sign-in link lands.
 *
 * The token arrives in the URL because there is nowhere else for it to be —
 * and that is why it only works once, only for fifteen minutes, and is wiped
 * out of the address bar the moment it has been spent. A URL survives in
 * browser history, in the back button and in whatever the phone syncs to the
 * cloud; what survives here is a token that is already dead.
 */
export function LoginLink() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { signInWithLink } = useAuth();
  const [error, setError] = useState<string | null>(null);
  /* React runs effects twice in development. Spending a one-time token twice
     would turn every sign-in into "that link has already been used". */
  const tried = useRef(false);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;

    const token = params.get('token');
    if (!token) {
      setError('That link is missing its code. Ask for a new one.');
      return;
    }

    void signInWithLink(token, true)
      .then(() => {
        /* Replace, so the back button cannot return to a URL with a token in
           it, and so the token stops being visible in the address bar. */
        navigate('/dashboard', { replace: true });
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'That sign-in link did not work.');
      });
  }, [params, signInWithLink, navigate]);

  return (
    <section className="login">
      <div className="login-card">
        <div className="login-form">
          <div style={{ marginBottom: 18 }}><BrandLockup /></div>
          {error ? (
            <>
              <h1>That link did not work</h1>
              <p className="sub">{error}</p>
              <Link className="btn btn-primary btn-block" to="/login">Back to sign in</Link>
            </>
          ) : (
            <>
              <h1>Signing you in…</h1>
              <p className="sub">One moment.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
