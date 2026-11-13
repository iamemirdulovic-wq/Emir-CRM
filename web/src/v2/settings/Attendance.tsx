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
 * Built from `design/web/settings-attendance.html`: the office networks, the
 * shift with its visual bar, the days off, working outside, calls, and the
 * monthly file.
 *
 * **The Wi-Fi name.** The design asks for the office network's name, "exactly
 * as on the phone", and there is no browser on any platform that will tell a
 * web page what Wi-Fi it is on. What the server can see is the address the
 * office's internet line is seen from, which is what check-in has always
 * matched on. So the row carries both: the name is what the owner reads and
 * types, the address underneath it is what the gate compares. Removing the
 * address and keeping only the name would be a gate that lets everybody in
 * from anywhere. Written up in `docs/decisions-to-confirm.md`.
 *
 * Removing a network takes two taps, because one tap can stop a whole office
 * checking in tomorrow morning and nothing else in the CRM would say why.
 */

interface Attendance {
  enabled: boolean;
  officeIps: string[];
  officeNames: Record<string, string>;
  onIpNow: Record<string, number>;
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

interface MonthChoice {
  key: string;
  label: string;
  workingDays: number;
  people: number;
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
  /* `sage.md` §1: an admin does what an owner does on these screens, and the
     endpoint now agrees. */
  const canEdit = user?.role === 'owner' || user?.role === 'admin';
  const got = useAsync<Attendance>(() => api.get('/api/attendance/settings'), []);
  const months = useAsync<{ months: MonthChoice[] }>(
    () => api.get('/api/attendance/report/months'), [],
  );
  const [draft, setDraft] = useState<Attendance | null>(null);
  const [addName, setAddName] = useState('');
  const [addIp, setAddIp] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [month, setMonth] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [submitTried, setSubmitTried] = useState(false);
  const toast = useToast();

  useEffect(() => { if (got.data) setDraft(got.data); }, [got.data]);
  useEffect(() => {
    if (months.data?.months[0] && !month) setMonth(months.data.months[0].key);
  }, [months.data, month]);

  /* The second tap is forgotten after four seconds, as the design's own
     `data-confirm` does. */
  useEffect(() => {
    if (!removing) return undefined;
    const timer = window.setTimeout(() => setRemoving(null), 4000);
    return () => window.clearTimeout(timer);
  }, [removing]);

  if (got.error) {
    return <SettingsShell page="p-set-attendance"><div className="d-set-body"><ErrorNote>{got.error}</ErrorNote></div></SettingsShell>;
  }
  if (!got.data || !draft) {
    return <SettingsShell page="p-set-attendance"><div className="d-set-body"><Spinner /></div></SettingsShell>;
  }

  const saved = got.data;
  const stripLive = (one: Attendance) => ({ ...one, yourIp: null, onIpNow: {} });
  const dirty = JSON.stringify(stripLive(draft)) !== JSON.stringify(stripLive(saved));
  const set = (patch: Partial<Attendance>) => setDraft({ ...draft, ...patch });

  /* An end before the start is the one combination that would silently make
     the shift zero minutes long and every check-in late. */
  const endWrong = minutes(draft.end) <= minutes(draft.start);
  const lateAt = addMinutes(draft.start, draft.graceMinutes);
  const lateWrong = minutes(lateAt) < minutes(draft.start) || minutes(lateAt) >= minutes(draft.end);
  const satWrong = minutes(draft.satEnd) <= minutes(draft.satStart);
  const shiftWrong = endWrong || lateWrong || (satWrong && !draft.closedDays.includes(6));

  function addNetwork() {
    if (!draft) return;
    const name = addName.trim();
    const ip = addIp.trim();
    if (!name) { setAddError('Write the network name.'); return; }
    if (draft.officeIps.some((one) => (draft.officeNames[one] ?? '').toLowerCase() === name.toLowerCase())) {
      setAddError('This network is already in the list.');
      return;
    }
    if (!ip) { setAddError('Write the address this network is seen from.'); return; }
    if (draft.officeIps.includes(ip)) { setAddError('This network is already in the list.'); return; }
    setAddError(null);
    set({
      officeIps: [...draft.officeIps, ip],
      officeNames: { ...draft.officeNames, [ip]: name },
    });
    setAddName('');
    setAddIp('');
    toast(`${name} added`);
  }

  function removeNetwork(ip: string) {
    if (!draft) return;
    if (removing !== ip) { setRemoving(ip); return; }
    setRemoving(null);
    const name = draft.officeNames[ip] ?? ip;
    const wasIps = draft.officeIps;
    const wasNames = draft.officeNames;
    const names = { ...draft.officeNames };
    delete names[ip];
    set({ officeIps: draft.officeIps.filter((one) => one !== ip), officeNames: names });
    toast(`${name} removed. Check-in no longer works on it.`, {
      action: { label: 'Undo', onClick: () => set({ officeIps: wasIps, officeNames: wasNames }) },
    });
  }

  async function save() {
    if (!draft) return;
    setSubmitTried(true);
    if (shiftWrong) {
      toast('Check the shift times first. Nothing was saved.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api.put('/api/attendance/settings', {
        enabled: draft.enabled,
        officeIps: draft.officeIps,
        officeNames: draft.officeNames,
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
  const onlyOne = draft.officeIps.length <= 1;
  const chosenMonth = months.data?.months.find((one) => one.key === month);

  /** Every switch says what it did, as the design's own toast does. */
  const flip = (label: string) => (on: boolean) => toast(`${label} · ${on ? 'on' : 'off'}`);

  return (
    <SettingsShell page="p-set-attendance">
      <div className="d-set-body">
        <SettingsTitle
          title="Attendance rules"
          note="When the day starts, where check-in works, and what agents may do outside."
        />

        <section className="d-card">
          <SettingsRow
            label="Office Wi-Fi"
            note="Check-in works only on these networks. Keep at least one."
          >
            <div>
              <div className="d-col d-gap-8">
                {draft.officeIps.map((ip) => {
                  const name = draft.officeNames[ip] ?? ip;
                  const here = ip === draft.yourIp;
                  const onItNow = draft.onIpNow?.[ip] ?? 0;
                  return (
                    <div className="d-wifi-row" key={ip}>
                      <span className="d-card-icon"><Icon name="wifi" /></span>
                      <div className="d-grow">
                        <b className="d-bold">{name}</b>
                        <div className="d-small d-muted">
                          {onItNow > 0
                            ? `Main office · ${onItNow} ${onItNow === 1 ? 'person' : 'people'} on it now`
                            : here ? 'Main office · this is where you are now' : 'Main office'}
                          {' · '}
                          <span className="d-t-mono">{ip}</span>
                        </div>
                      </div>
                      {here && <span className="d-chip d-green d-pip">You are on it</span>}
                      <button
                        type="button"
                        className={removing === ip ? 'd-btn d-sm d-danger d-solid' : 'd-btn d-sm d-danger'}
                        disabled={!canEdit || onlyOne}
                        onClick={() => removeNetwork(ip)}
                      >
                        {removing === ip ? 'Tap again to remove' : 'Remove'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {draft.officeIps.length === 0 && (
                <div className="d-banner d-amber d-mt-12">
                  <Icon name="alert-triangle" />
                  <span className="d-grow">
                    No network yet, so nothing is asked of anybody. Add the one below while you
                    are sitting in the office.
                  </span>
                </div>
              )}

              {canEdit && (
                <>
                  <div className="d-row d-gap-8 d-mt-12 d-wrap v2-wifi-add">
                    <div className={addError ? 'd-field d-grow d-invalid' : 'd-field d-grow'}>
                      <div className="d-input-icon">
                        <Icon name="plus" />
                        <input
                          className="d-input"
                          value={addName}
                          aria-label="Network name"
                          placeholder="Network name, exactly as on the phone"
                          onChange={(e) => { setAddName(e.target.value); setAddError(null); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNetwork(); } }}
                        />
                      </div>
                      <span className="d-error">{addError ?? 'Write the network name.'}</span>
                    </div>
                    <div className="d-field v2-wifi-ip">
                      <input
                        className="d-input"
                        value={addIp}
                        aria-label="The address it is seen from"
                        placeholder={draft.yourIp ?? 'The address it is seen from'}
                        onChange={(e) => { setAddIp(e.target.value); setAddError(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNetwork(); } }}
                      />
                    </div>
                    <button type="button" className="d-btn v2-wifi-btn" onClick={addNetwork}>
                      Add network
                    </button>
                  </div>

                  {/* The second field is the honest half of this row, so it
                      says what it is for rather than leaving an owner to
                      guess at an IP address. */}
                  <p className="d-small d-muted d-mt-8">
                    A browser cannot read the Wi-Fi name, so check-in matches the address the
                    network is seen from. Right now this computer is seen as{' '}
                    <b className="d-t-mono">{draft.yourIp ?? 'an address the server cannot see'}</b>.
                    {draft.yourIp && !draft.officeIps.includes(draft.yourIp) && (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="d-link"
                          onClick={() => setAddIp(draft.yourIp as string)}
                        >
                          Use this address
                        </button>
                        {' '}— only if you are sitting in the office.
                      </>
                    )}
                  </p>
                </>
              )}

              {onlyOne && draft.officeIps.length === 1 && (
                <p className="d-small d-muted d-mt-8">
                  This is the last network. Add another one before you remove it.
                </p>
              )}
            </div>
          </SettingsRow>

          <SettingsSwitch
            title="Ask people to check in"
            note={draft.officeIps.length === 0
              ? 'Cannot be switched on until a network is saved above.'
              : 'Agents tap Check in when they arrive, from the office network only.'}
            on={draft.enabled}
            disabled={!canEdit || draft.officeIps.length === 0}
            onChange={(on) => { set({ enabled: on }); flip('Ask people to check in')(on); }}
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
              {/* "Late after" is a time in the design and minutes in the
                  store, so the field is a time and the minutes are worked
                  out from it — which is also what the shift bar needs. */}
              <Time
                label="Late after"
                value={lateAt}
                disabled={!canEdit}
                error={lateWrong ? 'Must be after the start and before the end.' : undefined}
                onChange={(v) => {
                  const gap = minutes(v) - minutes(draft.start);
                  set({ graceMinutes: Math.min(120, Math.max(0, gap)) });
                }}
              />

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
                    onClick={() => {
                      const off = draft.closedDays.includes(day.n);
                      if (!off && draft.closedDays.length >= 6) {
                        toast('Keep at least one working day');
                        return;
                      }
                      set({
                        closedDays: off
                          ? draft.closedDays.filter((n) => n !== day.n)
                          : [...draft.closedDays, day.n].sort(),
                      });
                    }}
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
              onChange={(on) => { set({ outsideAllowed: on }); flip('Agents can work outside')(on); }}
            />
            <div className={draft.outsideAllowed ? undefined : 'v2-set-dim'}>
              <SettingsSwitch
                title="Ask for the location once"
                note="Shared one time when they start, not followed after that"
                on={draft.outsideLocationOnce} disabled={!canEdit || !draft.outsideAllowed}
                onChange={(on) => { set({ outsideLocationOnce: on }); flip('Ask for the location once')(on); }}
              />
              <SettingsSwitch
                title="Ask “Are you back in the office?”"
                note="Asked once at the back-by time"
                on={draft.outsideAskBack} disabled={!canEdit || !draft.outsideAllowed}
                onChange={(on) => { set({ outsideAskBack: on }); flip('Ask “Are you back in the office?”')(on); }}
              />
              <SettingsSwitch
                title="Tell owners when someone starts"
                note="A line in the bell, no sound"
                on={draft.outsideTellOwners} disabled={!canEdit || !draft.outsideAllowed}
                onChange={(on) => { set({ outsideTellOwners: on }); flip('Tell owners when someone starts')(on); }}
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
              onChange={(on) => { set({ callNeedsCheckIn: on }); flip('Ask to check in before a call')(on); }}
            />
            <SettingsSwitch
              title="Allow “Call anyway”"
              note={draft.callAnyway
                ? 'The call is marked “not checked in” and owners see it'
                : 'An agent who cannot check in cannot call. A broken office router stops every call.'}
              on={draft.callAnyway} disabled={!canEdit || !draft.callNeedsCheckIn}
              onChange={(on) => { set({ callAnyway: on }); flip('Allow “Call anyway”')(on); }}
            />
          </div>
        </section>

        <section className="d-card">
          <SettingsRow
            label="Monthly report"
            note="One file: every agent, every day, late minutes, leave, outside work."
          >
            <div className="d-row d-gap-8 d-wrap">
              <select
                className="d-select v2-rep-month"
                value={month}
                aria-label="Which month"
                onChange={(e) => setMonth(e.target.value)}
              >
                {(months.data?.months ?? []).map((one) => (
                  <option key={one.key} value={one.key}>{one.label}</option>
                ))}
              </select>
              <a
                className="d-btn"
                href={`/api/attendance/report.csv?month=${encodeURIComponent(month)}`}
                onClick={() => toast(`Attendance-${chosenMonth?.label.replace(' ', '-') ?? month}.csv is downloading`)}
              >
                <Icon name="download" />Download file (CSV)
              </a>
              <span className="d-small d-muted">
                {chosenMonth
                  ? `${chosenMonth.workingDays} working day${chosenMonth.workingDays === 1 ? '' : 's'} · ${
                    chosenMonth.people} ${chosenMonth.people === 1 ? 'agent' : 'agents'}`
                  : 'Counting the month…'}
              </span>
            </div>
          </SettingsRow>
        </section>

        {problem && <ErrorNote>{problem}</ErrorNote>}
        {submitTried && shiftWrong && (
          <ErrorNote>Check the shift times first. Nothing was saved.</ErrorNote>
        )}

        {canEdit && (
          <SaveBar
            note="Changes start tomorrow morning. Today's check-ins stay as they are."
            dirty={dirty}
            busy={busy}
            onUndo={() => { setDraft(saved); setSubmitTried(false); }}
            onSave={save}
            saveLabel="Save rules"
          >
            <Link className="d-btn d-ghost" to="/v2/attendance">Open team attendance</Link>
          </SaveBar>
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
  return Math.min(100, Math.max(1, (a.graceMinutes / span) * 100));
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

/**
 * A 24-hour time box.
 *
 * `<input type="time">` draws itself in the **browser's own** locale, which
 * neither the page's `lang` nor anything else in the document can change —
 * so on an en-US browser the office's shift reads "7:00 PM" in a CRM whose
 * rule is 24-hour everywhere. It is not a setting somebody forgot: Chromium
 * ignores `lang` on these controls entirely, which is checked below.
 *
 * `design/web/app.js` hit the same thing and solved it the same way, under a
 * comment that says so in as many words: *"24-hour time boxes (Abdullah): a
 * native time field shows AM/PM on some computers"*. It turns every
 * `input[type=time]` into a text box that only takes HH:MM. This is that,
 * in React, with the design's own rules:
 *
 *  - typing is digits and a colon only, and `0930` becomes `09:30` as you go;
 *  - leaving the box turns `9` into `09:00` and pads `9:30` to `09:30`;
 *  - something that is not a time falls back to the last one that was, so a
 *    half-typed entry cannot save an empty shift.
 */
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

function Time({
  label, value, onChange, disabled, error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
}) {
  /* What is in the box while it is being typed in, which is not yet a time. */
  const [typing, setTyping] = useState<string | null>(null);
  const shown = typing ?? value;

  return (
    <div className={error ? 'd-field v2-set-time d-invalid' : 'd-field v2-set-time'}>
      <label>{label}</label>
      <input
        className="d-input"
        type="text"
        inputMode="numeric"
        maxLength={5}
        placeholder="HH:MM"
        title="24-hour clock, like 09:00 or 18:30"
        value={shown}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          let next = e.target.value.replace(/[^\d:]/g, '');
          if (/^\d{3,4}$/.test(next)) next = `${next.slice(0, next.length - 2)}:${next.slice(-2)}`;
          setTyping(next);
          if (HHMM.test(next)) onChange(pad(next));
        }}
        onBlur={() => {
          let next = (typing ?? '').trim();
          if (/^\d{1,2}$/.test(next) && Number(next) < 24) next += ':00';
          next = pad(next);
          setTyping(null);
          /* Not a time: keep the one that was. */
          if (HHMM.test(next)) onChange(next);
        }}
      />
      {error && <span className="d-error">{error}</span>}
    </div>
  );
}

/** `9:30` → `09:30`. The design pads on blur and so does this. */
function pad(value: string): string {
  return value.length === 4 && value.includes(':') ? `0${value}` : value;
}
