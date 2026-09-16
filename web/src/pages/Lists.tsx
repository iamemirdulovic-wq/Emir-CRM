import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, qs } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { humanize } from '../lib/format.js';
import type {
  AssignmentChoice, ListMemberRow, ListRow, StageKey, UserRow,
} from '../lib/types.js';
import { Icon } from '../design/index.js';
import { stageStyle } from '../design/stages.js';
import {
  Avatar, Chip, Empty, ErrorNote, Field, Note, Panel, Score, Select, Spinner, TextArea, Toolbar,
  useToast,
} from '../design/ui.js';
import { AssignmentPicker } from '../components/AssignmentPicker.js';

const STAGES: StageKey[] = [
  'new_lead', 'attempted_contact', 'engaged_qualified',
  'appointment_scheduled', 'deal_sent', 'won', 'lost',
];

/** Saved and smart lists. */
export function Lists() {
  const { user } = useAuth();
  const toast = useToast();
  const list = useAsync<{ items: ListRow[] }>(() => api.get('/api/lists'), []);
  const [creating, setCreating] = useState(false);

  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;

  const items = list.data?.items ?? [];

  return (
    <>
      <Toolbar
        right={
          isManager ? (
            <>
              <Link className="btn" to="/imports">
                <Icon name="upload" />
                <span>Import</span>
              </Link>
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Icon name="plus" />
                <span>New list</span>
              </button>
            </>
          ) : undefined
        }
      >
        <Chip on icon="list">
          Lists
        </Chip>
      </Toolbar>

      {creating && (
        <Panel span={12} index={0} icon="plus" title="New list">
          <NewList onDone={() => { setCreating(false); list.reload(); }} />
        </Panel>
      )}

      <div className="dash">
        {list.loading && items.length === 0 && (
          <Panel span={12} index={1}>
            <Spinner />
          </Panel>
        )}
        {!list.loading && items.length === 0 && (
          <Panel span={12} index={1}>
            <Empty
              icon="list"
              title="No lists yet"
              hint="A list is how you work a group of leads — by phone, or by WhatsApp campaign."
            />
          </Panel>
        )}

        {items.map((row, index) => (
          <Panel span={4} index={index + 1} key={row.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name={row.kind === 'smart' ? 'zap' : 'list'} style={{ color: 'var(--primary)' }} />
              <b style={{ fontSize: 15 }}>{row.name}</b>
              <span className={row.kind === 'smart' ? 'pill info' : 'pill'} style={{ marginInlineStart: 'auto' }}>
                {row.kind === 'smart' ? 'Smart' : 'Saved'}
              </span>
            </div>
            {row.description && <p className="muted" style={{ fontSize: 13 }}>{row.description}</p>}
            <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>{row.summary}</p>
            {row.recycle_after_days && (
              <p className="pill wait" style={{ marginBottom: 12 }}>
                Recycles after {row.recycle_after_days} days
              </p>
            )}
            <div className="two">
              <Link className="btn" to={`/lists/${row.id}`}>
                Open
              </Link>
              <Link className="btn btn-primary" to={`/campaigns?list=${row.id}`}>
                <Icon name="phone" />
                Work it
              </Link>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}

function NewList({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'static' | 'smart'>('smart');
  const [stages, setStages] = useState<StageKey[]>([]);
  const [minScore, setMinScore] = useState(0);
  const [notContactedForDays, setNotContacted] = useState(0);
  const [consentOnly, setConsentOnly] = useState(false);
  const [recycleAfterDays, setRecycle] = useState(0);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await api.post('/api/lists', {
        name,
        description: description || null,
        kind,
        filters:
          kind === 'smart'
            ? {
                ...(stages.length ? { stages } : {}),
                ...(minScore > 0 ? { minScore } : {}),
                ...(notContactedForDays > 0 ? { notContactedForDays } : {}),
                ...(consentOnly ? { hasWhatsAppConsent: true } : {}),
                excludeDnc: true,
              }
            : undefined,
        recycleAfterDays: recycleAfterDays > 0 ? recycleAfterDays : null,
        recycleAction: recycleAfterDays > 0 ? 'pool' : null,
      });
      toast('List created');
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the list');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="two">
        <Field label="Name">
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={(event) => setKind(event.target.value as 'static' | 'smart')}>
            <option value="smart">Smart — fills itself from a filter</option>
            <option value="static">Saved — you add people to it</option>
          </Select>
        </Field>
      </div>
      <Field label="Description">
        <input className="input" value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>

      {kind === 'smart' && (
        <>
          <div className="sec-t">Who is on it</div>
          <div className="toolbar">
            {STAGES.map((stage) => (
              <Chip
                key={stage}
                on={stages.includes(stage)}
                onClick={() =>
                  setStages(stages.includes(stage) ? stages.filter((s) => s !== stage) : [...stages, stage])
                }
              >
                {humanize(stage)}
              </Chip>
            ))}
          </div>
          <div className="two">
            <Field label="Lead score at least">
              <input className="input" type="number" min={0} max={100} value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} />
            </Field>
            <Field label="Not contacted for (days)" hint="0 to ignore">
              <input className="input" type="number" min={0} value={notContactedForDays} onChange={(event) => setNotContacted(Number(event.target.value))} />
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={consentOnly} onChange={(event) => setConsentOnly(event.target.checked)} />
            Only contacts with WhatsApp consent
          </label>
          <Note>
            Do-not-contact is always excluded. A smart list is evaluated when you open it, so it stays
            current on its own.
          </Note>
        </>
      )}

      <Field label="Return untouched leads to the pool after (days)" hint="0 to never recycle">
        <input className="input" type="number" min={0} value={recycleAfterDays} onChange={(event) => setRecycle(Number(event.target.value))} />
      </Field>

      <div className="two">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || !name} onClick={() => void create()}>
          Create
        </button>
      </div>
    </>
  );
}

/* ── One list, with bulk actions ──────────────────────────────────────── */

export function ListDetail() {
  const { id = '' } = useParams();
  const { user, can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<'assign' | 'tag' | null>(null);
  const [tick, setTick] = useState(0);

  const members = useAsync<{ items: ListMemberRow[]; total: number }>(
    () => api.get(`/api/lists/${id}/members${qs({ limit: 200 })}`),
    [id, tick],
  );
  const lists = useAsync<{ items: ListRow[] }>(() => api.get('/api/lists'), []);
  const team = useAsync<{ items: UserRow[] }>(() => api.get('/api/users'), []);

  const list = lists.data?.items.find((row) => row.id === id);
  const items = members.data?.items ?? [];
  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';

  function toggle(contactId: string) {
    const next = new Set(selected);
    if (next.has(contactId)) next.delete(contactId);
    else next.add(contactId);
    setSelected(next);
  }

  async function bulk(action: Record<string, unknown>) {
    try {
      const result = await api.post<{ affected: number }>('/api/lists/bulk', {
        contactIds: [...selected],
        action,
      });
      toast(`${result.affected} contacts updated`);
      setSelected(new Set());
      setActing(null);
      setTick((value) => value + 1);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not apply that');
    }
  }

  if (members.error) return <ErrorNote>{members.error}</ErrorNote>;

  return (
    <>
      <Toolbar
        right={
          <>
            {can('export') && (
              <a className="btn" href={`/api/lists/${id}/export.csv`}>
                <Icon name="download" />
                <span>Export</span>
              </a>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate(`/campaigns?list=${id}`)}
            >
              <Icon name="phone" />
              <span>Start a campaign</span>
            </button>
          </>
        }
      >
        <Link className="chip" to="/lists">
          <Icon name="arrow-left" />
          All lists
        </Link>
        {list && <span className="pill info">{list.kind === 'smart' ? 'Smart list' : 'Saved list'}</span>}
      </Toolbar>

      {selected.size > 0 && isManager && (
        <Panel span={12} index={0} icon="users-round" title={`${selected.size} selected`}>
          <div className="toolbar">
            <Chip on={acting === 'assign'} icon="users" onClick={() => setActing(acting === 'assign' ? null : 'assign')}>
              Assign
            </Chip>
            <Chip on={acting === 'tag'} icon="target" onClick={() => setActing(acting === 'tag' ? null : 'tag')}>
              Add a tag
            </Chip>
            <Chip icon="x" onClick={() => setSelected(new Set())}>
              Clear
            </Chip>
          </div>

          {acting === 'assign' && (
            <BulkAssign
              agents={(team.data?.items ?? []).filter((row) => row.role === 'agent' && row.is_active === 1)}
              onApply={(choice) => void bulk({ kind: 'assign', ...choice })}
            />
          )}
          {acting === 'tag' && <BulkTag onApply={(tag) => void bulk({ kind: 'add_tag', tag })} />}
        </Panel>
      )}

      <Panel
        index={1}
        icon="list"
        title={`${list?.name ?? 'List'} — ${members.data?.total.toLocaleString() ?? 0} contacts`}
      >
        {members.loading && items.length === 0 && <Spinner />}
        {!members.loading && items.length === 0 && (
          <Empty icon="users" title="Nobody on this list yet" />
        )}

        {items.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {isManager && (
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select every contact shown"
                        checked={selected.size === items.length && items.length > 0}
                        onChange={(event) =>
                          setSelected(event.target.checked ? new Set(items.map((row) => row.contact_id)) : new Set())
                        }
                      />
                    </th>
                  )}
                  <th>Name</th>
                  <th>Stage</th>
                  <th>Project</th>
                  <th>Owner</th>
                  <th>Score</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.contact_id}>
                    {isManager && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.full_name ?? 'contact'}`}
                          checked={selected.has(row.contact_id)}
                          onChange={() => toggle(row.contact_id)}
                        />
                      </td>
                    )}
                    <td>
                      <div className="rank">
                        <Avatar name={row.full_name} size={26} />
                        <div style={{ minWidth: 0 }}>
                          <Link to={`/contacts/${row.contact_id}`} style={{ fontWeight: 600, color: 'var(--ink)' }}>
                            {row.full_name ?? 'Unnamed'}
                          </Link>
                          <div className="muted" style={{ fontSize: 12 }}>{row.phone_e164 ?? row.email ?? '—'}</div>
                        </div>
                        {row.dnc === 1 && <span className="pill due">DNC</span>}
                      </div>
                    </td>
                    <td>
                      {row.stage_key ? (
                        <span className="pill" style={{ color: stageStyle(row.stage_key).colour, borderColor: 'transparent' }}>
                          {humanize(row.stage_key)}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{row.project_name ?? <span className="muted">—</span>}</td>
                    <td>{row.owner_name ?? <span className="muted">Pool</span>}</td>
                    <td>
                      <Score value={row.lead_score} />
                    </td>
                    <td>
                      <Link className="rowbtn" to={`/inbox?contact=${row.contact_id}`}>
                        Open thread
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function BulkAssign({
  agents, onApply,
}: { agents: UserRow[]; onApply: (choice: AssignmentChoice) => void }) {
  const [choice, setChoice] = useState<AssignmentChoice>({ method: 'split_even' });
  return (
    <>
      <AssignmentPicker value={choice} onChange={setChoice} agents={agents} />
      <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => onApply(choice)}>
        Assign them
      </button>
    </>
  );
}

function BulkTag({ onApply }: { onApply: (tag: string) => void }) {
  const [tag, setTag] = useState('');
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <Field label="Tag" hint="Use namespace:value, e.g. proj:beachfront">
        <input className="input" value={tag} onChange={(event) => setTag(event.target.value)} />
      </Field>
      <button type="button" className="btn btn-primary" disabled={!tag} onClick={() => onApply(tag)}>
        Add
      </button>
    </div>
  );
}
