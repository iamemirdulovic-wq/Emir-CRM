import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { api, ApiError } from '../lib/api.js';
import { locale, setLocale, type Locale } from '../lib/i18n.js';
import { Icon } from '../design/index.js';
import { useAppearance } from '../design/theme.js';

/**
 * Sign in, v2 — built from `design/web/login.html` and `design/screens/Login.dc.html`.
 *
 * `docs/v2/screens.md` had this screen down as "Done — the existing sign-in
 * screen, unchanged". It was not: the live screen is a centred card with a
 * team photo, and the design is a dark brand panel beside a form. The owner
 * opened crm.homes.me, saw the old one, and that is how the false Done was
 * found.
 *
 * Only the markup and the styling are new. Every line that decides whether
 * somebody gets in is the live screen's (`web/src/pages/Login.tsx`), copied
 * rather than rewritten: the same POST, the same "remember me", the same
 * post-sign-in redirect, and the same error text — which is how the account
 * lockout message ("Too many attempts…", straight from the server) reaches
 * the screen.
 *
 * Three things in the design are deliberately not built as drawn. Each one is
 * written up in `docs/decisions-to-confirm.md` §36-38:
 *
 *   1. The three preview cards are drawn with real client names, a live call
 *      count and the team's attendance. Nobody is signed in on this page, so
 *      anyone who loads the URL would read them. They keep their shape and
 *      their titles and say what each one does instead, and this screen
 *      fetches nothing before sign-in.
 *   2. The "Demo only · open as Agent / Owner" buttons walk into the CRM with
 *      no password. Not built.
 *   3. The six-digit second step is drawn below and is unreachable: our
 *      server never asks for a code, and `CLAUDE.md` says email and password
 *      only. Nothing adds the `d-two` class that would show it.
 */

/** §4 of the brief: under this the phone layout, above it the computer one. */
const PHONE = '(max-width:767px)';

/** The company, as it signs a contract. The design's own footer line. */
const COMPANY = 'Emigeo Homes Real Estate LLC';

/**
 * What the three cards in the brand panel say.
 *
 * The design fills them with a VIP client by name, a 7-day call chart and
 * "6 of 10 in office now". This is the sign-in page, so each card keeps its
 * own title and gets one plain line about what it does once you are inside.
 * No names, no counts, nothing read from the API.
 */
/*
 * Every word on the page, in both languages the switch offers. The Arabic
 * button used to mirror the layout and leave every word in English, so the
 * full stops jumped to the front of each line (".Every lead called") — the
 * v2 test, 16 Nov 2026.
 */
const WORDS = {
  en: {
    headline: 'Every lead called.', onTime: 'On time.',
    lead: 'One screen tells you who to call now, what is late and what your team is doing. Dubai off-plan, made simple.',
    preview: [
      { title: 'Needs you now', line: 'The calls that are late, and the ones with a timer running.' },
      { title: 'Calls today', line: 'Every call your team made, as they make them.' },
      { title: 'In office now', line: 'Who is in, who is late and who is away.', accent: true },
    ],
    signIn: 'Sign in', sub: 'Use your work email and your password.',
    email: 'Work email', password: 'Password', passwordHint: 'At least 8 letters or numbers',
    show: 'Show', hide: 'Hide', keep: 'Keep me signed in', forgot: 'Forgot password?',
    forgotNote: 'Ask the owner or an admin. They set a new password from Settings → '
      + 'Team and you choose your own the next time you sign in.',
    signingIn: 'Signing in…', failed: 'Could not sign in. Please try again.',
    guide: 'Put homes.me on your phone · install guide',
    noApp: 'No app to download.',
    install: 'Open crm.homes.me in Safari or Chrome, then Share › Add to Home Screen. '
      + 'It opens full-screen, like an app.',
  },
  ar: {
    headline: 'كل عميل يتلقى اتصالاً.', onTime: 'في الوقت المحدد.',
    lead: 'شاشة واحدة تخبرك بمن تتصل الآن، وما الذي تأخر، وماذا يفعل فريقك. عقارات دبي على الخارطة، بكل بساطة.',
    preview: [
      { title: 'يحتاجك الآن', line: 'المكالمات المتأخرة، وتلك التي يعمل مؤقتها.' },
      { title: 'مكالمات اليوم', line: 'كل مكالمة يجريها فريقك، لحظة بلحظة.' },
      { title: 'في المكتب الآن', line: 'من حضر، ومن تأخر، ومن غاب.', accent: true },
    ],
    signIn: 'تسجيل الدخول', sub: 'استخدم بريد العمل وكلمة المرور.',
    email: 'بريد العمل', password: 'كلمة المرور', passwordHint: 'ثمانية أحرف أو أرقام على الأقل',
    show: 'إظهار', hide: 'إخفاء', keep: 'تذكّرني', forgot: 'نسيت كلمة المرور؟',
    forgotNote: 'اطلب من المالك أو المسؤول. يعيّن لك كلمة مرور جديدة من الإعدادات ← الفريق، '
      + 'ثم تختار كلمتك الخاصة عند تسجيل الدخول التالي.',
    signingIn: 'جارٍ تسجيل الدخول…', failed: 'تعذّر تسجيل الدخول. حاول مرة أخرى.',
    guide: 'ضع homes.me على هاتفك · دليل التثبيت',
    noApp: 'لا يوجد تطبيق لتنزيله.',
    install: 'افتح crm.homes.me في Safari أو Chrome، ثم مشاركة ‹ إضافة إلى الشاشة الرئيسية. '
      + 'يفتح بملء الشاشة مثل التطبيق.',
  },
} as const;

/** Dubai, in the design's own format: "Wednesday, 11 November 2026 · 14:55". */
function stamp(now: Date, lang: Locale = 'en'): string {
  const tag = lang === 'ar' ? 'ar-AE' : 'en-GB';
  const day = new Intl.DateTimeFormat(tag, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(now);
  const time = new Intl.DateTimeFormat(tag, {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
  /* en-GB writes "Wednesday 11 November 2026"; the design has a comma. */
  return lang === 'ar' ? `${day} · ${time}` : `${day.replace(/^(\w+) /, '$1, ')} · ${time}`;
}

export function V2Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { resolved, cycle } = useAppearance();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  /* The switch has to redraw this page, so it holds the choice itself. */
  const [lang, setLang] = useState(locale());
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * Phone or computer, which the two designs disagree about enough to need
   * asking: `login.html` is a brand panel beside a form, `Login.dc.html` is
   * one column with no panel at all. Most of that is CSS; this is for the two
   * places where the markup itself differs.
   */
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(PHONE).matches,
  );
  const [guide, setGuide] = useState(false);
  const [now] = useState(() => new Date());
  const w = WORDS[lang === 'ar' ? 'ar' : 'en'];
  const when = stamp(now, lang);

  /* A phone turned on its side is still a phone, and the other way round. */
  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const sync = () => setPhone(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  /*
   * The orange system is opt-in per page (`:root[data-v2]`), and the v2 shell
   * is what normally turns it on. This screen is outside the shell, so it has
   * to say so itself — without it every token on the page resolves to nothing
   * and the dark brand panel renders as white text on a pale background. It is
   * taken off again on the way out, so `/login` and the live screens are
   * untouched.
   */
  useEffect(() => {
    document.documentElement.setAttribute('data-v2', '');
    return () => document.documentElement.removeAttribute('data-v2');
  }, []);

  /*
   * A CRM that has just been deployed has no accounts, so every password here
   * would fail with nothing to explain why. Ask once, and send the first person
   * to the page that can help them. (The live screen does the same. It is a
   * yes/no about this installation, not anybody's data.)
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

  function switchTo(next: Locale) {
    setLocale(next);
    setLang(next);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const user = await signIn(email, password, rememberMe);
      /* `/v2`, not `/dashboard`. Someone only reaches this screen by asking
         for a v2 address and being sent here to sign in, so sending them to
         the old home afterwards would make them type the address twice. The
         live `/login` still lands on `/dashboard` and is untouched. */
      navigate(user.mustChangePassword ? '/change-password' : '/v2', { replace: true });
    } catch (err) {
      // The server deliberately does not say which of the two was wrong. It
      // does say when the account is locked, and that message is its own.
      setError(err instanceof ApiError ? err.message : w.failed);
    } finally {
      setBusy(false);
    }
  }

  const installNote = (
    <div className="d-banner d-green v2-login-install" role="note">
      <Icon name="share-2" />
      <span className="d-grow">
        <b>{w.noApp}</b> {w.install}
      </span>
    </div>
  );

  return (
    <div className={phone ? 'v2 v2-phone v2-login' : 'v2 v2-login'}>
      <div className="p-login">
        {/* ── left: the brand panel ─────────────────────────────────────── */}
        <section className="d-brand">
          <div className="d-logo">
            <span className="d-sb-mark v2-login-mark"><Icon name="building" /></span>
            <b>homes<span>.</span>me</b>
            <span className="d-chip v2-login-chip">CRM</span>
          </div>
          <h1>{w.headline}<br /><em>{w.onTime}</em></h1>
          <p className="d-lead">{w.lead}</p>
          <div className="d-preview">
            {w.preview.map((card) => (
              <div className={'accent' in card ? 'd-pv d-or v2-login-pv' : 'd-pv v2-login-pv'} key={card.title}>
                <span className="d-label">{card.title}</span>
                <span className="v2-login-pv-line">{card.line}</span>
              </div>
            ))}
          </div>
          <div className="d-foot">
            <span>{COMPANY}</span>
            <span>{when}</span>
          </div>
        </section>

        {/* ── right: the form ───────────────────────────────────────────── */}
        <section className="d-side">
          <form className={error ? 'd-form d-bad' : 'd-form'} onSubmit={onSubmit} noValidate>
            <div className="d-step1">
              <h2>{w.signIn}</h2>
              <p className="d-sub">{w.sub}</p>

              {error && (
                <div className="d-banner d-red d-form-error" role="alert">
                  <Icon name="alert-triangle" />
                  <span className="d-grow">{error}</span>
                </div>
              )}

              <div className="d-field">
                <label htmlFor="v2-login-email">{w.email}</label>
                <div className="d-input-icon">
                  <Icon name="mail" />
                  <input
                    className="d-input d-lg"
                    id="v2-login-email"
                    type="email"
                    placeholder="name@homes.me"
                    autoComplete="username"
                    value={email}
                    onChange={(event) => { setEmail(event.target.value); setError(null); }}
                  />
                </div>
              </div>

              <div className="d-field">
                <label htmlFor="v2-login-password">{w.password}</label>
                <div className="d-input-icon">
                  <Icon name="lock" />
                  <input
                    className="d-input d-lg"
                    id="v2-login-password"
                    type={show ? 'text' : 'password'}
                    placeholder={w.passwordHint}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => { setPassword(event.target.value); setError(null); }}
                  />
                  <button
                    type="button"
                    className="d-btn d-xs d-ghost"
                    onClick={() => setShow((on) => !on)}
                  >
                    {show ? w.hide : w.show}
                  </button>
                </div>
              </div>

              <div className="d-row">
                <label className="d-check d-grow">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                  />
                  {w.keep}
                </label>
                {/*
                  * No email reset flow, by design: `CLAUDE.md` (LOGIN) puts the
                  * reset on the Users page, and the design's own prototype says
                  * the same thing in a toast. There is no toast host on this
                  * page, so it is said here.
                  */}
                <button
                  type="button"
                  className="d-link d-small"
                  onClick={() => setNote(w.forgotNote)}
                >
                  {w.forgot}
                </button>
              </div>

              {note && (
                <div className="d-banner v2-login-note" role="status">
                  <Icon name="info" />
                  <span className="d-grow">{note}</span>
                </div>
              )}

              <button className="d-btn d-primary d-lg d-block" type="submit" disabled={busy}>
                {busy ? w.signingIn : w.signIn}
                <Icon name="arrow-right" />
              </button>

              {!phone && (
                <>
                  <button
                    type="button"
                    className="d-card-link v2-login-guide"
                    onClick={() => setGuide((on) => !on)}
                    aria-expanded={guide}
                  >
                    <Icon name="download" />
                    {w.guide}
                  </button>
                  {guide && installNote}
                </>
              )}
            </div>

            {/*
              * Built and switched off. See `docs/decisions-to-confirm.md` §38:
              * the design has a second step for owners and admins, and the
              * owner's brief says email and password only. Our server never
              * asks for a code, so nothing here can be reached — the markup is
              * `hidden`, and no code path adds the `d-two` class the design
              * uses to show it. Turning it on needs the owner's yes and work
              * on the server, not a change here.
              */}
            <div className="d-step2" hidden aria-hidden="true">
              <span className="d-card-icon d-accent v2-login-shield"><Icon name="shield" /></span>
              <h2>Two-step sign-in</h2>
              <p className="d-sub">
                Owners and admin need a second step. Write the 6 digits from your code app.
              </p>
              <div className="d-banner d-red d-form-error" role="alert">
                <Icon name="alert-triangle" />
                <span className="d-grow">Write the 6 digits.</span>
              </div>
              <div className="d-code">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <input className="d-input" inputMode="numeric" maxLength={1} aria-label={`Digit ${n}`} key={n} />
                ))}
              </div>
              <button className="d-btn d-primary d-lg d-block" type="button" disabled>
                Confirm and open the dashboard
              </button>
            </div>
          </form>

          {/*
            * The language switch and the light/dark button.
            *
            * On a computer this is `position:absolute` at the top right, so
            * where it sits in the markup makes no difference there. On a
            * phone it flows, and `Login.dc.html` puts the language chips
            * under the Sign in button with the install note below them — so
            * it is written here, after the form, and the phone gets the
            * prototype's order for free.
            */}
          <div className="d-topline">
            <div className="d-seg d-sm" role="group" aria-label="Language">
              <button
                type="button"
                className={lang === 'en' ? 'd-on' : undefined}
                aria-pressed={lang === 'en'}
                onClick={() => switchTo('en')}
              >
                English
              </button>
              <button
                type="button"
                lang="ar"
                className={lang === 'ar' ? 'd-on' : undefined}
                aria-pressed={lang === 'ar'}
                onClick={() => switchTo('ar')}
              >
                العربية
              </button>
            </div>
            <button
              type="button"
              className="d-btn d-icon d-sm d-ghost"
              onClick={cycle}
              title="Light / dark"
              aria-label="Light or dark theme"
            >
              <Icon name={resolved === 'dark' ? 'sun' : 'moon'} />
            </button>
          </div>


          {/* On a phone the prototype prints the install steps rather than
              linking to a guide that would ask you to sign in first. */}
          {phone && installNote}
          {/* The live `/login` also offers "Email me a sign-in link". The
              design has no such button, so it is not here. `/login` keeps it,
              so the two screens differ on this one point — written up in
              `docs/decisions-to-confirm.md` §36. */}
        </section>
      </div>
    </div>
  );
}
