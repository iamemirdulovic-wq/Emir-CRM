/**
 * The preview's answers for the settings pages built last.
 *
 * A separate file rather than more rows in `mock-api.ts` because several
 * people were editing that file at once and a lost update there is a route
 * that silently 404s in the demo. It is spread into `ROUTES` at the end.
 */
type Handler = (ctx: { params: string[]; body: Record<string, unknown>; query: URLSearchParams }) => unknown;
export type MockRoute = { method: string; pattern: RegExp; handler: Handler };

/* Deliberately not all healthy: a demo where everything is connected never
   shows what the screen is for. */
const health = {
  services: [
    { key: 'email', title: 'Email', consequence: 'Client emails will not send.', ready: true, to: '/settings/integrations' },
    { key: 'whatsapp', title: 'WhatsApp', consequence: 'Follow-ups outside 24 hours will not send.', ready: true, to: '/settings/integrations' },
    { key: 'push', title: 'Phone alerts', consequence: 'The five-minute rule only works with the CRM open.', ready: true, to: '/settings/integrations' },
    { key: 'ai', title: 'Homes AI', consequence: 'Every AI answer fails with a key error.', ready: true, to: '/v2/settings/ai' },
    { key: 'attendance', title: 'Office check-in', consequence: 'Nobody is asked to check in.', ready: false, to: '/v2/settings/attendance' },
  ],
  outstanding: 1,
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

interface Ticket {
  id: string; kind: string; body: string; screen: string | null;
  status: 'new' | 'planned' | 'fixed' | 'declined'; blocking: boolean;
  reply: string | null; repliedBy: string | null; fromName: string | null;
  fromId: string; createdAt: string;
}

const tickets: Ticket[] = [
  {
    id: 'fb-1', kind: 'bug',
    body: 'The call button does nothing on the lead page when the lead has no project.',
    screen: '/v2/leads/o-1', status: 'new', blocking: true, reply: null, repliedBy: null,
    fromName: 'Omar Haddad', fromId: 'u-omar',
    createdAt: new Date(Date.now() - 50 * 60_000).toISOString(),
  },
  {
    id: 'fb-2', kind: 'idea',
    body: 'Could the offer link show me the moment the client opens it, on the phone?',
    screen: '/v2/offers', status: 'planned', blocking: false,
    reply: 'Good idea. It is on the list for next month.', repliedBy: 'Emir Dulovic',
    fromName: 'Layla Hassan', fromId: 'u-layla',
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
  {
    id: 'fb-3', kind: 'question',
    body: 'The week view on the calendar is hard to read on my phone.',
    screen: '/v2/calendar', status: 'fixed', blocking: false,
    reply: 'Fixed — it scrolls sideways now.', repliedBy: 'Emir Dulovic',
    fromName: 'Priya Nair', fromId: 'u-priya',
    createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  },
];

interface Banner {
  id: string; title: string; body: string | null; linkUrl: string | null;
  imagePath: string | null; position: number; isActive: boolean;
}

const banners: Banner[] = [
  { id: 'b-1', title: 'Valia launches on Sunday', body: 'Prices from AED 2.1M · ask me for the list', linkUrl: '/v2/projects', imagePath: null, position: 1, isActive: true },
  { id: 'b-2', title: 'Best of Homes · October', body: 'Layla took the month with 6 bookings', linkUrl: '/v2/wall', imagePath: null, position: 2, isActive: true },
  { id: 'b-3', title: 'Office closed on the 2nd', body: 'National Day. Back on the 3rd.', linkUrl: null, imagePath: null, position: 3, isActive: false },
];

function counts() {
  return {
    new: tickets.filter((one) => one.status === 'new').length,
    planned: tickets.filter((one) => one.status === 'planned').length,
    fixed: tickets.filter((one) => one.status === 'fixed').length,
    declined: tickets.filter((one) => one.status === 'declined').length,
    blocking: tickets.filter((one) => one.blocking && one.status === 'new').length,
  };
}

export const SETTINGS_ROUTES: MockRoute[] = [
  { method: 'GET', pattern: /^\/api\/v2\/health$/, handler: () => health },

  { method: 'GET', pattern: /^\/api\/v2\/feedback$/, handler: ({ query }) => {
    const filter = query.get('filter') ?? 'all';
    const items = filter === 'all'
      ? tickets
      : filter === 'blocking'
        ? tickets.filter((one) => one.blocking)
        : tickets.filter((one) => one.status === filter);
    /* Blocking first whatever the date, the same as the server. */
    return {
      items: [...items].sort((a, b) => Number(b.blocking) - Number(a.blocking)
        || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      counts: counts(),
    };
  } },

  { method: 'GET', pattern: /^\/api\/v2\/feedback\/mine$/, handler: () => ({
    items: tickets.filter((one) => one.fromId === 'u-layla'),
  }) },

  { method: 'POST', pattern: /^\/api\/v2\/feedback$/, handler: ({ body }) => {
    const input = (body ?? {}) as Record<string, unknown>;
    const made: Ticket = {
      id: `fb-${Date.now()}`,
      kind: String(input.kind ?? 'bug'),
      body: String(input.body ?? ''),
      screen: (input.screen as string) ?? null,
      status: 'new',
      blocking: Boolean(input.blocking),
      reply: null, repliedBy: null,
      fromName: 'Layla Hassan', fromId: 'u-layla',
      createdAt: new Date().toISOString(),
    };
    tickets.unshift(made);
    return made;
  } },

  { method: 'PATCH', pattern: /^\/api\/v2\/feedback\/([^/]+)$/, handler: ({ params, body }) => {
    const one = tickets.find((row) => row.id === params[0]);
    if (!one) return { ok: false };
    const input = (body ?? {}) as { status?: Ticket['status']; reply?: string };
    if (input.status) one.status = input.status;
    if (input.reply !== undefined) {
      one.reply = input.reply || null;
      one.repliedBy = 'Emir Dulovic';
    }
    return one;
  } },

  { method: 'GET', pattern: /^\/api\/v2\/banners$/, handler: () => ({ items: [...banners] }) },

  { method: 'POST', pattern: /^\/api\/v2\/banners$/, handler: ({ body }) => {
    if (banners.filter((one) => one.isActive).length >= 5) {
      throw Object.assign(new Error('There are already 5 banners showing. Switch one off before adding another.'), { status: 400 });
    }
    const input = (body ?? {}) as Record<string, unknown>;
    const made: Banner = {
      id: `b-${Date.now()}`,
      title: String(input.title ?? ''),
      body: (input.body as string) ?? null,
      linkUrl: (input.linkUrl as string) ?? null,
      imagePath: null,
      position: banners.length + 1,
      isActive: true,
    };
    banners.push(made);
    return made;
  } },

  { method: 'PATCH', pattern: /^\/api\/v2\/banners\/([^/]+)$/, handler: ({ params, body }) => {
    const one = banners.find((row) => row.id === params[0]);
    if (!one) return { ok: false };
    const input = (body ?? {}) as Partial<Banner>;
    if (input.isActive === true && !one.isActive
      && banners.filter((row) => row.isActive).length >= 5) {
      throw Object.assign(new Error('There are already 5 banners showing. Switch one off before switching this on.'), { status: 400 });
    }
    Object.assign(one, input);
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
