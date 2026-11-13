/**
 * Preview answers for the full dashboard.
 *
 * Its own module rather than another block in `mock-api.ts`, which several
 * people edit at once. The numbers are the design file's own, so a screenshot
 * of the preview can be held against `design/web/dashboard.html` directly.
 */

type Handler = (ctx: {
  params: string[]; body: Record<string, unknown>; query: URLSearchParams;
}) => unknown;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

/** The team, with the design's own names and figures. */
const AGENTS = [
  { name: 'Talha', marked: 'office', wasLate: false, onLeave: false, calls: 42, meetings: 2, units: 1, open: 48, overdue: 0, deskMax: 60, deskName: 'Dubai off-plan', checkedInAt: '08:52' },
  { name: 'Rocky Khan', marked: 'office', wasLate: false, onLeave: false, calls: 38, meetings: 1, units: 0, open: 44, overdue: 1, deskMax: 60, deskName: 'Dubai off-plan', checkedInAt: '08:55' },
  { name: 'Yuliia', marked: 'office', wasLate: false, onLeave: false, calls: 31, meetings: 1, units: 0, open: 39, overdue: 0, deskMax: 60, deskName: 'Dubai off-plan', checkedInAt: '08:58' },
  { name: 'Olga', marked: 'outside', wasLate: false, onLeave: false, calls: 27, meetings: 0, units: 0, open: 35, overdue: 2, deskMax: 60, deskName: 'Dubai off-plan', checkedInAt: '09:03' },
  { name: 'Shan', marked: 'office', wasLate: true, onLeave: false, calls: 24, meetings: 1, units: 0, open: 57, overdue: 3, deskMax: 50, deskName: 'Arabic desk', checkedInAt: '09:24' },
  { name: 'Tej', marked: 'office', wasLate: false, onLeave: false, calls: 21, meetings: 0, units: 0, open: 31, overdue: 0, deskMax: 60, deskName: 'Dubai off-plan', checkedInAt: '09:08' },
  { name: 'Nelson', marked: 'office', wasLate: false, onLeave: false, calls: 18, meetings: 0, units: 0, open: 29, overdue: 1, deskMax: 40, deskName: 'Abu Dhabi', checkedInAt: '10:15' },
  { name: 'Bassam', marked: null, wasLate: false, onLeave: false, calls: 0, meetings: 0, units: 0, open: 44, overdue: 4, deskMax: 40, deskName: 'Abu Dhabi', checkedInAt: null },
  { name: 'Sultan', marked: null, wasLate: false, onLeave: true, calls: 0, meetings: 0, units: 0, open: 31, overdue: 1, deskMax: 50, deskName: 'Arabic desk', checkedInAt: null },
];

/** The desks the Open column measures against, named in its foot. */
const DESKS = [
  { name: 'Dubai off-plan', maxOpenLeads: 60 },
  { name: 'Arabic desk', maxOpenLeads: 50 },
  { name: 'Abu Dhabi', maxOpenLeads: 40 },
];

/** A week of calls that looks like a week, not a sawtooth. */
function week(top: number): number[] {
  const shape = [0.6, 0.8, 1, 0.75, 0.9, 0.3, 0.1];
  return shape.map((f) => Math.round(top * f));
}

function days(): Array<{ date: string; label: string; n: number; weekend: boolean }> {
  const counts = [14, 19, 22, 17, 9, 6, 21, 26, 24, 18, 23, 11, 7, 27];
  const today = new Date();
  return counts.map((n, i) => {
    const at = new Date(today.getTime() - (counts.length - 1 - i) * 86_400_000);
    return {
      date: at.toISOString().slice(0, 10),
      label: String(at.getDate()),
      n,
      weekend: at.getDay() === 5 || at.getDay() === 6,
    };
  });
}

const DASH = {
  period: 'today',
  days: 1,
  now: 'Wed 11 Nov, 14:55',
  totals: { all: 863, open: 809, lost: 50, untouched: 86, newToday: 27, newTodayDelta: 4 },
  work: {
    calls: 214, callsPrevious: 191,
    meetings: 5, meetingsPrevious: 3,
    units: 1, unitsValueAed: 2_900_000,
    touchedIn2hPct: 74, touchedIn2hOf: 27,
    firstAnswerMinutes: 6,
  },
  stages: [
    { key: 'new_lead', label: 'New', tone: 'new', n: 456, pct: 53 },
    { key: 'attempted_contact', label: 'Called', tone: 'called', n: 214, pct: 25 },
    { key: 'engaged_qualified', label: 'Interested', tone: 'interested', n: 96, pct: 11 },
    { key: 'appointment_scheduled', label: 'Meeting', tone: 'meeting', n: 31, pct: 4 },
    { key: 'deal_sent', label: 'Offer', tone: 'offer', n: 12, pct: 1.4 },
    { key: 'won', label: 'Won', tone: 'won', n: 4, pct: 0.5 },
  ],
  lost: { n: 50, pct: 5.8 },
  perDay: { total: 253, previous: 232, days: days() },
  projects: [
    { name: 'The Archive', n: 115, won: 2 },
    { name: 'Shahrukhz', n: 64, won: 1 },
    { name: 'Damac Islands', n: 52, won: 1 },
    { name: 'Valia', n: 28, won: 0 },
  ],
  sources: [
    { key: 'meta_lead_ads', n: 402 },
    { key: 'meta_ctwa', n: 188 },
    { key: 'csv_import', n: 121 },
    { key: 'website', n: 86 },
    { key: 'google_ads', n: 41 },
    { key: 'manual', n: 25 },
  ],
  teamToday: { inOffice: 6, late: 1, outside: 1, leave: 1, absent: 1, closed: false },
  agents: AGENTS.map((a, i) => ({
    userId: `u-${i + 1}`,
    photoUrl: null,
    callsPerDay: week(a.calls),
    ...a,
  })),
  cold: {
    total: 12,
    agents: [
      { userId: 'u-9', name: 'Sultan', marked: null, onLeave: true, leads: 31, cold: 5 },
      { userId: 'u-8', name: 'Bassam', marked: null, onLeave: false, leads: 44, cold: 4 },
      { userId: 'u-5', name: 'Shan', marked: 'office', onLeave: false, leads: 57, cold: 3 },
    ],
  },
  /* The morning brief's three rows, each with its own reason — the design's
     own words, so the preview can be held against `dashboard.html`. */
  brief: [
    {
      kind: 'leave',
      text: 'Sultan is on leave · 31 leads have nobody',
      sub: 'Back Thursday · 1 follow-up is already overdue',
      action: 'Move 31',
      to: '/v2/team/u-9',
      move: { userId: 'u-9', name: 'Sultan', leads: 31 },
    },
    {
      kind: 'overload',
      text: 'Shan has 57 leads · maximum is 50',
      sub: 'Arabic desk · 3 follow-ups overdue',
      action: 'View',
      to: '/v2/team/u-5',
      move: null,
    },
    {
      kind: 'untouched',
      text: '86 leads are not touched yet',
      sub: 'No call and no message since they arrived',
      action: 'View',
      to: '/v2/leads?tab=new',
      move: null,
    },
  ],
  desks: DESKS,
  assignable: AGENTS.map((a, i) => ({
    userId: `u-${i + 1}`,
    name: a.name,
    openLeads: a.open,
    where: a.onLeave ? 'leave' : a.marked === 'outside' ? 'outside'
      : a.marked === 'office' ? 'office' : 'absent',
    /* The assignment machinery takes an active, available agent and nobody
       else; the preview mirrors that, so the dialog looks the same here. */
    canTake: !a.onLeave && a.marked !== null,
  })).sort((a, b) => a.openLeads - b.openLeads),
};

export const DASHBOARD_ROUTES: Route[] = [
  {
    method: 'GET',
    pattern: /^\/api\/v2\/dashboard$/,
    handler: ({ query }) => {
      const period = query.get('period') ?? 'today';
      const scale = { today: 1, week: 6.4, month: 24, year: 260 }[period] ?? 1;
      const times = (n: number) => Math.round(n * scale);
      return {
        ...DASH,
        period,
        days: { today: 1, week: 7, month: 30, year: 365 }[period] ?? 1,
        work: {
          ...DASH.work,
          calls: times(DASH.work.calls),
          callsPrevious: times(DASH.work.callsPrevious),
          meetings: times(DASH.work.meetings),
          meetingsPrevious: times(DASH.work.meetingsPrevious),
          units: times(DASH.work.units),
          unitsValueAed: times(DASH.work.unitsValueAed ?? 0),
        },
        agents: DASH.agents.map((a) => ({
          ...a,
          calls: times(a.calls),
          meetings: times(a.meetings),
          units: times(a.units),
        })),
      };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/v2\/dashboard\/move$/,
    handler: ({ body }) => {
      const who = DASH.cold.agents.find((a) => a.userId === body.userId);
      const to = body.to as { kind?: string; userId?: string; userIds?: string[] } | undefined;
      const named = DASH.assignable.find((a) => a.userId === to?.userId)?.name;
      return {
        moved: who?.leads ?? 31,
        name: who?.name ?? 'Sultan',
        to: to?.kind === 'agent' ? named ?? 'one agent'
          : to?.kind === 'share' ? `${to.userIds?.length ?? 0} agents`
            : 'Incoming',
      };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/activity\/insight$/,
    handler: () => ({
      /* `{ kind, text }`, which is what `server/src/activity/owner-summary.ts`
         really sends. A mock that sends plain strings renders empty
         paragraphs against the real server. */
      lines: [
        { kind: 'good', text: 'Yesterday was strong: 191 calls, 4 meetings, 208 leads imported.' },
        { kind: 'problem', text: '86 leads are not touched yet · imported, back to Incoming tomorrow 09:00' },
        { kind: 'number', text: 'Shan has 57 leads and the maximum is 50.' },
      ],
      quiet: false,
      source: 'Counted from your own data',
    }),
  },
];
