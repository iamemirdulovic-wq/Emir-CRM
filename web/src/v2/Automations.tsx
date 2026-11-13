import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Spinner, ErrorNote, useToast } from '../design/ui.js';
import { SettingsShell, SettingsSwitch, SettingsTitle } from './settings/Shell.js';

/**
 * Automations: what the CRM does on its own.
 *
 * Built from `design/web/automations.html`, which gives the take-back rule the
 * whole top of the page and everything else a switch underneath. That is the
 * right weight: the take-back rule is the only one that takes a lead *away*
 * from somebody, and the agent it takes it from finds out by the lead
 * vanishing. So it shows both its clocks, the hours they run in, and a plain
 * sentence of what it will do — and then what it actually did today.
 *
 * Everyone may read this page. Only an owner or admin may move a switch, and
 * the server enforces that as well as the screen.
 */

interface TakeBack {
  enabled: boolean;
  vipMinutes: number;
  importHours: number;
}

interface Rules {
  takeBack: TakeBack;
  rules: Record<string, boolean>;
  groups: Array<{ key: string; title: string; rules: Array<{ key: string; title: string; note: string }> }>;
  vipChoices: number[];
  importChoices: number[];
}

interface TakenBack {
  items: Array<{
    id: string;
    name: string;
    project: string | null;
    isVip: boolean;
    returnedAt: string;
    agentName: string | null;
  }>;
}

interface Shift {
  start: string;
  end: string;
  graceMinutes: number;
}

export function V2Automations() {
  const { user } = useAuth();
  const canSwitch = user?.role === 'owner' || user?.role === 'admin';
  const seesTeam = canSwitch || user?.role === 'manager';

  const got = useAsync<Rules>(() => api.get('/api/v2/rules'), []);
  const back = useAsync<TakenBack>(
    () => (seesTeam ? api.get('/api/v2/rules/taken-back') : Promise.resolve({ items: [] })),
    [seesTeam],
  );
  const shift = useAsync<Shift>(() => api.get('/api/attendance/settings'), []);

  const [draft, setDraft] = useState<Rules | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => { if (got.data) setDraft(got.data); }, [got.data]);

  async function change(patch: Record<string, unknown>, say?: string) {
    if (!draft) return;
    const before = draft;
    try {
      const saved = await api.patch<Rules>('/api/v2/rules', patch);
      setDraft(saved);
      if (say) toast(say);
    } catch (err) {
      setDraft(before);
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    }
  }

  if (got.error) {
    return (
      <SettingsShell page="p-automations">
        <div className="d-set-body"><ErrorNote>{got.error}</ErrorNote></div>
      </SettingsShell>
    );
  }
  if (!draft) {
    return (
      <SettingsShell page="p-automations">
        <div className="d-set-body"><Spinner /></div>
      </SettingsShell>
    );
  }

  const { takeBack } = draft;

  return (
    <SettingsShell page="p-automations">
      <div className="d-set-body">
        <SettingsTitle
          title="Automations"
          note="Rules the CRM runs by itself, so no lead is forgotten."
        />

        {/* ── the take-back rule ──────────────────────────────────────── */}
        <section className="d-card d-hero d-take">
          <div className="d-row d-gap-16 d-top">
            <span className="d-arow-ic d-accent v2-take-ic"><Icon name="undo-2" /></span>
            <div className="d-grow">
              <h2>Take-back rule</h2>
              <p className="d-muted d-small d-mt-4">
                A lead that nobody calls goes back to Incoming, and you are told.
              </p>
            </div>
            <label className="d-switch v2-take-switch">
              <input
                type="checkbox"
                checked={takeBack.enabled}
                disabled={!canSwitch}
                aria-label="The take-back rule"
                onChange={(e) => void change(
                  { takeBack: { enabled: e.target.checked } },
                  e.target.checked
                    ? 'The take-back rule is on'
                    : 'Off. No lead is taken back from anybody.',
                )}
              />
              <span className="d-track" />
              <span>{takeBack.enabled ? 'On' : 'Off'}</span>
            </label>
          </div>

          <div className={takeBack.enabled ? 'd-tb-grid' : 'd-tb-grid d-off'}>
            <div className="d-tb-box">
              <div className="d-row d-gap-8">
                <span className="d-vip-tag">VIP</span>
                <b>VIP lead</b>
              </div>
              <div className="d-tb-num">
                <b>{takeBack.vipMinutes < 60 ? takeBack.vipMinutes : takeBack.vipMinutes / 60}</b>
                <span>{takeBack.vipMinutes < 60 ? 'min' : takeBack.vipMinutes === 60 ? 'hour' : 'hours'}</span>
              </div>
              <div className="d-chips">
                {draft.vipChoices.map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={!canSwitch || !takeBack.enabled}
                    className={takeBack.vipMinutes === n ? 'd-chip-opt d-on' : 'd-chip-opt'}
                    onClick={() => void change({ takeBack: { vipMinutes: n } }, 'Saved')}
                  >
                    {n < 60 ? `${n} min` : n === 60 ? '1 hour' : `${n / 60} hours`}
                  </button>
                ))}
              </div>
              <p className="d-small d-muted">
                The agent sees a live countdown and a warning before the end.
              </p>
            </div>

            <div className="d-tb-box">
              <div className="d-row d-gap-8">
                <Icon name="upload" />
                <b>Imported lead</b>
              </div>
              <div className="d-tb-num">
                <b>{takeBack.importHours}</b>
                <span>hours</span>
              </div>
              <div className="d-chips">
                {draft.importChoices.map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={!canSwitch || !takeBack.enabled}
                    className={takeBack.importHours === n ? 'd-chip-opt d-on' : 'd-chip-opt'}
                    onClick={() => void change({ takeBack: { importHours: n } }, 'Saved')}
                  >
                    {n} hours
                  </button>
                ))}
              </div>
              <p className="d-small d-muted">
                Counted in working time, so the agent sees a day and an hour rather than a
                countdown.
              </p>
            </div>
          </div>

          {/* The clock does not run at night, which is the part people are
              surprised by if nobody tells them. */}
          {shift.data && (
            <div className="d-tb-clock">
              <Icon name="clock" />
              <div className="d-grow">
                <b>The clock stops outside {shift.data.start} – {shift.data.end}</b>
                <div className="d-tb-day">
                  <span className="d-off" style={{ flex: hoursBefore(shift.data.start) }} />
                  <span className="d-onn" style={{ flex: hoursOpen(shift.data) }}>
                    <em style={{ left: `${nowAcross(shift.data)}%` }} />
                  </span>
                  <span className="d-off" style={{ flex: hoursAfter(shift.data.end) }} />
                </div>
                <div className="d-row d-between d-tiny">
                  <span>00:00</span>
                  <span>{shift.data.start} · clock runs</span>
                  <span>{shift.data.end} · clock stops</span>
                  <span>24:00</span>
                </div>
              </div>
            </div>
          )}

          <p className="d-tb-say">
            {takeBack.enabled
              ? `A VIP lead not called in ${
                takeBack.vipMinutes < 60 ? `${takeBack.vipMinutes} minutes` : `${takeBack.vipMinutes / 60} hour${takeBack.vipMinutes > 60 ? 's' : ''}`
              } goes back to Incoming. An imported lead has ${takeBack.importHours} working hours.`
              : 'Nothing is taken back from anybody. A lead stays with its agent however long it sits.'}
          </p>
        </section>

        {/* ── what it did today ───────────────────────────────────────── */}
        {seesTeam && back.data && (
          <section className="d-card">
            <div className="d-card-head">
              <h3>Taken back today</h3>
              <Link className="d-card-link" to="/v2/incoming">
                Open Incoming <Icon name="arrow-right" />
              </Link>
            </div>
            {back.data.items.length === 0 ? (
              <p className="d-small d-muted">
                {takeBack.enabled
                  ? 'Nothing. Every lead given out today was called in time.'
                  : 'The rule is off, so nothing goes back.'}
              </p>
            ) : (
              <div className="d-divide">
                {back.data.items.map((one) => (
                  <Link className="d-list-row" key={one.id} to={`/v2/leads/${one.id}`}>
                    <span className={one.isVip ? 'd-card-icon d-accent' : 'd-card-icon'}>
                      <Icon name={one.isVip ? 'crown' : 'upload'} />
                    </span>
                    <span className="d-grow">
                      <b className="d-bold">{one.name}</b>
                      {one.isVip && <span className="d-vip-tag">VIP</span>}
                      <div className="d-small d-muted">
                        {one.project ?? 'No project'}
                        {one.agentName ? ` · ${one.agentName} did not call in time` : ''}
                      </div>
                    </span>
                    <span className="d-small d-muted">{clock(one.returnedAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── the rest ────────────────────────────────────────────────── */}
        {draft.groups.map((group) => {
          const on = group.rules.filter((rule) => draft.rules[rule.key]).length;
          return (
            <section className="d-card" key={group.key}>
              <div className="d-card-head">
                <h4 className="d-grow">{group.title}</h4>
                <span className="d-small d-muted">{on} of {group.rules.length} on</span>
              </div>
              <div>
                {group.rules.map((rule) => (
                  <SettingsSwitch
                    key={rule.key}
                    title={rule.title}
                    note={rule.note}
                    on={draft.rules[rule.key] ?? false}
                    disabled={!canSwitch}
                    onChange={(next) => void change(
                      { rules: { [rule.key]: next } },
                      `${rule.title} · ${next ? 'on' : 'off'}`,
                    )}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {problem && <ErrorNote>{problem}</ErrorNote>}

        <p className="d-small d-muted">
          Times come from <Link className="d-link" to="/v2/settings/attendance">Attendance rules</Link>.
          Every change here is saved at once and written in the activity log.
          {!canSwitch && ' Only an owner or admin can change them.'}
        </p>
      </div>
    </SettingsShell>
  );
}

/* ── the day, as a bar ─────────────────────────────────────────────────── */

function minutes(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

const hoursBefore = (start: string) => Math.max(0.5, minutes(start) / 60);
const hoursAfter = (end: string) => Math.max(0.5, (1440 - minutes(end)) / 60);
const hoursOpen = (shift: Shift) => Math.max(1, (minutes(shift.end) - minutes(shift.start)) / 60);

/** Where now sits inside the working window. Dubai is UTC+4, no daylight saving. */
function nowAcross(shift: Shift): number {
  const dubai = new Date(Date.now() + 4 * 3600_000);
  const now = dubai.getUTCHours() * 60 + dubai.getUTCMinutes();
  const span = minutes(shift.end) - minutes(shift.start);
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((now - minutes(shift.start)) / span) * 100));
}

function clock(at: string): string {
  const dubai = new Date(new Date(at).getTime() + 4 * 3600_000);
  return `${String(dubai.getUTCHours()).padStart(2, '0')}:${String(dubai.getUTCMinutes()).padStart(2, '0')}`;
}
