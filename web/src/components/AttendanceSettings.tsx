/**
 * The office network and the duty hours.
 *
 * Owner only — the server refuses the save to anyone else.
 *
 * The part that matters most is the top: it shows the address the server sees
 * this browser coming from, with a button to store it. An owner standing in
 * the office never has to find the number or type it, and when the line's
 * address changes — which on an ordinary UAE broadband line it will — the
 * fix is two taps rather than a support request.
 */
import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Button } from '../design/forms.js';
import { Icon } from '../design/index.js';
import { Field, Note, Panel, useToast } from '../design/ui.js';

interface Settings {
  enabled: boolean;
  officeIps: string[];
  start: string;
  end: string;
  satStart: string;
  satEnd: string;
  closedDays: number[];
  graceMinutes: number;
  yourIp: string | null;
}

const DAYS = [
  ['Sun', 0], ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6],
] as const;

export function AttendanceSettings() {
  const toast = useToast();
  const state = useAsync<Settings>(() => api.get('/api/attendance/settings'), []);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState('');

  const s = state.data;
  if (!s) return <Panel index={0} icon="calendar-check" title="Attendance"><p className="muted">Loading…</p></Panel>;

  async function save(change: Partial<Settings>) {
    setBusy(true);
    try {
      state.setData(await api.put<Settings>('/api/attendance/settings', change));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not save');
    } finally {
      setBusy(false);
    }
  }

  const known = s.officeIps.includes(s.yourIp ?? '');

  return (
    <div className="dash">
      <Panel span={12} index={0} icon="wifi" title="The office network">
        <p className="muted att-lede">
          Checking in only works from these addresses. Everything else sees the
          “working outside” button instead.
        </p>

        <div className={known ? 'att-here known' : 'att-here'}>
          <span className="att-here-dot" aria-hidden="true">
            <Icon name={known ? 'check' : 'monitor'} />
          </span>
          <div>
            <b>{s.yourIp ?? 'unknown'}</b>
            <small>
              {known
                ? 'This is where you are now, and it is already saved.'
                : 'This is where you are now. Open this page on the office Wi-Fi to add it.'}
            </small>
          </div>
          {!known && s.yourIp && (
            <Button
              variant="primary"
              loading={busy}
              onClick={() => void save({ officeIps: [...s.officeIps, s.yourIp as string] })}
            >
              Add this one
            </Button>
          )}
        </div>

        <div className="att-ips">
          {s.officeIps.length === 0 && (
            <p className="muted">
              Nothing saved yet, so attendance is off and nobody is asked to check in.
            </p>
          )}
          {s.officeIps.map((ip) => (
            <span className="att-ip" key={ip}>
              {ip}
              {ip === s.yourIp && <em>you</em>}
              <button
                type="button"
                aria-label={`Remove ${ip}`}
                onClick={() => void save({ officeIps: s.officeIps.filter((x) => x !== ip) })}
              >
                <Icon name="x" />
              </button>
            </span>
          ))}
        </div>

        <form
          className="att-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (!adding.trim()) return;
            void save({ officeIps: [...s.officeIps, adding.trim()] });
            setAdding('');
          }}
        >
          <input
            className="input"
            value={adding}
            placeholder="A second Wi-Fi line, e.g. 203.0.113.11"
            aria-label="Add another office address"
            onChange={(event) => setAdding(event.target.value)}
          />
          <Button type="submit" disabled={!adding.trim()} loading={busy}>Add</Button>
        </form>

        <Note>
          This stops somebody tapping “I’m here” from home. It is not a lock: a
          VPN into the office would still get through. Every check-in records the
          address it came from, so a day that looks wrong can be checked.
        </Note>

        <label className="att-switch">
          <input
            type="checkbox"
            checked={s.enabled}
            disabled={s.officeIps.length === 0}
            onChange={(event) => void save({ enabled: event.target.checked })}
          />
          <span>
            Ask everyone to check in
            {s.officeIps.length === 0 && <small> — add an address first</small>}
          </span>
        </label>
      </Panel>

      <Panel span={12} index={1} icon="clock-3" title="Duty hours">
        <div className="att-hours">
          <Field label="Opens">
            <input type="time" className="input" value={s.start}
              onChange={(event) => void save({ start: event.target.value })} />
          </Field>
          <Field label="Closes">
            <input type="time" className="input" value={s.end}
              onChange={(event) => void save({ end: event.target.value })} />
          </Field>
          <Field label="Saturday opens">
            <input type="time" className="input" value={s.satStart}
              onChange={(event) => void save({ satStart: event.target.value })} />
          </Field>
          <Field label="Saturday closes">
            <input type="time" className="input" value={s.satEnd}
              onChange={(event) => void save({ satEnd: event.target.value })} />
          </Field>
          <Field label="Late after">
            <select className="input" value={s.graceMinutes}
              onChange={(event) => void save({ graceMinutes: Number(event.target.value) })}>
              {[0, 5, 10, 15, 30].map((n) => (
                <option key={n} value={n}>{n === 0 ? 'On the minute' : `${n} minutes`}</option>
              ))}
            </select>
          </Field>
        </div>

        <p className="muted att-lede" style={{ marginTop: 14 }}>Closed on</p>
        <div className="att-days">
          {DAYS.map(([label, n]) => {
            const off = s.closedDays.includes(n);
            return (
              <button
                type="button"
                key={n}
                className={off ? 'att-day off' : 'att-day'}
                aria-pressed={off}
                onClick={() => void save({
                  closedDays: off ? s.closedDays.filter((d) => d !== n) : [...s.closedDays, n],
                })}
              >
                {label}
              </button>
            );
          })}
        </div>
        <small className="muted">
          A closed day is never counted against anyone.
        </small>
      </Panel>
    </div>
  );
}
