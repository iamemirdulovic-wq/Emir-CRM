/**
 * The monthly attendance file the owner downloads.
 *
 * `design/web/settings-attendance.html` has a month picker and a "Download
 * Excel" button, and §4.21 of the spec names it: *one file: every agent, every
 * day, late minutes, leave, outside work*. There was no export anywhere on the
 * server, so the button had nothing to press.
 *
 * It is a **CSV**, not an .xlsx. Excel, Numbers and Google Sheets all open it;
 * writing a real workbook needs a spreadsheet library on the server, and
 * putting one on the deploy path of a CRM ten people use every morning, for
 * one button, is a poor trade. The button says "Download file (CSV)" so nobody
 * is told it is something it is not. Written down in
 * `docs/decisions-to-confirm.md`.
 *
 * Late **minutes**, not a late flag: `attendance.was_late` is a boolean, and
 * "late" without a number cannot tell nine minutes from ninety. The minutes
 * are the gap between when they marked and when the shift's grace period ran
 * out, computed here from the saved shift rather than stored — so changing the
 * shift tomorrow does not rewrite last month.
 */
import { getPool, type Executor } from '../db/client.js';
import { attendanceMonth } from './attendance.js';
import { attendanceSettings } from './settings.js';

export interface MonthChoice {
  /** `2026-11`. */
  key: string;
  /** "November 2026". */
  label: string;
}

/** The three months the design's picker offers: this one and the two before. */
export function recentMonths(now: Date = new Date(), count = 3): MonthChoice[] {
  const dubai = new Date(now.getTime() + 4 * 3_600_000);
  const out: MonthChoice[] = [];
  for (let back = 0; back < count; back += 1) {
    const at = new Date(Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth() - back, 1));
    out.push({
      key: at.toISOString().slice(0, 7),
      label: at.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    });
  }
  return out;
}

export function monthRange(key: string): { from: string; to: string } {
  const [year, month] = key.split('-').map(Number);
  const first = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1));
  const last = new Date(Date.UTC(year ?? 2026, month ?? 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

function minutesOf(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

export interface MonthSummary {
  key: string;
  label: string;
  workingDays: number;
  people: number;
}

/**
 * The line under the picker: "22 working days · 10 agents".
 *
 * A day still to come is not a working day yet — the design's own script says
 * "8 working days so far" for the month in progress, and that is the number
 * that makes the file's totals add up.
 */
export async function monthSummary(
  key: string,
  exec: Executor = getPool(),
): Promise<MonthSummary> {
  const { from, to } = monthRange(key);
  const month = await attendanceMonth(from, to, exec);
  const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
  const workingDays = month.dates.filter((day) => !day.closed && day.date <= today).length;
  const label = recentMonths(new Date(`${from}T12:00:00Z`), 1)[0]?.label ?? key;
  return { key, label, workingDays, people: month.people.length };
}

/**
 * Every person, every day, as one grid.
 *
 * One row per person per day rather than a person-per-row grid with 31
 * columns: a long table is what a spreadsheet can filter, sort and pivot, and
 * the wide one is only easier to look at before you want to do anything
 * with it.
 */
export async function attendanceCsv(
  key: string,
  exec: Executor = getPool(),
): Promise<{ filename: string; csv: string }> {
  const { from, to } = monthRange(key);
  const [month, settings] = await Promise.all([
    attendanceMonth(from, to, exec),
    attendanceSettings(exec),
  ]);
  const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);

  const head = [
    'Person', 'Role', 'Date', 'Day', 'Office closed', 'What happened',
    'Marked at', 'Late minutes', 'Note',
  ];
  const rows: string[][] = [];

  for (const person of month.people) {
    for (const day of person.days) {
      const date = new Date(`${day.date}T00:00:00Z`);
      const weekday = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
      const closed = month.dates.find((one) => one.date === day.date)?.closed ?? false;
      /* Saturday has its own start time where the office keeps one. */
      const start = date.getUTCDay() === 6 ? settings.satStart : settings.start;

      let what = 'Absent';
      if (day.kind === 'office') what = day.late ? 'In the office, late' : 'In the office';
      else if (day.kind === 'outside') what = 'Working outside';
      else if (closed) what = 'Office closed';
      else if (day.date > today) what = 'Not yet';

      let lateMinutes = '';
      let markedAt = '';
      if (day.at) {
        const at = new Date(day.at);
        const dubai = new Date(at.getTime() + 4 * 3_600_000);
        const mins = dubai.getUTCHours() * 60 + dubai.getUTCMinutes();
        markedAt = `${String(dubai.getUTCHours()).padStart(2, '0')}:${String(dubai.getUTCMinutes()).padStart(2, '0')}`;
        const due = minutesOf(start) + settings.graceMinutes;
        if (day.late && mins > due) lateMinutes = String(mins - due);
      }

      rows.push([
        person.name, person.role, day.date, weekday, closed ? 'yes' : 'no',
        what, markedAt, lateMinutes, day.note ?? '',
      ]);
    }
  }

  const summary = await monthSummary(key, exec);
  return {
    filename: `Attendance-${summary.label.replace(' ', '-')}.csv`,
    csv: [head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n'),
  };
}

function cell(value: string): string {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  /* A cell starting with =, +, - or @ is run as a formula by Excel. */
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
