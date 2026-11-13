import { USERS } from './data.js';

/**
 * `/api/v2/live` for the preview — what the team is doing right now.
 *
 * The same shape `server/src/v2/live.ts` returns, with the hours worked out
 * from the browser's own clock so the "now" column and the dashed marker land
 * where they would on a real afternoon. The figures are a demonstration; the
 * real screen counts `call_logs` and `message_taps`.
 */

/** Dubai is UTC+4 all year, as `server/src/v2/dubai.ts` explains. */
function dubaiNow(): { hour: number; minute: number } {
  const at = new Date(Date.now() + 4 * 3_600_000);
  return { hour: at.getUTCHours(), minute: at.getUTCMinutes() };
}

/** The office day, 10:00 to 19:00, which is what Settings → Attendance says. */
const OPEN = 10;
const CLOSE = 19;

/** Calls and WhatsApp clicks per hour of the day, by hour number. */
const CALLS: Record<number, number> = {
  10: 46, 11: 41, 12: 22, 13: 39, 14: 38, 15: 31, 16: 28, 17: 24, 18: 11, 19: 4,
};
const WHATSAPP: Record<number, number> = {
  10: 22, 11: 20, 12: 11, 13: 19, 14: 20, 15: 14, 16: 12, 17: 10, 18: 6, 19: 2,
};

/** name, calls, whatsapp, telegram, minutes since the last click. */
const AGENTS: Array<[string, number, number, number, number]> = [
  ['u-layla', 41, 20, 3, 0],
  ['u-omar', 36, 17, 9, 1],
  ['u-priya', 27, 13, 8, 3],
  ['u-yousef', 22, 12, 2, 12],
];

export function previewLive(): unknown {
  const { hour, minute } = dubaiNow();
  const first = Math.min(OPEN, hour);
  const last = Math.max(CLOSE, hour);

  const hours: Array<{
    hour: number; calls: number; whatsapp: number; telegram: number; future: boolean;
  }> = [];
  for (let at = first; at <= last; at += 1) {
    const future = at > hour;
    hours.push({
      hour: at,
      calls: future ? 0 : CALLS[at] ?? 0,
      whatsapp: future ? 0 : WHATSAPP[at] ?? 0,
      telegram: future ? 0 : Math.round((WHATSAPP[at] ?? 0) / 3),
      future,
    });
  }

  const totals = hours.reduce(
    (sum, one) => ({
      calls: sum.calls + one.calls,
      whatsapp: sum.whatsapp + one.whatsapp,
      telegram: sum.telegram + one.telegram,
    }),
    { calls: 0, whatsapp: 0, telegram: 0 },
  );

  const span = (last - first + 1) * 60;
  const across = Math.min(1, Math.max(0, ((hour - first) * 60 + minute) / span));

  /* The agent's own day, shaped like the team's: busy late morning, quiet
     over lunch. Enough movement for the sparkline to be a line. */
  const spark = (row: typeof AGENTS[number]) => hours.map((one) => (
    one.future
      ? 0
      : Math.max(0, Math.round(((CALLS[one.hour] ?? 0) + (WHATSAPP[one.hour] ?? 0))
        * (row[1] + row[2]) / 420))
  ));

  const dubaiDate = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);

  return {
    now: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    closed: false,
    hours,
    nowAcross: across,
    totals,
    /* Yesterday by this time: a little behind, so the deltas read as a good
       day rather than as a flat line. */
    yesterday: {
      calls: Math.round(totals.calls * 0.89),
      whatsapp: Math.round(totals.whatsapp * 0.92),
      telegram: totals.telegram,
    },
    agents: AGENTS.map((row) => {
      const person = USERS.find((one) => one.id === row[0]);
      return {
        userId: row[0],
        name: person?.name ?? row[0],
        photoUrl: null,
        calls: row[1],
        whatsapp: row[2],
        telegram: row[3],
        spark: spark(row),
        lastClickAt: new Date(Date.now() - row[4] * 60_000).toISOString(),
      };
    }),
    notCheckedIn: [
      {
        userId: 'u-priya',
        name: USERS.find((one) => one.id === 'u-priya')?.name ?? 'Priya Nair',
        calls: 2,
        times: ['09:12', '09:18'],
        /* 09:24 Dubai, which is 05:24 UTC — after the two calls above. */
        checkedInAt: `${dubaiDate}T05:24:00.000Z`,
      },
    ],
  };
}
