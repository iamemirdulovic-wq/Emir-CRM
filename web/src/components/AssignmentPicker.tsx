import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import type { AssignmentChoice, AssignmentMethod, AssignmentPreview, TeamRow, UserRow } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { Avatar, Field, Note, Select, Spinner } from '../design/ui.js';

const METHODS: { value: AssignmentMethod; label: string; hint: string }[] = [
  { value: 'pool', label: 'Shared pool', hint: 'Nobody owns them. Agents press "Claim next lead".' },
  { value: 'agent', label: 'One agent', hint: 'Everything to a single person.' },
  { value: 'team_round_robin', label: 'Round-robin a team', hint: 'Evenly round the team, least loaded first.' },
  { value: 'split_even', label: 'Split evenly', hint: 'Evenly across everyone available.' },
  { value: 'split_percent', label: 'Split by percentage', hint: 'e.g. Sara 40%, Omar 30%, Lina 30%.' },
  { value: 'by_rule', label: 'By rule', hint: 'Route on language, project, emirate or budget.' },
];

/**
 * Choosing who works a batch of leads, with a live preview.
 *
 * The preview matters: it shows each agent's load before and after and warns
 * when someone would end up far above the team average — which is the whole
 * point of showing it before the assignment runs rather than after.
 */
export function AssignmentPicker({
  value, onChange, agents, previewUrl,
}: {
  value: AssignmentChoice;
  onChange: (next: AssignmentChoice) => void;
  agents: UserRow[];
  /** POSTed the choice; returns what it would do. Omit to hide the preview. */
  previewUrl?: string;
}) {
  const teams = useAsync<{ items: TeamRow[] }>(() => api.get('/api/teams'), []);
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const refresh = useCallback(async () => {
    if (!previewUrl) return;
    setPreviewing(true);
    try {
      setPreview(await api.post<AssignmentPreview>(previewUrl, value));
    } catch {
      // A preview that cannot be computed is not worth an error message; the
      // assignment itself will report anything that is actually wrong.
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [previewUrl, value]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shares = value.shares ?? [];
  const clauses = value.clauses ?? [];

  return (
    <>
      <div className="toolbar">
        {METHODS.map((method) => (
          <button
            key={method.value}
            type="button"
            className={value.method === method.value ? 'chip on' : 'chip'}
            onClick={() => onChange({ method: method.value })}
          >
            {method.label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {METHODS.find((method) => method.value === value.method)?.hint}
      </p>

      {value.method === 'agent' && (
        <Field label="Agent">
          <Select
            value={value.userId ?? ''}
            onChange={(event) => onChange({ ...value, userId: event.target.value || null })}
          >
            <option value="">Choose an agent…</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {value.method === 'team_round_robin' && (
        <Field label="Team">
          <Select
            value={value.teamId ?? ''}
            onChange={(event) => onChange({ ...value, teamId: event.target.value || null })}
          >
            <option value="">Everyone</option>
            {(teams.data?.items ?? []).map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} ({team.members.length})
              </option>
            ))}
          </Select>
        </Field>
      )}

      {value.method === 'split_percent' && (
        <>
          <div className="sec-t">Shares</div>
          {agents.map((agent) => {
            const share = shares.find((entry) => entry.userId === agent.id);
            return (
              <div className="catbar" key={agent.id}>
                <span>{agent.name}</span>
                <div className="t">
                  <i style={{ width: `${share?.percent ?? 0}%` }} />
                </div>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  value={share?.percent ?? 0}
                  onChange={(event) => {
                    const percent = Number(event.target.value);
                    const next = shares.filter((entry) => entry.userId !== agent.id);
                    if (percent > 0) next.push({ userId: agent.id, percent });
                    onChange({ ...value, shares: next });
                  }}
                />
              </div>
            );
          })}
          <Note>
            The shares are normalised, so they need not add up to exactly 100. Every lead is assigned:
            leftovers go to the largest shares.
          </Note>
        </>
      )}

      {value.method === 'by_rule' && (
        <>
          <div className="sec-t">Rules, in order — the first match wins</div>
          {clauses.map((clause, index) => (
            <div className="bank" key={index}>
              <span className="ic">{index + 1}</span>
              <div className="two" style={{ flex: 1 }}>
                <Select
                  value={clause.language ?? ''}
                  onChange={(event) => {
                    const next = [...clauses];
                    next[index] = { ...clause, language: event.target.value || undefined };
                    onChange({ ...value, clauses: next });
                  }}
                >
                  <option value="">Any language</option>
                  <option value="ar">Arabic</option>
                  <option value="en">English</option>
                  <option value="ru">Russian</option>
                </Select>
                <Select
                  value={clause.userId}
                  onChange={(event) => {
                    const next = [...clauses];
                    next[index] = { ...clause, userId: event.target.value };
                    onChange({ ...value, clauses: next });
                  }}
                >
                  <option value="">Choose an agent…</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                type="button"
                className="rowbtn"
                onClick={() => onChange({ ...value, clauses: clauses.filter((_unused, i) => i !== index) })}
                aria-label="Remove this rule"
              >
                <Icon name="x" size={15} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn"
            onClick={() => onChange({ ...value, clauses: [...clauses, { userId: agents[0]?.id ?? '' }] })}
          >
            <Icon name="plus" />
            Add a rule
          </button>
          <Note>A lead no rule matches is left unassigned for a person to place.</Note>
        </>
      )}

      {previewUrl && (
        <>
          <div className="sec-t">What this would do</div>
          {previewing && <Spinner label="Working it out…" />}
          {!previewing && preview && (
            <>
              {preview.plan.counts.length === 0 && preview.pooled > 0 && (
                <p className="muted">
                  All {preview.pooled.toLocaleString()} leads go to the shared pool.
                </p>
              )}
              {preview.plan.counts.map((row) => (
                <div className="bank" key={row.userId}>
                  <Avatar name={row.name} size={32} />
                  <div>
                    <b style={{ display: 'block' }}>{row.name}</b>
                    <small className="muted">
                      {row.before} open now → {row.after} after
                    </small>
                  </div>
                  <b>+{row.after - row.before}</b>
                </div>
              ))}
              {preview.unmatched > 0 && (
                <p className="muted">{preview.unmatched} leads match no rule and stay unassigned.</p>
              )}
              {preview.warnings.map((warning) => (
                <p className="err" style={{ display: 'block' }} key={warning.userId}>
                  {warning.name} would be left holding {warning.after} open leads, well above the team
                  average of {warning.average}.
                </p>
              ))}
            </>
          )}
        </>
      )}
    </>
  );
}
