import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Spinner, ErrorNote } from '../design/ui.js';
import { SettingsShell, SettingsTitle } from './settings/Shell.js';

/**
 * Automations: what the CRM does on its own.
 *
 * `docs/v2/pages.md` §40. Everybody may read the list — an agent who sees a
 * message go out wants to know what sent it — and only an owner or admin can
 * move a switch. The server enforces both; this screen only reflects it.
 *
 * Each row shows what it has actually done in the last seven days, because a
 * switch that says "on" and has run nothing is the thing worth noticing.
 */

interface Automation {
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  runs: { running: number; completed: number; cancelled: number; failed: number };
  lastRunAt: string | null;
}

export function V2Automations() {
  const { user } = useAuth();
  const canSwitch = user?.role === 'owner' || user?.role === 'admin';
  const list = useAsync<{ items: Automation[] }>(() => api.get('/api/automations'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function toggle(one: Automation) {
    setBusy(one.key);
    setProblem(null);
    try {
      await api.patch(`/api/automations/${one.key}`, { isActive: !one.isActive });
      list.reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not change.');
    } finally {
      setBusy(null);
    }
  }

  /* Loading and failing happen inside the shell too, so the section list
     does not flash in and out while the page settles. */
  if (list.error) {
    return <SettingsShell page="p-automations"><div className="d-set-body"><ErrorNote>{list.error}</ErrorNote></div></SettingsShell>;
  }
  if (!list.data) {
    return <SettingsShell page="p-automations"><div className="d-set-body"><Spinner /></div></SettingsShell>;
  }

  const on = list.data.items.filter((o) => o.isActive).length;

  /* Inside the settings shell, because `design/web/automations.html` is one
     of the pages behind the Settings nav rather than a screen of its own.
     The page's own content is still the simple list below — the design's
     take-back hero and its grouped switches are a rebuild, not a restyle. */
  return (
    <SettingsShell page="p-automations">
      <div className="d-set-body v2-autos">
        <SettingsTitle
          title="Automations"
          note={`Rules the CRM runs by itself, so no lead is forgotten. ${on} of ${list.data.items.length} running${!canSwitch ? ' · only an owner or admin can change them' : ''}`}
        />

      {problem && <p className="v2-problem">{problem}</p>}

      <ul className="v2-auto-list">
        {list.data.items.map((one) => {
          const did = one.runs.completed + one.runs.failed + one.runs.cancelled;
          return (
            <li key={one.key} className="d-card v2-auto">
              <span className={one.isActive ? 'v2-auto-dot v2-auto-on' : 'v2-auto-dot'} />
              <span className="v2-auto-what">
                <b>{one.name}</b>
                {one.description && <span>{one.description}</span>}
                <span className="v2-auto-runs">
                  {did === 0
                    ? 'Nothing in the last seven days'
                    : `${one.runs.completed} done${one.runs.failed > 0 ? ` · ${one.runs.failed} failed` : ''}${one.runs.running > 0 ? ` · ${one.runs.running} running` : ''} in the last seven days`}
                  {one.lastRunAt && ` · last ${ago(one.lastRunAt)}`}
                </span>
              </span>

              {one.runs.failed > 0 && <span className="d-chip d-red">{one.runs.failed} failed</span>}

              {canSwitch ? (
                <button
                  type="button"
                  className={one.isActive ? 'v2-toggle v2-toggle-on' : 'v2-toggle'}
                  disabled={busy === one.key}
                  aria-label={one.isActive ? `Turn ${one.name} off` : `Turn ${one.name} on`}
                  onClick={() => toggle(one)}
                >
                  <i />
                </button>
              ) : (
                <span className={one.isActive ? 'd-chip d-green' : 'd-chip'}>
                  {one.isActive ? 'On' : 'Off'}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {list.data.items.length === 0 && (
        <div className="v2-empty">
          <span className="v2-empty-mark"><Icon name="zap" /></span>
          <h2>Nothing set up yet</h2>
          <p>The workflows that come with the CRM appear here once they are installed.</p>
        </div>
      )}
      </div>
    </SettingsShell>
  );
}

function ago(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / (60 * 24))} d ago`;
}
