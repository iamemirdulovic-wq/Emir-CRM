import { useEffect, useState } from 'react';
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
 * Ported from `design/web/ai-settings.html`: this month's spend against the
 * limit with a forecast, the limit itself, where the money went by feature,
 * what Homes AI may do, and the text it is told about the company.
 *
 * The forecast is the part worth getting right. "$38 of $100" on day 11 is
 * fine; "$38 of $100 — about $104 by the 30th" is a decision. It is straight
 * arithmetic on the days elapsed, and it is labelled as a projection rather
 * than dressed up as a prediction.
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
  'best-time': 'Best time to call',
  knowledge: 'Company text',
  describe: 'Project descriptions',
  classify: 'Reading messages',
};

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
  const share = capUsd > 0 ? Math.min(100, (spentUsd / capUsd) * 100) : 0;

  /* Where the month is, so the forecast can be honest about how little it
     knows on the 2nd. */
  const now = new Date(Date.now() + 4 * 3600_000);
  const day = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const forecast = day >= 3 ? (spentUsd / day) * daysInMonth : null;
  const month = now.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });

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

  const biggest = Math.max(1, ...usage.byFeature.map((one) => one.micros));

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
                  <b className="d-num-hero">${usage.spentUsd}</b>
                  <span className="d-num-sm d-muted">of ${usage.capUsd}</span>
                </div>
              </div>
              <span className="d-hero-chip">
                {capUsd === 0
                  ? 'No limit'
                  : forecast === null
                    ? 'Early in the month'
                    : forecast > capUsd ? 'Over at this speed' : 'On track'}
              </span>
            </div>
            <div className="d-ai-bar d-mt-16">
              <i style={{ width: `${share}%` }} />
            </div>
            <div className="d-row d-between d-small d-muted d-mt-8">
              <span>Day {day} of {daysInMonth}</span>
              <span>
                {forecast === null
                  ? `${usage.calls} request${usage.calls === 1 ? '' : 's'} so far`
                  : `At this speed: about $${forecast.toFixed(0)} by the end of the month`}
              </span>
            </div>
            <div className="d-card-foot">
              <Icon name="info" />
              <span>
                {capUsd === 0
                  ? 'There is no limit set, so Homes AI will keep answering whatever it costs.'
                  : 'At the limit Homes AI pauses until the 1st. The CRM keeps working.'}
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
                  onClick={() => void change({ capUsd: one }, `Limit set to $${one} a month`)}
                >
                  ${one}
                </button>
              ))}
            </div>

            <div className="d-col d-gap-8 d-mt-16">
              {usage.byFeature.length === 0 && (
                <p className="d-small d-muted">
                  Nothing spent yet this month, so there is nothing to break down.
                </p>
              )}
              {usage.byFeature.map((one) => (
                <div className="d-hbar" key={one.feature}>
                  <span>{FEATURE_NAMES[one.feature] ?? one.feature}</span>
                  <div className="d-bar" style={{ '--v': `${(one.micros / biggest) * 100}%` } as React.CSSProperties}>
                    <i />
                  </div>
                  <b>${one.usd}</b>
                </div>
              ))}
            </div>
            <div className="d-card-foot">Owners are told at 80% and at 100%</div>
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

/* ── what Homes AI is told about the company ───────────────────────────── */

interface Knowledge {
  sections: Array<{ section: string; title: string; content: string; language: string }>;
}

/**
 * The brokerage's own words, which go into every answer.
 *
 * The design shows one box. The CRM stores this in named sections, so each one
 * gets its own box with the same wording underneath — the warning about
 * passwords and client details is the part that matters and it is repeated
 * once rather than per box.
 */
function Knowledge({ canEdit }: { canEdit: boolean }) {
  const got = useAsync<Knowledge>(() => api.get('/api/ai/knowledge'), []);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (got.data) {
      setDraft(Object.fromEntries(got.data.sections.map((one) => [one.section, one.content])));
    }
  }, [got.data]);

  if (!got.data) return null;

  async function save(section: string, language: string) {
    setBusy(section);
    try {
      await api.put(`/api/ai/knowledge/${section}`, { content: draft[section] ?? '', language });
      toast('Homes AI will use this from now on');
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="d-card">
      <div className="d-card-head"><h3>What Homes AI should know about us</h3></div>
      {got.data.sections.map((one) => {
        const value = draft[one.section] ?? '';
        const changed = value !== one.content;
        return (
          <div className="d-field" key={one.section}>
            <label>{one.title}</label>
            <textarea
              className="d-textarea v2-ai-know"
              value={value}
              disabled={!canEdit}
              aria-label={one.title}
              onChange={(e) => setDraft((was) => ({ ...was, [one.section]: e.target.value }))}
            />
            {canEdit && (
              <div className="d-row d-mt-8">
                <span className="d-small d-muted d-grow">{value.length} characters</span>
                <button
                  type="button"
                  className="d-btn d-sm d-primary"
                  disabled={!changed || busy === one.section}
                  onClick={() => void save(one.section, one.language)}
                >
                  {busy === one.section ? 'Saving…' : 'Save text'}
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
  );
}
