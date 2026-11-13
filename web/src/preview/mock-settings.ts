/**
 * The preview's answers for the owner's settings pages.
 *
 * A separate file rather than more rows in `mock-api.ts` because several
 * people were editing that file at once and a lost update there is a route
 * that silently 404s in the demo. It is spread into `ROUTES` at the end.
 *
 * Every figure here is made up and is meant to be: this file never reaches a
 * production build (`VITE_PREVIEW=1` only). What it must not do is make a
 * screen look better than the real one — so the health page has a service
 * that is not fine, two people have no phone registered, the feedback inbox
 * has somebody who cannot work, and one banner has ended.
 */
type Handler = (ctx: { params: string[]; body: Record<string, unknown>; query: URLSearchParams }) => unknown;
export type MockRoute = { method: string; pattern: RegExp; handler: Handler };

/* ── system health ─────────────────────────────────────────────────────── */

type State = 'ok' | 'slow' | 'down';

const SERVICES: Array<{
  key: string; title: string; about: string; to: string; plural?: boolean;
  state: State; ms: number | null; note: string | null;
}> = [
  {
    key: 'site', title: 'CRM website and sign-in', about: 'crm.homes.me', to: '/v2/settings/health',
    state: 'ok', ms: 180, note: null,
  },
  {
    key: 'database', title: 'Database', about: 'Leads, notes, history', to: '/v2/settings/health',
    state: 'ok', ms: 24, note: '863 leads',
  },
  {
    key: 'notifications', title: 'Notifications', about: 'Phone and computer alerts',
    to: '/v2/settings/team', plural: true, state: 'slow', ms: 48_000,
    note: 'up to 48 seconds',
  },
  {
    key: 'links', title: 'Tracked links', about: 'Brochure links and client opens',
    to: '/v2/settings/health', plural: true, state: 'ok', ms: 95, note: '74 in 7 days',
  },
  {
    key: 'storage', title: 'File storage', about: 'Brochures, IDs, booking forms',
    to: '/v2/settings/health', state: 'ok', ms: 210, note: '6.2 GB used',
  },
  {
    key: 'ai', title: 'Homes AI', about: 'In short, voice notes, chat', to: '/v2/settings/ai',
    state: 'ok', ms: null, note: '$38.40 of $100.00',
  },
];

/** Thirty days of bars, with one bad day in the middle for the slow service. */
function days(service: { key: string; state: State }) {
  const today = new Date(Date.now() + 4 * 3_600_000);
  return Array.from({ length: 30 }, (_, i) => {
    const date = new Date(today.getTime() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    if (service.key === 'notifications') {
      if (i === 12) return { date, state: 'down' as State };
      if (i === 29) return { date, state: 'slow' as State };
    }
    return { date, state: 'ok' as State };
  });
}

function healthReport() {
  const services = SERVICES.map((one) => ({
    ...one,
    checkedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    days: days(one),
    upPercent: one.key === 'notifications' ? 99.1 : 100,
    samples: 8_640,
  }));
  const outstanding = services.filter((one) => one.state !== 'ok').length;
  return {
    services,
    outstanding,
    fine: services.length - outstanding,
    checkedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    neverChecked: false,
    days: 30,
    incidents: [
      {
        service: 'notifications', title: 'Notifications slow', state: 'slow' as State,
        detail: 'Alerts take up to 48 seconds. Normal is under 3.',
        from: new Date(Date.now() - 35 * 60_000).toISOString(), to: null, open: true,
      },
      {
        service: 'notifications', title: 'Notifications not working', state: 'down' as State,
        detail: 'Fixed by itself. 3 alerts were sent again.',
        from: new Date(Date.now() - 17 * 86_400_000).toISOString(),
        to: new Date(Date.now() - 17 * 86_400_000 + 12 * 60_000).toISOString(),
        open: false,
      },
    ],
    setup: [
      { key: 'email', title: 'Email sending', consequence: 'Follow-up emails are recorded as not sent.', ready: true, to: '/v2/settings/health' },
      { key: 'whatsapp', title: 'WhatsApp templates', consequence: 'Automated WhatsApp follow-ups cannot be sent at all.', ready: true, to: '/v2/templates' },
      { key: 'attendance', title: 'Attendance', consequence: 'The office address is saved but the switch is off, so nobody is asked to check in.', ready: false, to: '/v2/settings/attendance' },
    ],
    setupOutstanding: 1,
    website: {
      configured: true,
      lastLeadAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      leadsLast7Days: 23,
    },
    push: {
      configured: true,
      agentsWithoutDevice: 2,
      agentsTotal: 11,
      missing: ['Tej', 'Sultan'],
    },
  };
}

/* ── team and roles ────────────────────────────────────────────────────── */

const MEMBERS = [
  ['Emir Dulovic', 'emir@homes.me', 'owner', 'Founder & CEO', 'office', 'ios', true, 0],
  ['George Vanous', 'george@homes.me', 'owner', 'Partner', 'office', 'ios', true, 0],
  ['Abdullah Mahi', 'abdullah@homes.me', 'admin', 'Office admin', 'office', 'android', true, 0],
  ['Talha', 'talha@homes.me', 'agent', 'Agent · Dubai off-plan', 'office', 'ios', true, 22],
  ['Rocky Khan', 'rocky@homes.me', 'agent', 'Agent · Dubai off-plan', 'office', 'ios', true, 14],
  ['Yuliia', 'yuliia@homes.me', 'agent', 'Agent · Dubai off-plan', 'office', 'ios', false, 18],
  ['Olga', 'olga@homes.me', 'agent', 'Agent · Dubai off-plan', 'office', 'android', true, 12],
  ['Srdjan', 'srdjan@homes.me', 'agent', 'Agent · Dubai off-plan', 'office', 'ios', false, 16],
  ['Tej', 'tej@homes.me', 'agent', 'Agent · Dubai off-plan', 'office', null, false, 11],
  ['Shan', 'shan@homes.me', 'agent', 'Agent · Arabic desk', 'late', 'android', false, 57],
  ['Nelson', 'nelson@homes.me', 'agent', 'Agent · Abu Dhabi', 'outside', 'android', false, 9],
  ['Sultan', 'sultan@homes.me', 'agent', 'Agent · Arabic desk', 'leave', null, false, 31],
  ['Bassam', 'bassam@homes.me', 'agent', 'Agent · Abu Dhabi', 'absent', null, false, 44],
] as const;

const teamState = {
  members: MEMBERS.map(([name, email, role, title, attendance, phone, computer, open], i) => ({
    /* The first row is whoever is signed in, so the preview shows the "you"
       chip and "You cannot change yourself" rather than a select the real
       screen would never offer. `u-owner` is the preview's own session. */
    id: i === 0 ? 'u-owner' : `u-${i + 1}`,
    name,
    email,
    role,
    title,
    photoUrl: null as string | null,
    isActive: true,
    neverSignedIn: false,
    lastLoginAt: new Date(Date.now() - (i === 0 ? 1 : (i + 1) * 37) * 60_000).toISOString(),
    openLeads: open,
    attendance,
    phonePlatform: phone,
    computerAlerts: computer,
    lastAlertAt: phone ? new Date(Date.now() - 5 * 60_000).toISOString() : null,
    lastAlertOpened: Boolean(phone),
  })),
};

function teamCounts() {
  const live = teamState.members.filter((one) => one.isActive);
  const by = (role: string) => live.filter((one) => one.role === role).length;
  const withAlerts = live.filter((one) => one.phonePlatform || one.computerAlerts).length;
  return {
    people: live.length,
    owners: by('owner'),
    admins: by('admin'),
    managers: by('manager'),
    agents: by('agent'),
    deactivated: teamState.members.length - live.length,
    neverSignedIn: live.filter((one) => one.neverSignedIn).length,
    withAlerts,
    withoutAlerts: live.length - withAlerts,
  };
}

/* ── feedback ──────────────────────────────────────────────────────────── */

interface Reply { id: string; body: string; author: string | null; createdAt: string }

interface Ticket {
  id: string; ref: number; kind: string; kindWord: string; title: string; body: string;
  screen: string | null; status: 'new' | 'planned' | 'fixed' | 'declined';
  urgency: 'low' | 'normal' | 'blocking'; urgencyWord: string; blocking: boolean;
  hasScreenshot: boolean; hasVoice: boolean; voiceSeconds: number | null;
  reply: string | null; repliedBy: string | null; replies: Reply[];
  fromName: string | null; fromId: string; createdAt: string;
}

const KIND_WORDS: Record<string, string> = {
  bug: 'Bug', issue: 'Issue', feature: 'New feature', idea: 'Idea', question: 'Question',
};
const URGENCY_WORDS: Record<string, string> = {
  low: 'Low', normal: 'Normal', blocking: 'Blocking my work',
};

const tickets: Ticket[] = [
  {
    id: 'fb-1', ref: 1042, kind: 'bug', kindWord: 'Bug',
    title: 'The Call button does nothing on imported leads',
    body: 'I press Call on Sami Najahi and nothing happens. On my other leads it works. '
      + 'I cannot call the imported leads from the computer.',
    screen: 'Lead page · Sami Najahi', status: 'new',
    urgency: 'blocking', urgencyWord: 'Blocking my work', blocking: true,
    hasScreenshot: true, hasVoice: true, voiceSeconds: 18,
    reply: null, repliedBy: null, replies: [],
    fromName: 'Rocky Khan', fromId: 'u-5',
    createdAt: new Date(Date.now() - 75 * 60_000).toISOString(),
  },
  {
    id: 'fb-2', ref: 1041, kind: 'idea', kindWord: 'Idea',
    title: 'Show the client’s local time in the call list',
    body: 'When I call Russia and Europe I check the time on Google. '
      + 'Please show it next to the name.',
    screen: 'Calling', status: 'new', urgency: 'normal', urgencyWord: 'Normal', blocking: false,
    hasScreenshot: false, hasVoice: false, voiceSeconds: null,
    reply: null, repliedBy: null, replies: [],
    fromName: 'Yuliia', fromId: 'u-6',
    createdAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
  },
  {
    id: 'fb-3', ref: 1040, kind: 'issue', kindWord: 'Issue',
    title: 'Calendar shows my site visit one hour late',
    body: 'I booked 15:00 and the calendar shows 16:00. Maybe a time zone problem, '
      + 'I was in Abu Dhabi.',
    screen: 'Calendar', status: 'new', urgency: 'normal', urgencyWord: 'Normal', blocking: false,
    hasScreenshot: true, hasVoice: false, voiceSeconds: null,
    reply: null, repliedBy: null, replies: [],
    fromName: 'Nelson', fromId: 'u-11',
    createdAt: new Date(Date.now() - 22 * 3_600_000).toISOString(),
  },
  {
    id: 'fb-4', ref: 1038, kind: 'feature', kindWord: 'New feature',
    title: 'Ready WhatsApp messages in Arabic',
    body: 'Half of my clients write in Arabic. I type the same hello every time.',
    screen: 'Lead page · WhatsApp', status: 'planned',
    urgency: 'low', urgencyWord: 'Low', blocking: false,
    hasScreenshot: false, hasVoice: true, voiceSeconds: 11,
    reply: 'Good idea. Planned with the templates, later phase.', repliedBy: 'Emir Dulovic',
    replies: [{
      id: 'r-1', body: 'Good idea. Planned with the templates, later phase.',
      author: 'Emir Dulovic', createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    }],
    fromName: 'Shan', fromId: 'u-10',
    createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  },
  {
    id: 'fb-5', ref: 1031, kind: 'bug', kindWord: 'Bug',
    title: 'Check-in fails on the 5G office Wi-Fi',
    body: 'It says “not the office network” on homes.me-Office-5G.',
    screen: 'Attendance', status: 'fixed', urgency: 'blocking', urgencyWord: 'Blocking my work',
    blocking: true, hasScreenshot: true, hasVoice: false, voiceSeconds: null,
    reply: 'Fixed. The 5G network is on the list now.', repliedBy: 'Emir Dulovic',
    replies: [{
      id: 'r-2', body: 'Fixed. The 5G network is on the list now.',
      author: 'Emir Dulovic', createdAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    }],
    fromName: 'Olga', fromId: 'u-7',
    createdAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
  },
  {
    id: 'fb-6', ref: 1027, kind: 'idea', kindWord: 'Idea',
    title: 'Dark mode for the evening',
    body: 'My eyes are tired after 17:00.',
    screen: 'Settings', status: 'fixed', urgency: 'low', urgencyWord: 'Low', blocking: false,
    hasScreenshot: false, hasVoice: false, voiceSeconds: null,
    reply: null, repliedBy: null, replies: [],
    fromName: 'Srdjan', fromId: 'u-8',
    createdAt: new Date(Date.now() - 14 * 86_400_000).toISOString(),
  },
];

function counts() {
  return {
    new: tickets.filter((one) => one.status === 'new').length,
    planned: tickets.filter((one) => one.status === 'planned').length,
    fixed: tickets.filter((one) => one.status === 'fixed').length,
    declined: tickets.filter((one) => one.status === 'declined').length,
    blocking: tickets.filter((one) => one.urgency === 'blocking' && one.status === 'new').length,
    all: tickets.length,
  };
}

/* ── banners ───────────────────────────────────────────────────────────── */

interface Banner {
  id: string; title: string; label: string; body: string | null; buttonText: string | null;
  opens: string; audience: 'everyone' | 'agents' | 'desk'; deskId: string | null;
  deskName: string | null; linkUrl: string | null; imagePath: string | null;
  startsAt: string | null; endsAt: string | null; position: number; isActive: boolean;
  state: 'Live' | 'Scheduled' | 'Ended'; seenBy: number; audienceSize: number;
}

const day = (offset: number) =>
  new Date(Date.now() + 4 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

function stateOf(one: { startsAt: string | null; endsAt: string | null; isActive: boolean }) {
  const today = day(0);
  if (!one.isActive) return 'Ended' as const;
  if (one.endsAt && one.endsAt < today) return 'Ended' as const;
  if (one.startsAt && one.startsAt > today) return 'Scheduled' as const;
  return 'Live' as const;
}

const banners: Banner[] = [
  {
    id: 'b-1', title: 'Cityscape Global · 17–19 Nov', label: 'From Emir',
    body: 'We are at DWTC, stand B12. Bring your hot leads to the stand.',
    buttonText: 'See the plan', opens: 'Team wall', audience: 'everyone',
    deskId: null, deskName: null, linkUrl: null, imagePath: null,
    startsAt: day(-2), endsAt: day(8), position: 1, isActive: true,
    state: 'Live', seenBy: 9, audienceSize: 10,
  },
  {
    id: 'b-2', title: 'Valia launches soon', label: 'Project',
    body: 'Emaar · The Oasis · from AED 1.4M · payment plan 80 / 20.',
    buttonText: 'Open Valia', opens: 'Project page', audience: 'agents',
    deskId: null, deskName: null, linkUrl: null, imagePath: null,
    startsAt: day(-5), endsAt: day(19), position: 2, isActive: true,
    state: 'Live', seenBy: 7, audienceSize: 10,
  },
  {
    id: 'b-3', title: 'Payment plans in 20 minutes', label: 'Training',
    body: 'Monday · 09:15 · meeting room. Short and useful.',
    buttonText: null, opens: 'Team wall', audience: 'agents',
    deskId: null, deskName: null, linkUrl: null, imagePath: null,
    startsAt: day(5), endsAt: day(5), position: 3, isActive: true,
    state: 'Scheduled', seenBy: 0, audienceSize: 10,
  },
  {
    id: 'b-4', title: 'New rule: book the meeting room', label: 'Office',
    body: 'Use the calendar before you bring a client.',
    buttonText: 'Open calendar', opens: 'A web link', audience: 'everyone',
    deskId: null, deskName: null, linkUrl: 'https://crm.homes.me/v2/calendar', imagePath: null,
    startsAt: day(-22), endsAt: day(-11), position: 4, isActive: true,
    state: 'Ended', seenBy: 10, audienceSize: 10,
  },
];

const DESKS = [
  { id: 'd-1', name: 'Dubai off-plan' },
  { id: 'd-2', name: 'Arabic desk' },
  { id: 'd-3', name: 'Abu Dhabi' },
];

const BANNER_LABELS = ['From Emir', 'Office', 'Project', 'Best of Homes', 'Training'];
const BANNER_OPENS = ['Project page', 'Best of Homes', 'Team wall', 'A web link'];

export const SETTINGS_ROUTES: MockRoute[] = [
  { method: 'GET', pattern: /^\/api\/v2\/health$/, handler: () => healthReport() },
  { method: 'POST', pattern: /^\/api\/v2\/health\/check$/, handler: () => healthReport() },

  /* ── team and roles ─────────────────────────────────────────────────── */

  { method: 'GET', pattern: /^\/api\/v2\/team\/roles$/, handler: () => ({
    members: teamState.members, counts: teamCounts(),
  }) },
  { method: 'POST', pattern: /^\/api\/v2\/team\/remind-alerts$/, handler: ({ body }) => {
    const ids = ((body ?? {}) as { userIds?: string[] }).userIds ?? [];
    return {
      reminded: teamState.members
        .filter((one) => ids.includes(one.id))
        .map((one) => one.name),
    };
  } },
  { method: 'POST', pattern: /^\/api\/users\/([^/]+)\/sign-out-everywhere$/, handler: () => ({
    sessionsEnded: 2, name: 'Rocky Khan',
  }) },

  /* ── attendance: the monthly file ───────────────────────────────────── */

  { method: 'GET', pattern: /^\/api\/attendance\/report\/months$/, handler: () => {
    const now = new Date(Date.now() + 4 * 3_600_000);
    return {
      months: [0, 1, 2].map((back) => {
        const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
        return {
          key: at.toISOString().slice(0, 7),
          label: at.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
          workingDays: back === 0 ? 8 : 22,
          people: 10,
        };
      }),
    };
  } },

  /* ── feedback ───────────────────────────────────────────────────────── */

  { method: 'GET', pattern: /^\/api\/v2\/feedback$/, handler: ({ query }) => {
    const filter = query.get('filter') ?? 'all';
    const items = filter === 'all'
      ? tickets
      : filter === 'blocking'
        ? tickets.filter((one) => one.urgency === 'blocking')
        : tickets.filter((one) => one.status === filter);
    /* Blocking first whatever the date, the same as the server. */
    return {
      items: [...items].sort((a, b) => Number(b.blocking) - Number(a.blocking)
        || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      counts: counts(),
      points: 15,
    };
  } },

  { method: 'GET', pattern: /^\/api\/v2\/feedback\/mine$/, handler: () => ({
    items: tickets.filter((one) => one.fromId === 'u-5'),
  }) },

  { method: 'POST', pattern: /^\/api\/v2\/feedback$/, handler: ({ body }) => {
    const input = (body ?? {}) as Record<string, unknown>;
    const kind = String(input.kind ?? 'bug');
    const urgency = String(input.urgency ?? 'normal') as Ticket['urgency'];
    const made: Ticket = {
      id: `fb-${Date.now()}`,
      ref: Math.max(...tickets.map((one) => one.ref)) + 1,
      kind,
      kindWord: KIND_WORDS[kind] ?? 'Bug',
      title: String(input.title ?? input.body ?? ''),
      body: String(input.body ?? ''),
      screen: (input.screen as string) ?? null,
      status: 'new',
      urgency,
      urgencyWord: URGENCY_WORDS[urgency] ?? 'Normal',
      blocking: urgency === 'blocking',
      hasScreenshot: false, hasVoice: false, voiceSeconds: null,
      reply: null, repliedBy: null, replies: [],
      fromName: 'Rocky Khan', fromId: 'u-5',
      createdAt: new Date().toISOString(),
    };
    tickets.unshift(made);
    return made;
  } },

  { method: 'POST', pattern: /^\/api\/v2\/feedback\/([^/]+)\/(screenshot|voice)$/, handler: ({ params }) => {
    const one = tickets.find((row) => row.id === params[0]);
    if (one && params[1] === 'voice') { one.hasVoice = true; one.voiceSeconds = 9; }
    if (one && params[1] === 'screenshot') one.hasScreenshot = true;
    return { kind: params[1], bytes: 2048, seconds: params[1] === 'voice' ? 9 : null };
  } },

  { method: 'PATCH', pattern: /^\/api\/v2\/feedback\/([^/]+)$/, handler: ({ params, body }) => {
    const one = tickets.find((row) => row.id === params[0]);
    if (!one) return { ok: false };
    const input = (body ?? {}) as { status?: Ticket['status']; reply?: string };
    if (input.status) one.status = input.status;
    if (input.reply !== undefined) {
      const written = (input.reply ?? '').trim();
      if (!written) {
        throw Object.assign(new Error('Write your reply first.'), { status: 400 });
      }
      one.reply = written;
      one.repliedBy = 'Emir Dulovic';
      one.replies = [...one.replies, {
        id: `r-${Date.now()}`, body: written, author: 'Emir Dulovic',
        createdAt: new Date().toISOString(),
      }];
    }
    return one;
  } },

  /* ── banners ────────────────────────────────────────────────────────── */

  { method: 'GET', pattern: /^\/api\/v2\/banners$/, handler: () => ({
    items: banners.map((one) => ({ ...one, state: stateOf(one) })),
    desks: DESKS,
    labels: BANNER_LABELS,
    opens: BANNER_OPENS,
    max: 5,
    rotateSeconds: 4.5,
  }) },

  { method: 'POST', pattern: /^\/api\/v2\/banners$/, handler: ({ body }) => {
    const live = banners.filter((one) => stateOf(one) !== 'Ended').length;
    if (live >= 5) {
      throw Object.assign(
        new Error('There are already 5 banners showing. Switch one off before adding another.'),
        { status: 400 },
      );
    }
    const input = (body ?? {}) as Record<string, unknown>;
    const made: Banner = {
      id: `b-${Date.now()}`,
      title: String(input.title ?? ''),
      label: String(input.label ?? 'From Emir'),
      body: (input.body as string) ?? null,
      buttonText: (input.buttonText as string) ?? null,
      opens: String(input.opens ?? 'Project page'),
      audience: (input.audience as Banner['audience']) ?? 'everyone',
      deskId: (input.deskId as string) ?? null,
      deskName: DESKS.find((one) => one.id === input.deskId)?.name ?? null,
      linkUrl: (input.linkUrl as string) ?? null,
      imagePath: null,
      startsAt: (input.startsAt as string) ?? null,
      endsAt: (input.endsAt as string) ?? null,
      position: banners.length + 1,
      isActive: true,
      state: 'Live',
      seenBy: 0,
      audienceSize: 10,
    };
    made.state = stateOf(made);
    banners.push(made);
    return made;
  } },

  { method: 'POST', pattern: /^\/api\/v2\/banners\/([^/]+)\/image$/, handler: ({ params }) => {
    const one = banners.find((row) => row.id === params[0]);
    if (one) one.imagePath = `${one.id}.png`;
    return one ?? { ok: false };
  } },

  { method: 'PATCH', pattern: /^\/api\/v2\/banners\/([^/]+)$/, handler: ({ params, body }) => {
    const one = banners.find((row) => row.id === params[0]);
    if (!one) return { ok: false };
    const input = (body ?? {}) as Partial<Banner>;
    Object.assign(one, input);
    one.deskName = DESKS.find((desk) => desk.id === one.deskId)?.name ?? null;
    one.state = stateOf(one);
    return one;
  } },

  { method: 'DELETE', pattern: /^\/api\/v2\/banners\/([^/]+)$/, handler: ({ params }) => {
    const at = banners.findIndex((row) => row.id === params[0]);
    if (at >= 0) banners.splice(at, 1);
    return { deleted: true };
  } },

  { method: 'POST', pattern: /^\/api\/v2\/banners\/order$/, handler: ({ body }) => {
    const ids = ((body ?? {}) as { ids?: string[] }).ids ?? [];
    const sorted = ids
      .map((id) => banners.find((one) => one.id === id))
      .filter((one): one is Banner => Boolean(one));
    banners.length = 0;
    banners.push(...sorted.map((one, i) => ({ ...one, position: i + 1 })));
    return { items: [...banners] };
  } },
];
