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
 * Turning the whole rule **off** takes two taps. One tap stops every clock in
 * the CRM, silently, and nothing anywhere else would say so; the design asks
 * for the second tap and names the consequence while it waits.
 *
 * Owner and admin only, on the screen and on every endpoint behind it.
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
  shift: { start: string; end: string; graceMinutes: number };
}

interface TakenBack {
  items: Array<{
    id: string;
    name: string;
    project: string | null;
    isVip: boolean;
    returnedAt: string;
    agentName: string | null;
    source: string | null;
  }>;
}

export function V2Automations() {
  const { user } = useAuth();
  const canSwitch = user?.role === 'owner' || user?.role === 'admin';

  const got = useAsync<Rules>(() => api.get('/api/v2/rules'), []);
  const back = useAsync<TakenBack>(() => api.get('/api/v2/rules/taken-back'), []);

  const [draft, setDraft] = useState<Rules | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** The second tap, for switching the whole take-back rule off. */
  const [askingOff, setAskingOff] = useState(false);
  const toast = useToast();

  useEffect(() => { if (got.data) setDraft(got.data); }, [got.data]);

  /* The design gives the second tap four seconds, then forgets it. */
  useEffect(() => {
    if (!askingOff) return undefined;
    const timer = window.setTimeout(() => setAskingOff(false), 4000);
    return () => window.clearTimeout(timer);
  }, [askingOff]);

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

  const { takeBack, shift } = draft;
  /* The design's sentence quotes the chip's own words — "30 min", not
     "30 minutes" — so the number in the paragraph and the number on the
     button people just pressed are the same string. */
  const vipWords = minuteWords(takeBack.vipMinutes, true);
  const importWords = `${takeBack.importHours} hours`;
  /* "about N working days" — the design computes it from a nine-hour day; the
     real shift is read instead, so an office that opens 10 to 19 is told the
     truth about its own week. */
  const shiftHours = Math.max(1, (mins(shift.end) - mins(shift.start)) / 60);
  const workingDays = Math.ceil(takeBack.importHours / shiftHours);

  function switchTakeBack(on: boolean) {
    if (!on && !askingOff) {
      setAskingOff(true);
      toast('Tap again to turn take-back off. Uncalled leads will stay with agents.');
      return;
    }
    setAskingOff(false);
    void change(
      { takeBack: { enabled: on } },
      on ? 'Take-back is on' : 'Take-back is off',
    );
  }

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
                onChange={(e) => switchTakeBack(e.target.checked)}
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
                    onClick={() => void change(
                      { takeBack: { vipMinutes: n } },
                      `VIP leads go back after ${minuteWords(n, true)}`,
                    )}
                  >
                    {minuteWords(n, true)}
                  </button>
                ))}
              </div>
              <p className="d-small d-muted">
                The agent sees a live countdown and gets a warning 10 min before the end.
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
                    onClick={() => void change(
                      { takeBack: { importHours: n } },
                      `Imported leads go back after ${n} hours`,
                    )}
                  >
                    {n} hours
                  </button>
                ))}
              </div>
              <p className="d-small d-muted">
                Counted in working time. The agent sees the day and hour on the lead, like “goes
                back tomorrow {shift.start}”.
              </p>
            </div>
          </div>

          {/* The clock does not run at night, which is the part people are
              surprised by if nobody tells them. The hours are the office's
              own, not the design's drawn 09:00–18:00. */}
          <div className="d-tb-clock">
            <Icon name="clock" />
            <div className="d-grow">
              <b>The clock stops outside {shift.start} – {shift.end}</b>
              <div className="d-tb-day">
                <span className="d-off" style={{ flex: hoursBefore(shift.start) }} />
                <span className="d-onn" style={{ flex: shiftHours }}>
                  <em style={{ left: `${nowAcross(shift)}%` }} />
                </span>
                <span className="d-off" style={{ flex: hoursAfter(shift.end) }} />
              </div>
              <div className="d-row d-between d-tiny">
                <span>00:00</span>
                <span>{shift.start} · clock runs</span>
                <span>{shift.end} · clock stops</span>
                <span>24:00</span>
              </div>
            </div>
          </div>

          <p className="d-tb-say">
            {takeBack.enabled ? (
              <>
                A VIP lead not called in <b>{vipWords}</b> goes back to Incoming and you get an
                alert. An imported lead not called in <b>{importWords}</b> of working time
                {workingDays > 1 ? ` (about ${workingDays} working days)` : ''} goes back too.
                Notes and history stay with the lead.
              </>
            ) : (
              <>
                Take-back is <b>off</b>. Leads stay with the agent even when nobody calls them.
              </>
            )}
          </p>
        </section>

        {/* ── what it did today ───────────────────────────────────────── */}
        <section className="d-card">
          <div className="d-card-head">
            <h3>Taken back today</h3>
            <Link className="d-card-link" to="/v2/incoming">
              Open Incoming <Icon name="arrow-right" />
            </Link>
          </div>
          {!back.data ? <Spinner /> : back.data.items.length === 0 ? (
            <p className="d-small d-muted">
              {takeBack.enabled
                ? 'Nothing. Every lead given out today was called in time.'
                : 'The rule is off, so nothing goes back.'}
            </p>
          ) : (
            <div className="d-divide">
              {back.data.items.map((one) => {
                const waited = waitMinutes(one.returnedAt);
                return (
                  <Link className="d-list-row" key={one.id} to={`/v2/leads/${one.id}`}>
                    <span className={one.isVip ? 'd-card-icon d-accent' : 'd-card-icon'}>
                      <Icon name={one.isVip ? 'crown' : 'upload'} />
                    </span>
                    <span className="d-grow">
                      <b className="d-bold">{one.name}</b>
                      {one.isVip && <span className="d-vip-tag">VIP</span>}
                      <div className="d-small d-muted">
                        {[
                          one.project ?? 'No project',
                          one.source === 'import' ? 'import' : null,
                          one.agentName
                            ? `${one.agentName} did not call in ${
                              one.isVip ? vipWords : `${takeBack.importHours} h`}`
                            : null,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    </span>
                    <span className="d-small d-muted">{clock(one.returnedAt)}</span>
                    {/* How long it has been sitting in Incoming since. A lead
                        that went back an hour ago and is still free is a
                        different problem from one that went back a minute
                        ago, and the colour is the difference. */}
                    <span className={waited >= 30 ? 'd-chip d-red d-pip' : 'd-chip d-amber d-pip'}>
                      Waits {waited < 60 ? `${waited} min` : `${Math.round(waited / 60)} h`}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

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
        </p>
      </div>
    </SettingsShell>
  );
}

/* ── the day, as a bar ─────────────────────────────────────────────────── */

function mins(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

const hoursBefore = (start: string) => Math.max(0.5, mins(start) / 60);
const hoursAfter = (end: string) => Math.max(0.5, (1440 - mins(end)) / 60);

/** "30 min" / "1 hour" / "2 hours", as the design's chips and sentence write it. */
function minuteWords(n: number, short = false): string {
  if (n < 60) return short ? `${n} min` : `${n} minutes`;
  if (n === 60) return '1 hour';
  return `${n / 60} hours`;
}

/** Where now sits inside the working window. Dubai is UTC+4, no daylight saving. */
function nowAcross(shift: { start: string; end: string }): number {
  const dubai = new Date(Date.now() + 4 * 3600_000);
  const now = dubai.getUTCHours() * 60 + dubai.getUTCMinutes();
  const span = mins(shift.end) - mins(shift.start);
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((now - mins(shift.start)) / span) * 100));
}

function clock(at: string): string {
  const dubai = new Date(new Date(at).getTime() + 4 * 3600_000);
  return `${String(dubai.getUTCHours()).padStart(2, '0')}:${String(dubai.getUTCMinutes()).padStart(2, '0')}`;
}

/** How long a lead has been free since it went back. */
function waitMinutes(returnedAt: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(returnedAt).getTime()) / 60_000));
}
