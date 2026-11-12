import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.js';
import { Icon } from '../../design/index.js';
import { Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { SaveBar, SettingsRow, SettingsShell, SettingsSwitch, SettingsTitle } from './Shell.js';

/**
 * Settings → Attendance rules.
 *
 * Ported from `design/web/settings-attendance.html`: the office network, the
 * shift with its visual bar, the days off, working outside, calls, and the
 * monthly report.
 *
 * One deliberate difference from the design, and it is not a shortcut. The
 * design asks for the office *Wi-Fi network name* — "exactly as on the
 * phone". A web page cannot read the Wi-Fi name: no browser exposes it, on
 * any platform. What the server can see is the address the office's internet
 * line is seen from, which is what the live CRM already checks, so that is
 * what this asks for. The screen shows the address this computer is being
 * seen from, so an owner sitting in the office can save it without knowing
 * what an IP address is.
 */

interface Attendance {
  enabled: boolean;
  officeIps: string[];
  start: string;
  end: string;
  satStart: string;
  satEnd: string;
  closedDays: number[];
  graceMinutes: number;
  outsideAllowed: boolean;
  outsideLocationOnce: boolean;
  outsideAskBack: boolean;
  outsideTellOwners: boolean;
  callNeedsCheckIn: boolean;
  callAnyway: boolean;
  yourIp?: string | null;
}

/* Monday first, as the design lists them and as the office week runs. */
const DAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' },
  { n: 0, label: 'Sun' },
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function V2SettingsAttendance() {
  const { user } = useAuth();
  /* The server lets only an owner save these, so an admin reads them. */
  const canEdit = user?.role === 'owner';
  const got = useAsync<Attendance>(() => api.get('/api/attendance/settings'), []);
  const [draft, setDraft] = useState<Attendance | null>(null);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => { if (got.data) setDraft(got.data); }, [got.data]);

  if (got.error) {
    return <SettingsShell page="p-set-attendance"><div className="d-set-body"><ErrorNote>{got.error}</ErrorNote></div></SettingsShell>;
  }
  if (!got.data || !draft) {
    return <SettingsShell page="p-set-attendance"><div className="d-set-body"><Spinner /></div></SettingsShell>;
  }

  const saved = got.data;
  const dirty = JSON.stringify({ ...draft, yourIp: null }) !== JSON.stringify({ ...saved, yourIp: null });
  const set = (patch: Partial<Attendance>) => setDraft({ ...draft, ...patch });

  /* An end before the start is the one combination that would silently make
     the shift zero minutes long and every check-in late. */
  const endWrong = minutes(draft.end) <= minutes(draft.start);
  const satWrong = minutes(draft.satEnd) <= minutes(draft.satStart);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.put('/api/attendance/settings', {
        enabled: draft.enabled,
        officeIps: draft.officeIps,
        start: draft.start,
        end: draft.end,
        satStart: draft.satStart,
        satEnd: draft.satEnd,
        closedDays: draft.closedDays,
        graceMinutes: draft.graceMinutes,
        outsideAllowed: draft.outsideAllowed,
        outsideLocationOnce: draft.outsideLocationOnce,
        outsideAskBack: draft.outsideAskBack,
        outsideTellOwners: draft.outsideTellOwners,
        callNeedsCheckIn: draft.callNeedsCheckIn,
        callAnyway: draft.callAnyway,
      });
      toast('Attendance rules saved');
      got.reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  const working = DAYS.filter((day) => !draft.closedDays.includes(day.n));

  return (
    <SettingsShell page="p-set-attendance">
      <div className="d-set-body">
        <SettingsTitle
          title="Attendance rules"
          note="When the day starts, where check-in works, and what agents may do outside."
        />

        <section className="d-card">
          <SettingsRow
            label="The office network"
            note="Check-in works only from here. Keep at least one."
          >
            <div className="d-col d-gap-8">
              {draft.officeIps.map((ip) => (
                <div className="d-wifi-row" key={ip}>
                  <span className="d-card-icon"><Icon name="wifi" /></span>
                  <div className="d-grow">
                    <b className="d-bold">{ip}</b>
                    <div className="d-small d-muted">
                      {ip === draft.yourIp ? 'This is where you are now' : 'Office internet line'}
                    </div>
                  </div>
                  {ip === draft.yourIp && <span className="d-chip d-green">You are on it</span>}
                  <button
                    type="button"
                    className="d-btn d-sm d-danger"
                    disabled={!canEdit || draft.officeIps.length === 1}
                    onClick={() => set({ officeIps: draft.officeIps.filter((one) => one !== ip) })}
                  >
                    Remove
                  </button>
                </div>
              ))}

              {draft.officeIps.length === 0 && (
                <div className="d-banner d-amber">
                  <Icon name="alert-triangle" />
                  <span className="d-grow">
                    No address yet, so nothing is asked of anybody. Add the one below while you
                    are sitting in the office.
                  </span>
                </div>
              )}

              {canEdit && (
                <div className="d-row d-gap-8 d-mt-12">
                  <div className="d-field d-grow">
                    <div className="d-input-icon">
                      <Icon name="plus" />
                      <input
                        className="d-input"
                        value={adding}
                        aria-label="Add the office address"
                        placeholder="The office internet address"
                        onChange={(e) => setAdding(e.target.value)}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="d-btn"
                    disabled={!adding.trim()}
                    onClick={() => {
                      const ip = adding.trim();
                      if (!draft.officeIps.includes(ip)) {
                        set({ officeIps: [...draft.officeIps, ip] });
                      }
                      setAdding('');
                    }}
                  >
                    Add
                  </button>
                </div>
              )}

              {draft.yourIp && (
                <p className="d-small d-muted d-mt-8">
                  Right now this computer is seen as <b>{draft.yourIp}</b>.
                  {!draft.officeIps.includes(draft.yourIp) && canEdit && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="d-link"
                        onClick={() => set({
                          officeIps: [...draft.officeIps, draft.yourIp as string],
                        })}
                      >
                        Use this address
                      </button>
                      {' '}— only if you are sitting in the office.
                    </>
                  )}
                </p>
              )}
            </div>
          </SettingsRow>

          <SettingsSwitch
            title="Ask people to check in"
            note={draft.officeIps.length === 0
              ? 'Cannot be switched on until an address is saved above.'
              : 'Agents tap Check in when they arrive, from the office network only.'}
            on={draft.enabled}
            disabled={!canEdit || draft.officeIps.length === 0}
            onChange={(on) => set({ enabled: on })}
          />
        </section>

        <section className="d-card">
          <SettingsRow label="Shift" note="Call buttons ask for check-in only inside these hours.">
            <div className="d-row d-gap-16 d-wrap">
              <Time label="Starts" value={draft.start} disabled={!canEdit}
                onChange={(v) => set({ start: v })} />
              <Time label="Ends" value={draft.end} disabled={!canEdit}
                error={endWrong ? 'Must be after the start.' : undefined}
                onChange={(v) => set({ end: v })} />
              <div className="d-field v2-set-time">
                <label>Late after</label>
                <div className="d-row d-gap-8">
                  <input
                    className="d-input"
                    type="number"
                    min={0}
                    max={120}
                    value={draft.graceMinutes}
                    disabled={!canEdit}
                    aria-label="Late after, in minutes"
                    onChange={(e) => set({ graceMinutes: Number(e.target.value) })}
                  />
                  <span className="d-small d-muted v2-set-unit">minutes</span>
                </div>
                <span className="d-hint">
                  Late from {addMinutes(draft.start, draft.graceMinutes)}
                </span>
              </div>

              {/* The design's shift bar: the whole day with the grace period
                  marked, so "10 minutes" is a size rather than a number. */}
              <div className="d-shift-vis d-grow">
                <div className="d-shift-bar">
                  <i style={{ width: `${graceWidth(draft)}%` }} />
                  <b style={{ left: `${nowAcross(draft)}%` }} />
                </div>
                <div className="d-row d-between d-tiny d-muted">
                  <span>{draft.start}</span>
                  <span>
                    {hours(draft.start, draft.end)} · {draft.graceMinutes} min grace
                  </span>
                  <span>{draft.end}</span>
                </div>
              </div>
            </div>
          </SettingsRow>

          <SettingsRow label="Saturday" note="A short day here, so it has its own hours.">
            <div className="d-row d-gap-16 d-wrap">
              <Time label="Starts" value={draft.satStart} disabled={!canEdit || draft.closedDays.includes(6)}
                onChange={(v) => set({ satStart: v })} />
              <Time label="Ends" value={draft.satEnd} disabled={!canEdit || draft.closedDays.includes(6)}
                error={satWrong && !draft.closedDays.includes(6) ? 'Must be after the start.' : undefined}
                onChange={(v) => set({ satEnd: v })} />
              {draft.closedDays.includes(6) && (
                <span className="d-small d-muted v2-set-unit">Saturday is a day off below.</span>
              )}
            </div>
          </SettingsRow>

          <SettingsRow label="Days off" note="No check-in, no late mark, no take-back clock.">
            <div>
              <div className="d-chips">
                {DAYS.map((day) => (
                  <button
                    key={day.n}
                    type="button"
                    disabled={!canEdit}
                    className={draft.closedDays.includes(day.n) ? 'd-chip-opt d-on' : 'd-chip-opt'}
                    onClick={() => set({
                      closedDays: draft.closedDays.includes(day.n)
                        ? draft.closedDays.filter((n) => n !== day.n)
                        : [...draft.closedDays, day.n].sort(),
                    })}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              <p className="d-small d-muted d-mt-8">
                {working.length === 0
                  ? 'Every day is off. Nobody will ever be asked to check in.'
                  : `${working.length} working day${working.length === 1 ? '' : 's'}: ${
                    working.map((day) => DAY_NAMES[day.n]).join(', ')}.`}
              </p>
            </div>
          </SettingsRow>
        </section>

        <section className="d-card">
          <div className="d-card-head"><h4>Working outside</h4></div>
          <div>
            <SettingsSwitch
              title="Agents can work outside"
              note="Viewings, site visits and developer events count as work"
              on={draft.outsideAllowed} disabled={!canEdit}
              onChange={(on) => set({ outsideAllowed: on })}
            />
            <div className={draft.outsideAllowed ? undefined : 'v2-set-dim'}>
              <SettingsSwitch
                title="Ask for the location once"
                note="Shared one time when they start, not followed after that"
                on={draft.outsideLocationOnce} disabled={!canEdit || !draft.outsideAllowed}
                onChange={(on) => set({ outsideLocationOnce: on })}
              />
              <SettingsSwitch
                title="Ask “Are you back in the office?”"
                note="Asked once at the back-by time"
                on={draft.outsideAskBack} disabled={!canEdit || !draft.outsideAllowed}
                onChange={(on) => set({ outsideAskBack: on })}
              />
              <SettingsSwitch
                title="Tell owners when someone starts"
                note="A line in the bell, no sound"
                on={draft.outsideTellOwners} disabled={!canEdit || !draft.outsideAllowed}
                onChange={(on) => set({ outsideTellOwners: on })}
              />
            </div>
          </div>
        </section>

        <section className="d-card">
          <div className="d-card-head"><h4>Calls</h4></div>
          <div>
            <SettingsSwitch
              title="Ask to check in before a call"
              note="Agents only, inside the shift. Owners and admin are never asked."
              on={draft.callNeedsCheckIn} disabled={!canEdit}
              onChange={(on) => set({ callNeedsCheckIn: on })}
            />
            <SettingsSwitch
              title="Allow “Call anyway”"
              note={draft.callAnyway
                ? 'The call is marked “not checked in” and owners see it'
                : 'An agent who cannot check in cannot call. A broken office router stops every call.'}
              on={draft.callAnyway} disabled={!canEdit || !draft.callNeedsCheckIn}
              onChange={(on) => set({ callAnyway: on })}
            />
          </div>
        </section>

        <section className="d-card">
          <SettingsRow
            label="The month"
            note="Every agent, every day, late minutes, leave and outside work."
          >
            <Link className="d-btn" to="/v2/attendance">
              <Icon name="calendar-days" />Open team attendance
            </Link>
          </SettingsRow>
        </section>

        {problem && <ErrorNote>{problem}</ErrorNote>}

        {canEdit && (
          <SaveBar
            note="Changes start tomorrow morning. Today's check-ins stay as they are."
            dirty={dirty && !endWrong && !(satWrong && !draft.closedDays.includes(6))}
            busy={busy}
            onUndo={() => setDraft(saved)}
            onSave={save}
            saveLabel="Save rules"
          />
        )}
      </div>
    </SettingsShell>
  );
}

/* ── shift arithmetic ─────────────────────────────────────────────────── */

function minutes(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

function addMinutes(hhmm: string, add: number): string {
  const total = (minutes(hhmm) + add + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function hours(start: string, end: string): string {
  const span = minutes(end) - minutes(start);
  if (span <= 0) return '—';
  const h = Math.floor(span / 60);
  const m = span % 60;
  return m === 0 ? `${h} hours` : `${h}h ${m}m`;
}

/** The grace period as a share of the whole shift, for the bar. */
function graceWidth(a: Attendance): number {
  const span = minutes(a.end) - minutes(a.start);
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, (a.graceMinutes / span) * 100));
}

/**
 * Where now sits across the shift, or off the bar when outside it.
 *
 * Dubai is UTC+4 with no daylight saving, which is why this is a fixed offset
 * and not a timezone library.
 */
function nowAcross(a: Attendance): number {
  const dubai = new Date(Date.now() + 4 * 3600_000);
  const now = dubai.getUTCHours() * 60 + dubai.getUTCMinutes();
  const span = minutes(a.end) - minutes(a.start);
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((now - minutes(a.start)) / span) * 100));
}

function Time({
  label, value, onChange, disabled, error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className="d-field v2-set-time">
      <label>{label}</label>
      <input
        className="d-input"
        type="time"
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <span className="v2-field-error">{error}</span>}
    </div>
  );
}
