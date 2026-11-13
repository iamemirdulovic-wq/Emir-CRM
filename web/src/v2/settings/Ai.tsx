import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.js';
import { Icon } from '../../design/index.js';
import { Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { SettingsShell, SettingsSwitch, SettingsTitle } from './Shell.js';

/**
 * Settings → Homes AI.
 *
 * Built from `design/web/ai-settings.html`: this month's spend against the
 * limit with a forecast, the limit itself, where the money went by feature,
 * what Homes AI may do, the text it is told about the company — and the key,
 * which was the one thing on that page with nowhere to type it.
 *
 * Three things worth knowing:
 *
 *  - **The forecast is arithmetic, and says so.** "$38 of $100" on day 11 is
 *    a fact; "about $104 by 30 Nov" is the same fact multiplied out. It is
 *    labelled as a speed rather than dressed up as a prediction, and on the
 *    1st and 2nd it is not shown at all, because two days of a month tell you
 *    nothing about the other twenty-eight.
 *  - **An environment variable always beats the key saved here.**
 *    `server/src/config/secrets.ts` reads the host's `GEMINI_API_KEY` first.
 *    So when the key comes from the hosting panel the box says so and does
 *    not pretend saving would help — otherwise an owner pastes a new key,
 *    sees "saved", and watches the old one keep answering.
 *  - **The key is never shown.** The server returns where it came from and
 *    its last four characters, nothing else.
 *
 * One difference from the design, in `docs/decisions-to-confirm.md`: the
 * design draws one "what Homes AI should know about us" box of 1,500 letters.
 * The CRM stores this knowledge in six named sections, each with its own
 * length, and the AI reads a different subset of them for each thing it does.
 * So there is a box per section with the design's own counter, minimum and
 * over-length guard on each — the rules are the design's, the number beside
 * them is each section's own.
 */

interface FeatureSpend {
  feature: string;
  micros: number;
  calls: number;
  usd: string;
}

interface Usage {
  spentUsd: string;
  capUsd: string;
  calls: number;
  spentMicros: number;
  capMicros: number;
  byFeature: FeatureSpend[];
  features: Record<string, boolean>;
  featureList: Array<{ key: string; name: string; title: string; note: string }>;
}

/* The limits the design offers. An owner who wants another number can still
   have one — the server takes any value — but these are the three worth a tap. */
const LIMITS = [50, 100, 200];

/** What the server calls each feature, in the owner's words. */
const FEATURE_NAMES: Record<string, string> = {
  ask: 'Chat',
  summary: 'In short',
  brief: 'Morning brief',
  voice: 'Voice notes',
  'best-time': 'Best time',
  knowledge: 'Company text',
  describe: 'Project descriptions',
  classify: 'Reading messages',
};

/** The five bars the design draws, in the design's order. */
const SPEND_ORDER = ['summary', 'voice', 'ask', 'brief', 'best-time'];

export function V2SettingsAi() {
  const { user } = useAuth();
  const canEdit = user?.role === 'owner' || user?.role === 'admin';
  const got = useAsync<Usage>(() => api.get('/api/ai/usage'), []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  if (got.error) {
    return <SettingsShell page="p-ai-settings"><div className="d-set-body"><ErrorNote>{got.error}</ErrorNote></div></SettingsShell>;
  }
  if (!got.data) {
    return <SettingsShell page="p-ai-settings"><div className="d-set-body"><Spinner /></div></SettingsShell>;
  }

  const usage = got.data;
  const capUsd = usage.capMicros / 1_000_000;
  const spentUsd = usage.spentMicros / 1_000_000;
  const share = capUsd > 0 ? (spentUsd / capUsd) * 100 : 0;

  /* Where the month is, so the forecast can be honest about how little it
     knows on the 2nd. Dubai is UTC+4 with no daylight saving. */
  const now = new Date(Date.now() + 4 * 3600_000);
  const day = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const forecast = day >= 3 ? (spentUsd / day) * daysInMonth : null;
  const month = now.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });

  /* "by 30 Nov" and "until 1 December" — the two dates the design's own foot
     and forecast name, worked out rather than written in. */
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), daysInMonth))
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const firstNext = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

  async function change(patch: Record<string, unknown>, say: string) {
    setBusy(true);
    setProblem(null);
    try {
      await api.put('/api/ai/limits', patch);
      toast(say);
      got.reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  /* Every one of the five the design lists, at zero when nothing was spent:
     a missing bar reads as "this feature does not exist", not as "free". */
  const spentOn = new Map(usage.byFeature.map((one) => [one.feature, one]));
  const bars = [
    ...SPEND_ORDER.map((key) => ({
      feature: key,
      micros: spentOn.get(key)?.micros ?? 0,
      usd: spentOn.get(key)?.usd ?? '0.00',
    })),
    ...usage.byFeature
      .filter((one) => !SPEND_ORDER.includes(one.feature))
      .map((one) => ({ feature: one.feature, micros: one.micros, usd: one.usd })),
  ];
  const biggest = Math.max(1, ...bars.map((one) => one.micros));

  return (
    <SettingsShell page="p-ai-settings">
      <div className="d-set-body">
        <SettingsTitle
          title="Homes AI"
          note="What Homes AI may do, what it knows about the company, and how much it may spend."
        />

        <div className="d-ai-top">
          <section className="d-card d-hero">
            <div className="d-row d-top">
              <div className="d-grow">
                <span className="d-label">Used in {month}</span>
                <div className="d-stat-row d-mt-8">
                  <b className="d-num-hero">${whole(spentUsd)}</b>
                  <span className="d-num-sm d-muted">of ${whole(capUsd)}</span>
                </div>
              </div>
              <span className="d-hero-chip">
                {capUsd === 0
                  ? 'No limit'
                  : share >= 70
                    ? `${Math.round(share)}% used · alert soon`
                    : forecast !== null && forecast > capUsd ? 'A little fast' : 'On track'}
              </span>
            </div>
            {/* The bar turns amber past 70%. The white tick is where the
                month stands now — the design puts it at the spend, so it
                reads as "you are here" on a bar that otherwise only has an
                end. */}
            <div className={share >= 70 ? 'd-ai-bar d-mt-16 d-warn' : 'd-ai-bar d-mt-16'}>
              <i style={{ width: `${Math.min(100, share)}%` }} />
              <b style={{ left: `${Math.min(100, share)}%` }} />
            </div>
            <div className="d-row d-between d-small d-muted d-mt-8">
              <span>Day {day} of {daysInMonth}</span>
              <span>
                {forecast === null
                  ? `${usage.calls} request${usage.calls === 1 ? '' : 's'} so far`
                  : `At this speed: about $${whole(forecast)} by ${lastDay}${
                    capUsd > 0 && forecast > capUsd ? ' · over the limit' : ''}`}
              </span>
            </div>
            <div className="d-card-foot v2-ai-foot">
              <Icon name="info" />
              <span>
                {capUsd === 0
                  ? 'There is no limit set, so Homes AI will keep answering whatever it costs.'
                  : `At the limit Homes AI pauses until ${firstNext}. The CRM keeps working.`}
              </span>
            </div>
          </section>

          <section className="d-card">
            <div className="d-card-head"><h3>Monthly limit</h3></div>
            <div className="d-seg d-block" role="group" aria-label="Monthly limit">
              {LIMITS.map((one) => (
                <button
                  key={one}
                  type="button"
                  className={Math.round(capUsd) === one ? 'd-on' : undefined}
                  disabled={!canEdit || busy}
                  onClick={() => void change({ capUsd: one }, `Monthly limit is $${one}`)}
                >
                  ${one}
                </button>
              ))}
            </div>

            <div className="d-col d-gap-8 d-mt-16">
              {bars.map((one) => (
                <div className="d-hbar" key={one.feature}>
                  <span>{FEATURE_NAMES[one.feature] ?? one.feature}</span>
                  <div className="d-bar" style={{ '--v': `${(one.micros / biggest) * 100}%` } as React.CSSProperties}>
                    <i />
                  </div>
                  <b>${whole(one.micros / 1_000_000)}</b>
                </div>
              ))}
            </div>
            <div className="d-card-foot">Alert to owners at 80% and at 100%</div>
          </section>
        </div>

        <section className="d-card">
          <div className="d-card-head">
            <h4 className="d-grow">Homes AI can</h4>
            <span className="d-small d-muted">
              {Object.values(usage.features).filter(Boolean).length} of{' '}
              {usage.featureList.length} on
            </span>
          </div>
          <div>
            {usage.featureList.map((one) => (
              <SettingsSwitch
                key={one.key}
                title={one.title}
                note={one.note}
                on={usage.features[one.key] ?? false}
                disabled={!canEdit || busy}
                onChange={(on) => void change(
                  { features: { [one.key]: on } },
                  on ? `${one.title} · on` : `${one.title} · off`,
                )}
              />
            ))}
          </div>
        </section>

        <Knowledge canEdit={canEdit} />

        {problem && <ErrorNote>{problem}</ErrorNote>}

        <div className="d-banner">
          <Icon name="shield" />
          <span className="d-grow">
            Homes AI reads only what the person may see: for an agent it reads only that agent&apos;s
            leads. It never sends a message for anyone.
          </span>
          <Link className="d-link" to="/v2/ai">Open Homes AI</Link>
        </div>
      </div>
    </SettingsShell>
  );
}

/** Whole dollars, as the design writes every figure on this page. */
function whole(usd: number): string {
  return Math.round(usd).toLocaleString('en-GB');
}

/* ── the key, the model, and what Homes AI is told about the company ───── */

interface SectionDef {
  key: string;
  label: string;
  help: string;
  placeholder: string;
  bilingual: boolean;
  softLimit: number;
}

interface KnowledgeAnswer {
  sections: SectionDef[];
  values: Array<{ section_key: string; language: 'en' | 'ar'; content: string | null }>;
  provider: {
    name: string;
    ready: boolean;
    model: string;
    keySource: 'env' | 'crm' | 'none';
    keyEndsWith: string | null;
    keyUnreadable: boolean;
    capUsd: string;
  };
}

/** The design's own minimum: enough to be a sentence. */
const MIN_LETTERS = 20;

function Knowledge({ canEdit }: { canEdit: boolean }) {
  const got = useAsync<KnowledgeAnswer>(() => api.get('/api/ai/knowledge'), []);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [tried, setTried] = useState<Record<string, boolean>>({});
  const toast = useToast();

  const saved = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of got.data?.values ?? []) {
      if (row.language === 'en') out[row.section_key] = row.content ?? '';
    }
    return out;
  }, [got.data]);

  useEffect(() => { if (got.data) setDraft(saved); }, [got.data, saved]);

  if (got.error) return <ErrorNote>{got.error}</ErrorNote>;
  if (!got.data) return null;

  async function save(section: SectionDef) {
    const value = draft[section.key] ?? '';
    setTried((was) => ({ ...was, [section.key]: true }));
    /* The design's two guards, in its own words. */
    if (value.trim().length < MIN_LETTERS) return;
    if (value.length > section.softLimit) {
      toast(`The text is too long. Keep it under ${section.softLimit.toLocaleString('en-GB')} letters.`);
      return;
    }
    setBusy(section.key);
    try {
      await api.put(`/api/ai/knowledge/${section.key}`, { content: value, language: 'en' });
      toast('Homes AI will use this from now on');
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <ApiKey provider={got.data.provider} canEdit={canEdit} onSaved={() => got.reload()} />

      <section className="d-card">
        <div className="d-card-head"><h3>What Homes AI should know about us</h3></div>
        {got.data.sections.map((section) => {
          const value = draft[section.key] ?? '';
          const changed = value !== (saved[section.key] ?? '');
          const tooLong = value.length > section.softLimit;
          const tooShort = value.trim().length > 0 && value.trim().length < MIN_LETTERS;
          const showError = tried[section.key] && (tooShort || value.trim().length === 0);
          return (
            <div className={showError ? 'd-field d-invalid' : 'd-field'} key={section.key}>
              <div className="d-row">
                <label className="d-grow" htmlFor={`know-${section.key}`}>{section.label}</label>
                <span className={tooLong ? 'd-small d-t-red' : 'd-small d-muted'}>
                  {value.length.toLocaleString('en-GB')} of{' '}
                  {section.softLimit.toLocaleString('en-GB')} letters
                </span>
              </div>
              <textarea
                id={`know-${section.key}`}
                className="d-textarea v2-ai-know"
                value={value}
                disabled={!canEdit}
                required
                placeholder={section.placeholder}
                aria-label={section.label}
                onChange={(e) => setDraft((was) => ({ ...was, [section.key]: e.target.value }))}
              />
              <span className="d-hint">{section.help}</span>
              {showError && <span className="d-error">Write at least one full sentence.</span>}
              {canEdit && (
                <div className="d-row d-mt-8">
                  <span className="d-grow" />
                  <button
                    type="button"
                    className="d-btn d-sm d-primary"
                    disabled={!changed || busy === section.key}
                    onClick={() => void save(section)}
                  >
                    {busy === section.key ? 'Saving…' : 'Save text'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <p className="d-small d-muted">
          Do not write passwords or client details here. Homes AI uses this text in every answer.
        </p>
      </section>
    </>
  );
}

/* ── the key ───────────────────────────────────────────────────────────── */

/**
 * The Gemini key.
 *
 * It was on the old settings page and nowhere in v2, so the one page called
 * "Homes AI" could set the budget and the switches but not the thing that
 * makes any of it answer. The owner had to leave v2 to paste a key.
 *
 * The sentence that matters is the one about the hosting panel: the server
 * reads `GEMINI_API_KEY` from the environment first and the stored one second
 * (`server/src/config/secrets.ts`). An owner who pastes a key here while one
 * is set in the host would see "saved" and nothing change, so when that is the
 * case the box says so and the field is not offered.
 */
function ApiKey({
  provider, canEdit, onSaved,
}: {
  provider: KnowledgeAnswer['provider'];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const toast = useToast();

  const fromHost = provider.keySource === 'env';

  async function save() {
    if (key.trim().length < 10) return;
    setBusy(true);
    setProblem(null);
    try {
      const answer = await api.put<{ ready: boolean; works: boolean | null }>(
        '/api/ai/connection', { apiKey: key.trim() },
      );
      setKey('');
      toast(answer.works === false
        ? 'Key saved, but Google would not answer with it. Check it in the Google console.'
        : 'Key saved. Homes AI is connected.');
      onSaved();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That key was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    /* Two clicks, like every other risky action in the design: this one turns
       off every AI answer in the CRM for everybody. */
    if (!clearing) { setClearing(true); return; }
    setBusy(true);
    try {
      await api.del('/api/ai/connection');
      toast('Key removed. Homes AI is switched off.');
      setClearing(false);
      onSaved();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="d-card">
      <div className="d-card-head">
        <h3 className="d-grow">The key</h3>
        <span className={provider.ready ? 'd-chip d-green d-pip' : 'd-chip d-amber d-pip'}>
          {provider.ready ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <dl className="d-kv">
        <div className="d-kv-row">
          <dt>Where it comes from</dt>
          <dd>
            {fromHost ? 'The hosting panel'
              : provider.keySource === 'crm' ? 'Saved here, in the CRM'
                : 'Nowhere yet'}
          </dd>
        </div>
        {provider.keyEndsWith && (
          <div className="d-kv-row">
            <dt>Ends with</dt>
            <dd className="d-t-mono">…{provider.keyEndsWith}</dd>
          </div>
        )}
        <div className="d-kv-row">
          <dt>Model</dt>
          <dd>{provider.model || 'Not chosen yet'}</dd>
        </div>
      </dl>

      {provider.keyUnreadable && (
        <div className="d-banner d-red d-mt-12">
          <Icon name="alert-triangle" />
          <span className="d-grow">
            A key is stored but cannot be read any more — the encryption key under it changed,
            which almost always means a deploy replaced the folder it was sitting in. Paste the
            key again below.
          </span>
        </div>
      )}

      {fromHost ? (
        /* The honest version of this box. Saving one here would store it and
           change nothing, because the host's value wins on every request. */
        <div className="d-banner d-amber d-mt-12">
          <Icon name="info" />
          <span className="d-grow">
            <b>This key is set in the hosting panel, and that always wins.</b> A key typed here
            would be stored and never used. Change it where it is set, in Hostinger →
            Environment variables → <span className="d-t-mono">GEMINI_API_KEY</span>, then restart
            the app.
          </span>
        </div>
      ) : canEdit ? (
        <>
          <div className="d-field d-mt-12">
            <label htmlFor="ai-key">Google Gemini key</label>
            <input
              id="ai-key"
              className="d-input"
              type="password"
              autoComplete="off"
              value={key}
              placeholder={provider.keySource === 'crm' ? 'Paste a new key to replace it' : 'AIza…'}
              aria-label="Google Gemini key"
              onChange={(e) => setKey(e.target.value)}
            />
            <span className="d-hint">
              Stored encrypted. It is never shown again — only the last four characters.
            </span>
          </div>
          {problem && <ErrorNote>{problem}</ErrorNote>}
          <div className="d-row d-gap-8 d-mt-8">
            {provider.keySource === 'crm' && (
              <button
                type="button"
                className="d-btn d-sm d-danger"
                disabled={busy}
                onClick={() => void clear()}
              >
                {clearing ? 'Tap again to remove the key' : 'Remove the key'}
              </button>
            )}
            <span className="d-grow" />
            <button
              type="button"
              className="d-btn d-primary d-sm"
              disabled={busy || key.trim().length < 10}
              onClick={() => void save()}
            >
              {busy ? 'Checking the key…' : 'Save the key'}
            </button>
          </div>
        </>
      ) : (
        <p className="d-small d-muted d-mt-12">Only an owner or admin can change the key.</p>
      )}
    </section>
  );
}
