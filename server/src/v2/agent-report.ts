/**
 * One person's month, on one page.
 *
 * Emir asked for this on 25 November: a report he can download per agent —
 * when they came in, how they called, what they let go cold. Every figure
 * here is counted by SQL over the CRM's own rows. Nothing is estimated and
 * nothing is written by a model, because this is a document about a real
 * person that may end up in a conversation about their job.
 *
 * **There is no leaving time in this CRM.** `attendance` holds one row per
 * person per day and it records the check-in: the Wi-Fi is matched once, at
 * that tap, and never watched after it. So "when did they go home" cannot be
 * answered, and this report does not pretend to: it reports **last seen
 * working** — the last call, note or stage change they made that day — which
 * is Emir's own choice of 25 November and says what it is on the page.
 */
import { getPool, query, queryOne, type Executor } from '../db/client.js';
import { attendanceMonth, type AttendanceDay } from '../attendance/attendance.js';

export interface ReportDay extends AttendanceDay {
  /** Their last call, note or stage change that day, Dubai time. */
  lastSeen: string | null;
  /** True when the office was shut, so an empty square is not an absence. */
  closed: boolean;
}

export interface AgentReport {
  person: { id: string; name: string; role: string; photoUrl: string | null };
  from: string;
  to: string;
  generatedAt: Date;

  attendance: {
    openDays: number;
    inOffice: number;
    outside: number;
    late: number;
    absent: number;
    leave: number;
    /** The middle arrival time over the days they came in. "09:14". */
    usualArrival: string | null;
    /** The middle last-seen time over the days they worked. "18:40". */
    usualLastSeen: string | null;
    days: ReportDay[];
  };

  calls: {
    total: number;
    /** By the outcome the agent reported. Unanswered ones are counted apart. */
    byOutcome: Array<{ outcome: string; n: number }>;
    noOutcome: number;
    /** Dialled while not checked in — the rule, and who bends it. */
    notCheckedIn: number;
    perOpenDay: number;
  };

  leads: {
    open: number;
    neverCalled: number;
    overdue: number;
    noNextStep: number;
    goingCold: number;
    takenBack: number;
  };

  results: {
    meetingsBooked: number;
    showed: number;
    noShow: number;
    won: number;
  };

  /**
   * A score out of 100, with its working shown.
   *
   * Emir asked for one on 25 November. It shows every part because a number
   * about somebody's job that cannot be explained is a number that cannot be
   * defended in the room — "62" means nothing, "18 of 30 for being here"
   * is a conversation.
   *
   * Three of the four parts are measured against **this team's own median**
   * for the same period rather than a target invented here. A target nobody
   * agreed to is a business rule, and those are Emir's to set, not mine.
   */
  score: {
    total: number;
    band: 'strong' | 'fine' | 'behind';
    parts: Array<{ key: string; label: string; got: number; outOf: number; why: string }>;
  };

  /** A line written to the agent, by name. Chosen by the score, never by a model. */
  note: { kind: 'congratulate' | 'steady' | 'warn'; headline: string; body: string };
}

/** "2026-11-25 18:40" → "18:40", in Dubai, which is UTC+4 all year. */
function dubaiClock(at: Date | null): string | null {
  if (!at) return null;
  const d = new Date(at.getTime() + 4 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * The middle value, not the average.
 *
 * One 04:00 airport run would drag an average arrival earlier for the whole
 * month and make a person who is late every day look early.
 */
function median(times: string[]): string | null {
  if (times.length === 0) return null;
  const mins = times
    .map((t) => {
      const [h = '0', m = '0'] = t.split(':');
      return Number(h) * 60 + Number(m);
    })
    .sort((a, b) => a - b);
  const mid = mins[Math.floor(mins.length / 2)] ?? 0;
  return `${String(Math.floor(mid / 60)).padStart(2, '0')}:${String(mid % 60).padStart(2, '0')}`;
}

export async function agentReport(
  userId: string,
  from: string,
  to: string,
  exec: Executor = getPool(),
): Promise<AgentReport | null> {
  const person = await queryOne<{ id: string; name: string; role: string; photo_url: string | null }>(
    'SELECT id, name, role, photo_url FROM users WHERE id = ?',
    [userId],
    exec,
  );
  if (!person) return null;

  /* The attendance half is the register's own reading, not a second copy of
     it: the same counts this person's row shows on the Attendance screen. */
  const month = await attendanceMonth(from, to, exec);
  const mine = month.people.find((one) => one.userId === userId);
  const closedOn = new Map(month.dates.map((d) => [d.date, d.closed]));

  /* Last seen working, per day. `activities` carries the stage changes and
     notes; `call_logs` the calls. A person can have one without the other. */
  const seen = await query<{ on_date: string; last_at: Date }>(
    /* `DATE_FORMAT` rather than `DATE`: mysql2 hands a DATE column back as a
       JS Date, and `String(date)` is "Sat Nov 14 2026 …" — which matches no
       key in the map below, so every last-seen came out empty while every
       query ran clean. */
    `SELECT DATE_FORMAT(on_date, '%Y-%m-%d') AS on_date, MAX(last_at) AS last_at FROM (
       SELECT DATE(CONVERT_TZ(created_at, '+00:00', '+04:00')) AS on_date,
              created_at AS last_at
         FROM activities
        WHERE user_id = ? AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
       UNION ALL
       SELECT DATE(CONVERT_TZ(started_at, '+00:00', '+04:00')) AS on_date,
              started_at AS last_at
         FROM call_logs
        WHERE user_id = ? AND started_at >= ? AND started_at < DATE_ADD(?, INTERVAL 1 DAY)
     ) AS seen_both
     GROUP BY on_date`,
    [userId, new Date(from), new Date(to), userId, new Date(from), new Date(to)],
    exec,
  );
  const lastByDate = new Map(seen.map((row) => [String(row.on_date).slice(0, 10), row.last_at]));

  const days: ReportDay[] = (mine?.days ?? []).map((day) => ({
    ...day,
    closed: closedOn.get(day.date) ?? false,
    lastSeen: dubaiClock(lastByDate.get(day.date) ?? null),
  }));

  const openDays = month.dates.filter((d) => !d.closed).length;

  /* Leave is its own answer, not an absence: somebody approved it. */
  const onLeave = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM leave_requests
      WHERE user_id = ? AND status = 'approved'
        AND NOT (to_date < ? OR from_date > ?)`,
    [userId, from, to],
    exec,
  );

  const calls = await queryOne<{ total: number; no_outcome: number; not_checked_in: number }>(
    `SELECT COUNT(*) AS total,
            SUM(outcome IS NULL) AS no_outcome,
            SUM(not_checked_in = 1) AS not_checked_in
       FROM call_logs
      WHERE user_id = ? AND started_at >= ? AND started_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [userId, new Date(from), new Date(to)],
    exec,
  );

  const byOutcome = await query<{ outcome: string; n: number }>(
    `SELECT outcome, COUNT(*) AS n FROM call_logs
      WHERE user_id = ? AND outcome IS NOT NULL
        AND started_at >= ? AND started_at < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY outcome ORDER BY n DESC`,
    [userId, new Date(from), new Date(to)],
    exec,
  );

  /*
   * The leads half is about now, not about the range: "11 of his leads have
   * never been called" is a fact about his desk this morning, and dating it
   * to last month would make it unactionable.
   */
  const leads = await queryOne<{
    open: number; never_called: number; overdue: number; no_next_step: number; going_cold: number;
  }>(
    `SELECT
       COUNT(*) AS open,
       SUM(NOT EXISTS (SELECT 1 FROM call_logs c WHERE c.opportunity_id = o.id)) AS never_called,
       SUM(o.next_step_at IS NOT NULL AND o.next_step_at < NOW(3)) AS overdue,
       SUM(o.next_step_at IS NULL) AS no_next_step,
       SUM(o.next_step_at IS NULL
           AND COALESCE(o.last_contact_at, o.created_at) < DATE_SUB(NOW(3), INTERVAL 7 DAY)) AS going_cold
     FROM opportunities o
     WHERE o.owner_user_id = ? AND o.status = 'open' AND o.deleted_at IS NULL`,
    [userId],
    exec,
  );

  /*
   * Taken back from this agent: `lead_assignments` is where that is written,
   * not `unassigned_queue` — the queue has no column for who lost the lead,
   * and `opportunities.returned_at` names the person it went *to*. The row
   * here is the agent's own, marked bounced when the clock ran out.
   */
  const takenBack = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM lead_assignments
      WHERE agent_user_id = ? AND outcome = 'bounced'
        AND assigned_at >= ? AND assigned_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [userId, new Date(from), new Date(to)],
    exec,
  );

  const meetings = await queryOne<{ booked: number; showed: number; no_show: number }>(
    `SELECT COUNT(*) AS booked,
            SUM(result = 'showed') AS showed,
            SUM(result = 'no_show') AS no_show
       FROM meetings
      WHERE user_id = ? AND deleted_at IS NULL
        AND starts_at >= ? AND starts_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [userId, new Date(from), new Date(to)],
    exec,
  );

  const won = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM opportunities
      WHERE owner_user_id = ? AND status = 'won'
        AND closed_at >= ? AND closed_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [userId, new Date(from), new Date(to)],
    exec,
  );

  /*
   * What the rest of the team did in the same period, so a score compares a
   * person with their colleagues rather than with a number I made up.
   */
  const peers = await query<{ user_id: string; calls: number; wins: number }>(
    `SELECT u.id AS user_id,
            (SELECT COUNT(*) FROM call_logs c
              WHERE c.user_id = u.id
                AND c.started_at >= ? AND c.started_at < DATE_ADD(?, INTERVAL 1 DAY)) AS calls,
            (SELECT COUNT(*) FROM meetings m
              WHERE m.user_id = u.id AND m.result = 'showed' AND m.deleted_at IS NULL
                AND m.starts_at >= ? AND m.starts_at < DATE_ADD(?, INTERVAL 1 DAY)) AS wins
       FROM users u
      WHERE u.is_active = 1 AND u.role = 'agent'`,
    [new Date(from), new Date(to), new Date(from), new Date(to)],
    exec,
  );

  const middle = (ns: number[]): number => {
    const sorted = ns.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };
  const teamCalls = middle(peers.map((one) => Number(one.calls)));
  const teamWins = middle(peers.map((one) => Number(one.wins)));

  const arrivals = days
    .filter((d) => d.kind === 'office' && d.at)
    .map((d) => dubaiClock(d.at) as string);
  const lastSeens = days.filter((d) => d.lastSeen).map((d) => d.lastSeen as string);

  const worked = (mine?.inOffice ?? 0) + (mine?.outside ?? 0);
  const callTotal = Number(calls?.total ?? 0);
  const openLeads = Number(leads?.open ?? 0);
  const slipping = Number(leads?.never_called ?? 0) + Number(leads?.overdue ?? 0);
  const showedWon = Number(meetings?.showed ?? 0) + Number(won?.n ?? 0);

  /** 0–1, and never above 1: beating the median twice over is still full marks. */
  const share = (got: number, of: number): number => (of > 0 ? Math.min(1, got / of) : (got > 0 ? 1 : 0));

  const parts = [
    {
      key: 'here',
      label: 'Being here',
      outOf: 30,
      got: Math.round(share(worked, openDays) * 30),
      why: `${worked} of ${openDays} working days`,
    },
    {
      key: 'calling',
      label: 'Calling',
      outOf: 30,
      got: Math.round(share(callTotal, teamCalls) * 30),
      why: teamCalls > 0
        ? `${callTotal} calls · the team's middle is ${teamCalls}`
        : `${callTotal} calls`,
    },
    {
      key: 'following',
      label: 'Following through',
      outOf: 25,
      got: Math.round((openLeads > 0 ? Math.max(0, 1 - slipping / openLeads) : 1) * 25),
      why: openLeads > 0
        ? `${slipping} of ${openLeads} leads never called or overdue`
        : 'No open leads',
    },
    {
      key: 'results',
      label: 'Results',
      outOf: 15,
      got: Math.round(share(showedWon, teamWins) * 15),
      why: teamWins > 0
        ? `${showedWon} viewings and deals · the team's middle is ${teamWins}`
        : `${showedWon} viewings and deals`,
    },
  ];
  const total = parts.reduce((sum, one) => sum + one.got, 0);
  const band: 'strong' | 'fine' | 'behind' = total >= 80 ? 'strong' : total >= 60 ? 'fine' : 'behind';
  const firstName = (person.name ?? '').trim().split(/\s+/)[0] ?? person.name;

  return {
    person: {
      id: person.id, name: person.name, role: person.role, photoUrl: person.photo_url,
    },
    from,
    to,
    generatedAt: new Date(),
    attendance: {
      openDays,
      inOffice: mine?.inOffice ?? 0,
      outside: mine?.outside ?? 0,
      late: mine?.late ?? 0,
      absent: mine?.absent ?? 0,
      leave: Number(onLeave?.n ?? 0),
      usualArrival: median(arrivals),
      usualLastSeen: median(lastSeens),
      days,
    },
    calls: {
      total: Number(calls?.total ?? 0),
      byOutcome: byOutcome.map((row) => ({ outcome: row.outcome, n: Number(row.n) })),
      noOutcome: Number(calls?.no_outcome ?? 0),
      notCheckedIn: Number(calls?.not_checked_in ?? 0),
      perOpenDay: openDays > 0
        ? Math.round((Number(calls?.total ?? 0) / openDays) * 10) / 10
        : 0,
    },
    leads: {
      open: Number(leads?.open ?? 0),
      neverCalled: Number(leads?.never_called ?? 0),
      overdue: Number(leads?.overdue ?? 0),
      noNextStep: Number(leads?.no_next_step ?? 0),
      goingCold: Number(leads?.going_cold ?? 0),
      takenBack: Number(takenBack?.n ?? 0),
    },
    results: {
      meetingsBooked: Number(meetings?.booked ?? 0),
      showed: Number(meetings?.showed ?? 0),
      noShow: Number(meetings?.no_show ?? 0),
      won: Number(won?.n ?? 0),
    },
    score: { total, band, parts },
    note: noteFor(firstName, band, parts, { worked, openDays }),
  };
}

/**
 * The line addressed to the agent.
 *
 * Emir asked for a warning for somebody who is rarely in, and a
 * congratulation for somebody doing well. Two things keep this fair.
 *
 * **It is true.** New leads are handed out by weighted round-robin over the
 * agents who are active and on shift (`workflows/assignment.ts`), so an agent
 * who is not checked in really does get fewer of them. That sentence is how
 * this CRM works, not a threat somebody wrote.
 *
 * **It names the reason.** The weakest part of the score is what the warning
 * is about, so the person reading it knows what to change rather than only
 * that somebody is unhappy.
 */
function noteFor(
  firstName: string,
  band: 'strong' | 'fine' | 'behind',
  parts: Array<{ key: string; label: string; got: number; outOf: number; why: string }>,
  here: { worked: number; openDays: number },
): { kind: 'congratulate' | 'steady' | 'warn'; headline: string; body: string } {
  const weakest = [...parts].sort((a, b) => a.got / a.outOf - b.got / b.outOf)[0];
  const best = [...parts].sort((a, b) => b.got / b.outOf - a.got / a.outOf)[0];

  if (band === 'strong') {
    return {
      kind: 'congratulate',
      headline: `Well done, ${firstName}.`,
      body: `This is one of the strongest months on the team — ${best?.why ?? ''}. `
        + 'New leads go first to the agents who are here and working, so keep this up '
        + 'and more of them will come your way.',
    };
  }
  if (band === 'fine') {
    return {
      kind: 'steady',
      headline: `A solid month, ${firstName}.`,
      body: `The one to lift is ${(weakest?.label ?? '').toLowerCase()} — ${weakest?.why ?? ''}. `
        + 'Fix that and you move into the top group, which is where the best leads go.',
    };
  }
  return {
    kind: 'warn',
    headline: `${firstName}, this needs to change.`,
    body: `You were in ${here.worked} of ${here.openDays} working days, and the weakest part `
      + `of the month was ${(weakest?.label ?? '').toLowerCase()} — ${weakest?.why ?? ''}. `
      + 'This matters beyond the report: the CRM gives new leads to the agents who are '
      + 'checked in and working, so fewer days here means fewer good leads reaching you. '
      + 'Come in, call your list, and that turns around quickly.',
  };
}
