import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatDateTime } from '../lib/format.js';
import type { AutomationRow } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { Empty, ErrorNote, Note, Panel, Spinner, useToast } from '../design/ui.js';

/**
 * The automations control panel.
 *
 * Switching one off stops leads being answered, so only an owner or admin can
 * do it and every change is audited — the switches are simply hidden for
 * everyone else, and the server enforces the same rule regardless.
 */
export function Automations() {
  const { user } = useAuth();
  const toast = useToast();
  const list = useAsync<{ items: AutomationRow[] }>(() => api.get('/api/automations'), []);
  const [busy, setBusy] = useState<string | null>(null);

  const canToggle = user?.role === 'owner' || user?.role === 'admin';

  async function toggle(row: AutomationRow) {
    setBusy(row.key);
    try {
      await api.patch(`/api/automations/${row.key}`, { isActive: !row.isActive });
      toast(row.isActive ? `${row.name} switched off` : `${row.name} switched on`);
      list.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change the automation');
    } finally {
      setBusy(null);
    }
  }

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;
  if (list.loading && !list.data) return <Spinner />;

  const items = list.data?.items ?? [];

  return (
    <div className="dash">
      <Panel span={12} index={0} icon="zap" title="Automations">
        {items.length === 0 && <Empty icon="zap" title="No workflows are configured" />}

        {items.map((row) => (
          <div
            className="bank"
            key={row.key}
            style={{ alignItems: 'flex-start', opacity: row.isActive ? 1 : 0.62 }}
          >
            <span className="ic">
              <Icon name={row.isActive ? 'zap' : 'ban'} />
            </span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: 'block' }}>{row.name}</b>
              {row.description && (
                <small className="muted" style={{ display: 'block' }}>{row.description}</small>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                <span className="pill ok">{row.runs.completed} completed</span>
                {row.runs.running > 0 && <span className="pill info">{row.runs.running} running</span>}
                {row.runs.cancelled > 0 && <span className="pill wait">{row.runs.cancelled} stopped early</span>}
                {row.runs.failed > 0 && <span className="pill due">{row.runs.failed} failed</span>}
                <span className="pill">
                  {row.lastRunAt ? `last ran ${formatDateTime(row.lastRunAt)}` : 'has not run in 7 days'}
                </span>
              </div>
            </div>

            {canToggle ? (
              <button
                type="button"
                className={row.isActive ? 'switch' : 'switch off'}
                role="switch"
                aria-checked={row.isActive}
                aria-label={`${row.isActive ? 'Switch off' : 'Switch on'} ${row.name}`}
                disabled={busy === row.key}
                onClick={() => void toggle(row)}
              />
            ) : (
              <span className={row.isActive ? 'pill ok' : 'pill'}>{row.isActive ? 'On' : 'Off'}</span>
            )}
          </div>
        ))}

        <Note>
          Counts cover the last 7 days. &ldquo;Stopped early&rdquo; is normal: Workflow B cancels itself
          the moment a lead replies. Quiet hours, consent, the do-not-contact list and the
          three-messages-a-day cap apply to every automation here and cannot be switched off.
        </Note>
      </Panel>
    </div>
  );
}
