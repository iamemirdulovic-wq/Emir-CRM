import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.js';
import { Icon } from '../../design/index.js';
import { Avatar, Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { SettingsShell, SettingsTitle } from './Shell.js';

/**
 * Settings → Desks.
 *
 * From `design/web/desks.html`: a desk is a group of agents with one number
 * on it — how many open leads one of them should be carrying — and the screen
 * draws every member's load against that number. An owner can see who is
 * buried without opening anybody's list.
 *
 * The tables are the ones migration 0036 built for this and nothing had used
 * yet (`desks`, `desk_members`, `desks.max_open_leads`). Its comment is
 * explicit that a desk is not a `team`: a team carries a manager and drives
 * the live assignment rules.
 *
 * One honest difference from the design, which says at the foot of the page
 * that "an agent over the limit gets no new leads from Share equally and from
 * imports". **Nothing enforces that yet** — sharing leads out and importing
 * read availability and open-lead counts, not this number. So the note says
 * what is true instead, and the number stays worth setting: it is what turns
 * "Shan has a lot on" into "Shan is 7 over".
 */

interface Member {
  userId: string;
  name: string;
  photoUrl: string | null;
  openLeads: number;
  markedToday: 'office' | 'outside' | null;
}

interface Desk {
  id: string;
  name: string;
  maxOpenLeads: number | null;
  members: Member[];
}

interface Candidate extends Member {
  languages: string[];
  deskIds: string[];
}

interface DeskList {
  items: Desk[];
  agents: Candidate[];
}

/** The four the design offers. The column takes any number. */
const CHOICES = [40, 50, 60, 80];
const DEFAULT_MAX = 60;

/** The widest bar on the screen, so every desk's bars share one scale. */
const SCALE = Math.max(...CHOICES);

export function V2SettingsDesks() {
  const { user } = useAuth();
  const inOffice = user?.role === 'owner' || user?.role === 'admin';
  const got = useAsync<DeskList>(() => api.get('/api/v2/desks'), []);
  const [editing, setEditing] = useState<Desk | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const toast = useToast();

  const desks = got.data?.items ?? [];
  const agents = got.data?.agents ?? [];

  /* Everything the card across the top says, counted once. */
  const summary = useMemo(() => {
    const seen = new Map<string, number>();
    for (const desk of desks) {
      for (const one of desk.members) seen.set(one.userId, (seen.get(one.userId) ?? 0) + 1);
    }
    const over: string[] = [];
    for (const desk of desks) {
      if (desk.maxOpenLeads === null) continue;
      for (const one of desk.members) {
        if (one.openLeads > desk.maxOpenLeads) {
          over.push(`${firstName(one.name)} ${one.openLeads} of ${desk.maxOpenLeads}`);
        }
      }
    }
    const twice = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    return {
      onADesk: seen.size,
      withoutADesk: agents.length - seen.size,
      twice: twice.map((id) => firstName(agents.find((one) => one.userId === id)?.name ?? '')),
      over,
    };
  }, [desks, agents]);

  async function save(desk: Desk | 'new', body: { name: string; maxOpenLeads: number; memberIds: string[] }) {
    setBusy('panel');
    try {
      if (desk === 'new') {
        await api.post('/api/v2/desks', body);
        toast(`${body.name} added · ${body.memberIds.length} ${body.memberIds.length === 1 ? 'agent' : 'agents'}`);
      } else {
        await api.patch(`/api/v2/desks/${desk.id}`, body);
        toast(`${body.name} saved`);
      }
      setEditing(null);
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  /** @param back the way out, offered on the toast. Undoing offers no undo. */
  async function saveMax(desk: Desk, max: number, back: number | null) {
    setBusy(desk.id);
    try {
      await api.patch(`/api/v2/desks/${desk.id}`, { maxOpenLeads: max });
      got.reload();
      toast(
        `${desk.name} · max ${max} open leads per agent`,
        back === null
          ? undefined
          : { action: { label: 'Undo', onClick: () => void saveMax(desk, back, null) } },
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(desk: Desk) {
    if (confirming !== desk.id) { setConfirming(desk.id); return; }
    setBusy(desk.id);
    try {
      await api.del(`/api/v2/desks/${desk.id}`);
      setConfirming(null);
      setEditing(null);
      got.reload();
      /* Adding a desk back under the same name brings the same row back, so
         undo is a real way out rather than a new desk that looks like it. */
      toast(`${desk.name} deleted. The agents keep their leads.`, {
        action: {
          label: 'Undo',
          onClick: () => {
            void api.post('/api/v2/desks', {
              name: desk.name,
              maxOpenLeads: desk.maxOpenLeads,
              memberIds: desk.members.map((one) => one.userId),
            }).then(() => got.reload());
          },
        },
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not delete.');
    } finally {
      setBusy(null);
    }
  }

  if (!inOffice) {
    return (
      <SettingsShell page="p-desks">
        <div className="d-set-body">
          <ErrorNote>Desks are set by the owner.</ErrorNote>
        </div>
      </SettingsShell>
    );
  }
  if (got.error) {
    return (
      <SettingsShell page="p-desks">
        <div className="d-set-body"><ErrorNote>{got.error}</ErrorNote></div>
      </SettingsShell>
    );
  }
  if (!got.data) {
    return <SettingsShell page="p-desks"><div className="d-set-body"><Spinner /></div></SettingsShell>;
  }

  return (
    <SettingsShell page="p-desks">
      <div className="d-set-body">
        {/* `Desks.dc.html` draws the one button as the round `+` in the
            header, not as a bar across the page. On a phone it goes there;
            the computer keeps the button it has always had. */}
        <SettingsTitle
          title="Desks"
          note="Groups of agents. Each desk has a limit of open leads per agent."
          action={{ icon: 'plus', label: 'Add a desk', onClick: () => setEditing('new') }}
        >
          <button type="button" className="d-btn d-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" />Add a desk
          </button>
        </SettingsTitle>

        <div className="d-dk-sum d-card">
          <div>
            <span className="d-label">Desks</span>
            <b className="d-num">{desks.length}</b>
          </div>
          <div>
            <span className="d-label">Agents on a desk</span>
            <div className="d-stat-row">
              <b className="d-num">{summary.onADesk}</b>
              <span className="d-delta">{whoIsWhere(summary)}</span>
            </div>
          </div>
          <div className="d-grow">
            <span className="d-label">Over the limit now</span>
            <div className="d-stat-row">
              <b className={summary.over.length > 0 ? 'd-num d-t-red' : 'd-num'}>{summary.over.length}</b>
              <span className="d-small d-muted">
                {summary.over.length > 0 ? summary.over.join(' · ') : 'Everyone is under the limit'}
              </span>
            </div>
          </div>
          <Link className="d-btn" to="/v2/leads?tab=all">
            <Icon name="repeat" />Move leads
          </Link>
        </div>

        <div className="d-col d-gap-16">
          {desks.map((desk) => (
            <DeskCard
              key={desk.id}
              desk={desk}
              busy={busy === desk.id}
              confirming={confirming === desk.id}
              onMax={(max) => saveMax(desk, max, desk.maxOpenLeads)}
              onEdit={() => setEditing(desk)}
              onDelete={() => remove(desk)}
            />
          ))}
        </div>

        {desks.length === 0 && (
          <div className="d-card">
            <div className="d-empty">
              <span className="d-ic"><Icon name="layout-grid" /></span>
              <b>No desks yet</b>
              <p>Add a desk to set a lead limit for a group of agents.</p>
              <button type="button" className="d-btn d-sm d-primary" onClick={() => setEditing('new')}>
                <Icon name="plus" />Add a desk
              </button>
            </div>
          </div>
        )}

        <p className="d-small d-muted">
          Nothing is blocked by this number yet: sharing leads out and imports do not look at it.
          It is here so you can see who is buried — then move leads, or raise the limit.
        </p>
      </div>

      {editing && (
        <DeskPanel
          desk={editing}
          desks={desks}
          agents={agents}
          busy={busy === 'panel'}
          onClose={() => setEditing(null)}
          onSave={(body) => save(editing, body)}
          onDelete={editing === 'new' ? undefined : () => remove(editing)}
          confirmingDelete={editing !== 'new' && confirming === editing.id}
        />
      )}
    </SettingsShell>
  );
}

/* ── one desk ──────────────────────────────────────────────────────────── */

function DeskCard({
  desk, busy, confirming, onMax, onEdit, onDelete,
}: {
  desk: Desk;
  busy: boolean;
  confirming: boolean;
  onMax: (max: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const open = desk.members.reduce((sum, one) => sum + one.openLeads, 0);
  /* Heaviest first: the person to talk about is at the top of the desk. */
  const members = [...desk.members].sort((a, b) => b.openLeads - a.openLeads);

  return (
    <section className="d-card d-desk">
      <div className="d-desk-top">
        <div className="d-grow">
          <h2>{desk.name}</h2>
          <div className="d-small d-muted d-mt-4">
            {desk.members.length} {desk.members.length === 1 ? 'agent' : 'agents'} · {open} open{' '}
            {open === 1 ? 'lead' : 'leads'}
          </div>
        </div>

        <div className="d-desk-max">
          <span className="d-small d-muted">Max open leads</span>
          <div className="d-seg d-sm">
            {CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                disabled={busy}
                aria-pressed={desk.maxOpenLeads === choice}
                className={desk.maxOpenLeads === choice ? 'd-on' : undefined}
                onClick={() => onMax(choice)}
              >
                {choice}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="d-btn d-sm" onClick={onEdit}>
          <Icon name="pencil" />Edit
        </button>
        <button type="button" className="d-btn d-sm d-danger" disabled={busy} onClick={onDelete}>
          {confirming ? 'Tap again to delete' : 'Delete'}
        </button>
      </div>

      {desk.maxOpenLeads === null && (
        <p className="d-small d-muted d-mt-8">
          No limit set for this desk. Choose one above.
        </p>
      )}

      <div className="d-desk-grid">
        {members.map((one) => {
          const over = desk.maxOpenLeads !== null && one.openLeads > desk.maxOpenLeads;
          return (
            <div className={over ? 'd-dm d-over' : 'd-dm'} key={one.userId}>
              <Face member={one} />
              <span className="d-nm">{firstName(one.name)}</span>
              <div
                className={over ? 'd-bar d-load d-red' : 'd-bar d-load'}
                style={{
                  '--v': `${Math.min(100, (one.openLeads / SCALE) * 100)}%`,
                  '--max': `${((desk.maxOpenLeads ?? SCALE) / SCALE) * 100}%`,
                } as React.CSSProperties}
              >
                <i />
              </div>
              <span className="d-v">
                <b>{one.openLeads}</b>{desk.maxOpenLeads === null ? ' open' : ` / ${desk.maxOpenLeads}`}
              </span>
            </div>
          );
        })}
      </div>

      {desk.members.length === 0 && (
        <p className="d-small d-muted d-mt-8">Nobody on this desk yet.</p>
      )}
    </section>
  );
}

/* ── the panel ─────────────────────────────────────────────────────────── */

function DeskPanel({
  desk, desks, agents, busy, confirmingDelete, onClose, onSave, onDelete,
}: {
  desk: Desk | 'new';
  desks: Desk[];
  agents: Candidate[];
  busy: boolean;
  confirmingDelete: boolean;
  onClose: () => void;
  onSave: (body: { name: string; maxOpenLeads: number; memberIds: string[] }) => void;
  onDelete?: () => void;
}) {
  const making = desk === 'new';
  const [name, setName] = useState(making ? '' : desk.name);
  const [max, setMax] = useState(making ? DEFAULT_MAX : desk.maxOpenLeads ?? DEFAULT_MAX);
  const [chosen, setChosen] = useState<string[]>(
    making ? [] : desk.members.map((one) => one.userId),
  );
  const [touched, setTouched] = useState(false);

  const taken = desks
    .filter((one) => making || one.id !== desk.id)
    .some((one) => one.name.trim().toLowerCase() === name.trim().toLowerCase());

  const problems: Record<string, string> = {};
  if (name.trim().length < 2) problems.name = 'Write a desk name.';
  else if (taken) problems.name = 'There is already a desk with this name.';
  if (chosen.length === 0) problems.members = 'Choose at least one agent.';
  const show = (key: string) => (touched ? problems[key] : undefined);

  function toggle(userId: string) {
    setChosen((was) => (was.includes(userId) ? was.filter((id) => id !== userId) : [...was, userId]));
  }

  return (
    <>
      <div className="v2-panel-back" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label="Desk">
        <div className="d-panel-head">
          <h2>{making ? 'New desk' : `Edit ${desk.name}`}</h2>
          <button
            type="button"
            className="d-btn d-icon d-sm d-ghost"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-16">
          <div className="d-field">
            <label htmlFor="desk-name">Desk name <span className="d-req">*</span></label>
            <input
              id="desk-name"
              className="d-input"
              value={name}
              placeholder="Russian desk"
              onChange={(e) => setName(e.target.value)}
            />
            {show('name') && <span className="v2-field-error">{show('name')}</span>}
          </div>

          <div className="d-field">
            <span className="d-field-label">Max open leads per agent</span>
            <div className="d-seg d-block">
              {CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={max === choice}
                  className={max === choice ? 'd-on' : undefined}
                  onClick={() => setMax(choice)}
                >
                  {choice}
                </button>
              ))}
            </div>
            <span className="d-hint">Above this number the bar turns red on this screen.</span>
          </div>

          <div className="d-field">
            <span className="d-field-label">
              Members <span className="d-muted">· {chosen.length} chosen</span>
            </span>
            <div className="d-opt-list">
              {agents.map((one) => {
                const on = chosen.includes(one.userId);
                const elsewhere = desks
                  .filter((d) => (making || d.id !== desk.id) && d.members.some((m) => m.userId === one.userId))
                  .map((d) => d.name);
                return (
                  <button
                    type="button"
                    key={one.userId}
                    className={on ? 'd-opt d-on' : 'd-opt'}
                    aria-pressed={on}
                    onClick={() => toggle(one.userId)}
                  >
                    <Face member={one} />
                    <span className="d-grow">
                      <b className="d-bold">{one.name}</b>
                      <div className="d-small d-muted d-truncate">
                        {elsewhere.length > 0
                          ? `${on ? 'Also on ' : 'On '}${elsewhere.join(', ')}`
                          : one.languages.length > 0
                            ? one.languages.join(', ')
                            : 'No desk yet'}
                      </div>
                    </span>
                    <span className="d-small d-muted">{one.openLeads} open</span>
                  </button>
                );
              })}
            </div>
            {show('members') && <span className="v2-field-error">{show('members')}</span>}
            {agents.length === 0 && (
              <span className="d-hint">Nobody to put on a desk yet. Add people in Team and roles.</span>
            )}
          </div>
        </div>

        <div className="d-panel-foot">
          {onDelete && (
            <button type="button" className="d-btn d-danger" disabled={busy} onClick={onDelete}>
              {confirmingDelete ? 'Tap again to delete' : 'Delete desk'}
            </button>
          )}
          <span className="d-grow" />
          <button type="button" className="d-btn d-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="d-btn d-primary"
            disabled={busy}
            onClick={() => {
              setTouched(true);
              if (Object.keys(problems).length > 0) return;
              onSave({ name: name.trim(), maxOpenLeads: max, memberIds: chosen });
            }}
          >
            {busy ? 'Saving…' : 'Save desk'}
          </button>
        </div>
      </aside>
    </>
  );
}

/* ── small things ──────────────────────────────────────────────────────── */

/** The avatar with the ring that says where somebody is today. */
function Face({ member }: { member: Member }) {
  const kind = member.markedToday === 'outside' ? 'outside' : member.markedToday === 'office' ? 'office' : 'none';
  return (
    <span className={`v2-face v2-face-${kind}`}>
      <Avatar name={member.name} src={member.photoUrl ?? undefined} size={28} />
    </span>
  );
}

/**
 * First names only.
 *
 * The design's grid gives the name 76px, and this team has names like
 * "Tejeshwar Singh Solanki" — a surname in that column is three dots.
 */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function whoIsWhere(summary: { twice: string[]; withoutADesk: number }): string {
  if (summary.twice.length > 2) return `${summary.twice.length} agents sit on 2 desks`;
  if (summary.twice.length > 0) {
    return `${summary.twice.join(', ')} ${summary.twice.length === 1 ? 'sits' : 'sit'} on 2`;
  }
  if (summary.withoutADesk > 0) return `${summary.withoutADesk} with no desk`;
  return 'One desk each';
}
