import {
  AUTOMATIONS,
  CAMPAIGNS,
  DIALLER_QUEUE,
  IMPORTS,
  LEADS,
  LISTS,
  LOST_REASONS,
  PROJECTS,
  STAGES,
  TASKS,
  TEAMS,
  TEMPLATES,
  THREADS,
  UNMAPPED_QUESTIONS,
  USERS,
  ago,
  fallbackThread,
  previewArrivals,
  previewSeries,
} from './data.js';

/**
 * Serves the CRM's API from memory so the UI can be demonstrated without a
 * backend.
 *
 * It is a demo surface, not a second implementation: it returns the same shapes
 * the real endpoints return, and mutations change the in-memory data so moving
 * a card or sending a message behaves the way it does in the real app. It is
 * loaded only when VITE_PREVIEW=1, and a production build drops it entirely.
 */

type Handler = (ctx: { params: string[]; body: Record<string, unknown>; query: URLSearchParams }) => unknown;
type Route = { method: string; pattern: RegExp; handler: Handler };

const OWNER = USERS[0]!;
const PERMISSIONS = [
  'contacts:read:own', 'contacts:read:team', 'contacts:read:all', 'contacts:write', 'contacts:merge',
  'contacts:delete', 'opportunities:move:own', 'opportunities:move:any', 'opportunities:reassign',
  'messages:send', 'messages:read:all', 'templates:manage', 'projects:manage', 'workflows:manage',
  'integrations:manage', 'users:manage', 'reports:team', 'reports:all', 'export', 'bulk:delete', 'audit:read',
];

/** The preview always starts signed in — an empty login screen demonstrates nothing. */
const session = { signedIn: true, locale: 'en' };

const currentUser = () => ({
  id: OWNER.id,
  name: OWNER.name,
  email: OWNER.email,
  role: OWNER.role,
  locale: session.locale,
  availability: 'available' as const,
  mustChangePassword: false,
  permissions: PERMISSIONS,
});

const userName = (id: string | null) => USERS.find((u) => u.id === id)?.name ?? null;

function card(lead: (typeof LEADS)[number]) {
  return {
    id: lead.id,
    title: `${lead.name}${lead.project ? ` — ${lead.project}` : ''}`,
    stage_key: lead.stage,
    sub_status: lead.subStatus,
    status: lead.status,
    owner_user_id: lead.owner,
    owner_name: userName(lead.owner),
    project_name: lead.project,
    budget_min_aed: lead.budgetMin,
    budget_max_aed: lead.budgetMax,
    budget_band: null,
    unit_type: lead.unitType,
    emirate: null,
    timeline: lead.timeline,
    lead_score: lead.score,
    source: lead.source,
    campaign_name: lead.campaign,
    created_at: ago(lead.createdMinutesAgo),
    stage_changed_at: ago(Math.max(1, lead.createdMinutesAgo - 5)),
    sla_breached: lead.slaBreached,
    contact_id: lead.contactId,
    full_name: lead.name,
    phone_e164: lead.phone,
    wa_id: lead.phone.replace('+', ''),
    email: lead.email,
    language: lead.language,
    last_inbound_at: lead.unread > 0 ? ago(5) : null,
    dnc: lead.dnc,
  };
}

function threadFor(conversationId: string) {
  const lead = LEADS.find((l) => l.conversationId === conversationId);
  if (!lead) return null;
  if (!THREADS[conversationId]) THREADS[conversationId] = fallbackThread(lead);
  return { lead, thread: THREADS[conversationId]! };
}

const ROUTES: Route[] = [
  // --- auth ---------------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/auth\/me$/, handler: () => {
    if (!session.signedIn) throw { status: 401, code: 'unauthorized', message: 'Authentication required' };
    return { user: currentUser() };
  } },
  { method: 'POST', pattern: /^\/api\/auth\/login$/, handler: ({ body }) => {
    // Any password is accepted in the preview; a wrong one still demonstrates
    // the error path when the field is left empty.
    if (!body.email || !body.password) throw { status: 401, code: 'unauthorized', message: 'Invalid email or password' };
    session.signedIn = true;
    return { user: currentUser() };
  } },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/, handler: () => { session.signedIn = false; return { ok: true }; } },
  { method: 'POST', pattern: /^\/api\/auth\/change-password$/, handler: () => ({ ok: true }) },

  // --- pipeline -----------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/pipeline\/definition$/, handler: () => ({
    pipelineKey: 'offplan_sales', stages: STAGES, lostReasons: LOST_REASONS,
  }) },
  { method: 'GET', pattern: /^\/api\/pipeline\/board$/, handler: ({ query }) => {
    const search = (query.get('search') ?? '').toLowerCase();
    const owner = query.get('ownerUserId') ?? '';
    const visible = LEADS.filter((lead) => {
      if (owner && lead.owner !== owner) return false;
      if (!search) return true;
      return [lead.name, lead.phone, lead.email, lead.project].some((v) => (v ?? '').toLowerCase().includes(search));
    });
    return {
      pipelineKey: 'offplan_sales',
      columns: STAGES.map((stage) => {
        const cards = visible.filter((l) => l.stage === stage.key).map(card);
        return { stageKey: stage.key, stageName: stage.name, position: stage.position, total: cards.length, cards };
      }),
      scope: null,
    };
  } },
  { method: 'POST', pattern: /^\/api\/pipeline\/opportunities\/([^/]+)\/stage$/, handler: ({ params, body }) => {
    const lead = LEADS.find((l) => l.id === params[0]);
    if (!lead) throw { status: 404, code: 'not_found', message: 'Opportunity not found' };
    const to = String(body.to);
    if (to === 'lost' && !body.lostReason) {
      throw { status: 400, code: 'bad_request', message: 'A lost reason is required: not_interested, budget_mismatch, bought_elsewhere, unresponsive or invalid' };
    }
    const from = lead.stage;
    lead.stage = to;
    lead.subStatus = (body.subStatus as string) ?? null;
    lead.status = to === 'won' ? 'won' : to === 'lost' ? 'lost' : 'open';
    if (to === 'lost') lead.lostReason = String(body.lostReason);
    return { opportunityId: lead.id, from, to, subStatus: lead.subStatus, qualityEvent: null };
  } },
  { method: 'POST', pattern: /^\/api\/pipeline\/opportunities\/([^/]+)\/reassign$/, handler: ({ params, body }) => {
    const lead = LEADS.find((l) => l.id === params[0]);
    if (lead) lead.owner = String(body.toUserId);
    return { ok: true };
  } },
  { method: 'GET', pattern: /^\/api\/pipeline\/unassigned$/, handler: () => ({
    items: LEADS.filter((l) => !l.owner).map((l) => ({
      id: `q-${l.id}`, opportunity_id: l.id, contact_id: l.contactId, reason: 'no_agent_available',
      created_at: ago(l.createdMinutesAgo), title: l.name, project_name: l.project, source: l.source,
      full_name: l.name, phone_e164: l.phone, language: l.language,
    })),
  }) },

  // --- users --------------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/users$/, handler: () => ({ items: USERS }) },
  { method: 'PATCH', pattern: /^\/api\/users\/([^/]+)$/, handler: ({ params, body }) => {
    const user = USERS.find((u) => u.id === params[0]);
    if (user) {
      if (body.availability) user.availability = String(body.availability);
      if (body.isActive !== undefined) user.is_active = body.isActive ? 1 : 0;
      if (body.locale) session.locale = String(body.locale);
    }
    return { ok: true };
  } },
  { method: 'POST', pattern: /^\/api\/users$/, handler: ({ body }) => {
    const id = `u-${Math.random().toString(36).slice(2, 8)}`;
    USERS.push({
      id, name: String(body.name), email: String(body.email), role: String(body.role),
      is_active: 1, availability: 'available', routing_weight: Number(body.routingWeight ?? 10),
      languages: (body.languages as string[]) ?? [], projects_covered: (body.projectsCovered as string[]) ?? [],
      manager_id: 'u-owner', last_login_at: null,
    });
    return { id, email: body.email, temporaryPassword: 'Tmp7xKqR2vLm!7' };
  } },
  { method: 'POST', pattern: /^\/api\/users\/([^/]+)\/reset-password$/, handler: () => ({ temporaryPassword: 'Tmp7xKqR2vLm!7' }) },
  { method: 'POST', pattern: /^\/api\/users\/([^/]+)\/unlock$/, handler: () => ({ ok: true }) },
  { method: 'POST', pattern: /^\/api\/users\/me\/push-tokens$/, handler: () => ({ ok: true }) },

  // --- contacts -----------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/contacts$/, handler: ({ query }) => {
    const search = (query.get('search') ?? '').toLowerCase();
    const items = LEADS.filter((l) =>
      !search || [l.name, l.phone, l.email].some((v) => (v ?? '').toLowerCase().includes(search)),
    ).map((l) => ({
      id: l.contactId, full_name: l.name, phone_e164: l.phone, email: l.email, lead_score: l.score,
      dnc: l.dnc, owner_name: userName(l.owner), first_source: l.source,
      last_inbound_at: l.unread > 0 ? ago(5) : null, created_at: ago(l.createdMinutesAgo),
    }));
    return { items, page: 1, pageSize: 25, total: items.length };
  } },
  { method: 'GET', pattern: /^\/api\/contacts\/([^/]+)$/, handler: ({ params }) => {
    const lead = LEADS.find((l) => l.contactId === params[0]);
    if (!lead) throw { status: 404, code: 'not_found', message: 'Contact not found' };
    const thread = THREADS[lead.conversationId] ?? fallbackThread(lead);

    return {
      contact: {
        id: lead.contactId, full_name: lead.name, first_name: lead.name.split(' ')[0],
        phone_e164: lead.phone, wa_id: lead.phone.replace('+', ''), email: lead.email,
        language: lead.language, lead_score: lead.score, dnc: lead.dnc,
        owner_name: userName(lead.owner), owner_email: USERS.find((u) => u.id === lead.owner)?.email ?? null,
        first_source: lead.source, created_at: ago(lead.createdMinutesAgo), notes: null,
        ai_summary: lead.score >= 70
          ? `Ready buyer for ${lead.project ?? 'off-plan'} with a stated budget of ${lead.budgetMax ? `AED ${lead.budgetMax.toLocaleString()}` : 'unspecified'}.\nAsked about pricing and floor plans; replies within minutes on WhatsApp.\nNext step: confirm the viewing and send the payment plan.`
          : null,
      },
      opportunities: [{
        id: lead.id, title: lead.name, stage_key: lead.stage, sub_status: lead.subStatus, status: lead.status,
        lost_reason: lead.lostReason ?? null, owner_user_id: lead.owner, project_name: lead.project,
        developer: PROJECTS.find((p) => p.name === lead.project)?.developer ?? null,
        emirate: PROJECTS.find((p) => p.name === lead.project)?.emirate ?? null,
        unit_type: lead.unitType, budget_min_aed: lead.budgetMin, budget_max_aed: lead.budgetMax,
        budget_band: null, purpose: lead.purpose, payment_method: 'payment_plan', timeline: lead.timeline,
        golden_visa_interest: lead.score > 70 ? 1 : 0, deal_value_aed: null, expected_commission_aed: null,
        lead_score: lead.score, source: lead.source, campaign_name: lead.campaign,
        adset_name: lead.campaign ? 'AE-Investors-30-55' : null, ad_name: lead.campaign ? 'DXB-Beachfront-Video-01' : null,
        created_at: ago(lead.createdMinutesAgo), stage_changed_at: ago(Math.max(1, lead.createdMinutesAgo - 5)),
        closed_at: lead.status === 'open' ? null : ago(10), sla_breached: lead.slaBreached,
      }],
      activities: buildActivities(lead, thread),
      tasks: lead.score >= 70
        ? [{ id: `tk-${lead.id}`, type: 'call', title: 'Call back — the lead asked to be called', notes: null, priority: 'urgent', due_at: ago(-5), completed_at: null, assigned_user_id: lead.owner, assignee_name: userName(lead.owner) }]
        : [],
      tags: lead.tags,
      tagDetails: lead.tags.map((t) => ({ namespace: t.split(':')[0], value: t.split(':')[1], label: null })),
      consents: [
        { channel: 'whatsapp', granted: 1, source: lead.source, consent_text: 'I agree to be contacted by Emir Real Estate by phone, WhatsApp and email about property offers.', created_at: ago(lead.createdMinutesAgo) },
        ...(lead.email ? [{ channel: 'email', granted: 1, source: lead.source, consent_text: 'I agree to be contacted by Emir Real Estate by phone, WhatsApp and email about property offers.', created_at: ago(lead.createdMinutesAgo) }] : []),
      ],
      identities: [],
      aiSuggestions: lead.unitType
        ? [{ id: `ai-${lead.id}`, field: 'unit_type', value: lead.unitType, confidence: 0.86, status: 'applied', created_at: ago(20) }]
        : [],
      conversation: { id: lead.conversationId, assigned_user_id: lead.owner, last_message_at: ago(5), last_inbound_at: ago(5), wa_window_expires_at: lead.windowOpen ? ago(-1400) : ago(120), unread_count: lead.unread, status: 'open' },
    };
  } },
  { method: 'POST', pattern: /^\/api\/contacts\/([^/]+)\/notes$/, handler: ({ params, body }) => {
    const lead = LEADS.find((l) => l.contactId === params[0]);
    if (lead) {
      const thread = THREADS[lead.conversationId] ?? (THREADS[lead.conversationId] = fallbackThread(lead));
      thread.events.unshift({ id: `n-${Date.now()}`, type: 'note', title: 'Note', body: String(body.body), created_at: new Date().toISOString() });
    }
    return { id: `n-${Date.now()}` };
  } },
  { method: 'POST', pattern: /^\/api\/contacts\/([^/]+)\/dnc$/, handler: ({ params }) => {
    const lead = LEADS.find((l) => l.contactId === params[0]);
    if (lead) lead.dnc = 1;
    return { ok: true };
  } },
  { method: 'POST', pattern: /^\/api\/contacts\/tasks\/([^/]+)\/complete$/, handler: () => ({ ok: true }) },
  { method: 'PATCH', pattern: /^\/api\/contacts\/([^/]+)$/, handler: ({ params }) => {
    const lead = LEADS.find((l) => l.contactId === params[0]);
    if (!lead) throw { status: 404, code: 'not_found', message: 'Contact not found' };
    return { ok: true };
  } },
  { method: 'GET', pattern: /^\/api\/contacts\/duplicates\/pending$/, handler: () => ({ items: [] }) },

  // --- inbox --------------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/inbox\/conversations$/, handler: ({ query }) => {
    const filter = query.get('filter') ?? 'all';
    const unread = query.get('unread') === '1';
    const search = (query.get('search') ?? '').toLowerCase();

    const items = LEADS.filter((lead) => {
      if (filter === 'unassigned' && lead.owner) return false;
      if (unread && lead.unread === 0) return false;
      if (search && ![lead.name, lead.phone, lead.email].some((v) => (v ?? '').toLowerCase().includes(search))) return false;
      return true;
    }).map((lead) => {
      const thread = THREADS[lead.conversationId] ?? fallbackThread(lead);
      const last = thread.messages[thread.messages.length - 1] as Record<string, unknown> | undefined;
      return {
        id: lead.conversationId, contact_id: lead.contactId, assigned_user_id: lead.owner,
        assignee_name: userName(lead.owner), status: 'open', unread_count: lead.unread,
        last_message_at: (last?.created_at as string) ?? ago(lead.createdMinutesAgo),
        last_inbound_at: ago(5),
        wa_window_expires_at: lead.windowOpen ? ago(-1400) : ago(120),
        full_name: lead.name, phone_e164: lead.phone, email: lead.email, language: lead.language,
        lead_score: lead.score, dnc: lead.dnc,
        last_body: (last?.body as string) ?? null,
        last_channel: (last?.channel as string) ?? 'whatsapp',
        last_direction: (last?.direction as string) ?? 'outbound',
        stage_key: lead.stage,
      };
    }).sort((a, b) => (b.last_message_at > a.last_message_at ? 1 : -1));

    return { items, page: 1, pageSize: 25, total: items.length };
  } },
  { method: 'GET', pattern: /^\/api\/inbox\/conversations\/([^/]+)$/, handler: ({ params }) => {
    const found = threadFor(params[0]!);
    if (!found) throw { status: 404, code: 'not_found', message: 'Conversation not found' };
    const { lead, thread } = found;
    return {
      conversation: {
        id: lead.conversationId, contact_id: lead.contactId, assigned_user_id: lead.owner,
        assignee_name: userName(lead.owner), status: 'open', unread_count: lead.unread,
        last_message_at: ago(5), last_inbound_at: ago(5),
        wa_window_expires_at: lead.windowOpen ? ago(-1400) : ago(120),
        full_name: lead.name, phone_e164: lead.phone, email: lead.email, language: lead.language,
        lead_score: lead.score, dnc: lead.dnc,
        reply_lock_user_id: null, reply_lock_expires_at: null,
        whatsappWindowOpen: lead.windowOpen,
        whatsappWindowExpiresAt: lead.windowOpen ? ago(-1400) : ago(120),
        composerMode: lead.windowOpen ? 'free_form' : 'template_only',
        replyLock: lead.id === 'o-1' ? { userId: 'u-yousef', expiresAt: ago(-1) } : null,
      },
      messages: thread.messages,
      events: thread.events,
    };
  } },
  { method: 'POST', pattern: /^\/api\/inbox\/conversations\/([^/]+)\/read$/, handler: ({ params }) => {
    const lead = LEADS.find((l) => l.conversationId === params[0]);
    if (lead) lead.unread = 0;
    return { ok: true };
  } },
  { method: 'POST', pattern: /^\/api\/inbox\/conversations\/([^/]+)\/typing$/, handler: () => ({ ok: true }) },
  { method: 'POST', pattern: /^\/api\/inbox\/conversations\/([^/]+)\/send$/, handler: ({ params, body }) => {
    const found = threadFor(params[0]!);
    if (!found) throw { status: 404, code: 'not_found', message: 'Conversation not found' };
    const { lead, thread } = found;

    // The real API refuses free-form WhatsApp once the window has closed.
    if (body.channel === 'whatsapp' && body.kind !== 'template' && !lead.windowOpen) {
      throw { status: 409, code: 'conflict', message: 'The 24-hour WhatsApp window is closed; only an approved template can be sent' };
    }
    if (lead.dnc === 1) {
      throw { status: 409, code: 'conflict', message: 'Contact is on the do-not-contact list' };
    }

    thread.messages.push({
      id: `m-${Date.now()}`,
      channel: body.channel === 'note' ? 'note' : body.channel === 'email' ? 'email' : 'whatsapp',
      direction: 'outbound',
      provider: body.channel === 'email' ? 'smtp' : 'whatsapp_cloud',
      user_id: OWNER.id,
      user_name: OWNER.name,
      is_automated: 0,
      template_name: body.kind === 'template' ? String(body.templateName) : null,
      template_language: null,
      subject: body.subject ? String(body.subject) : null,
      body: body.kind === 'template' ? `[template ${String(body.templateName)}]` : String(body.text ?? ''),
      media: null,
      status: 'sent',
      error_code: null,
      error_message: null,
      sent_at: new Date().toISOString(),
      delivered_at: null,
      read_at: null,
      created_at: new Date().toISOString(),
    });
    return { sent: true, messageId: `m-${Date.now()}`, providerMessageId: 'preview' };
  } },

  // --- projects -----------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/projects$/, handler: ({ query }) => ({
    items: query.get('includeUnverified') === '1' ? PROJECTS : PROJECTS.filter((p) => p.verified_at),
  }) },
  { method: 'POST', pattern: /^\/api\/projects\/([^/]+)\/verify$/, handler: ({ params }) => {
    const project = PROJECTS.find((p) => p.id === params[0]);
    if (project) project.verified_at = new Date().toISOString();
    return { ok: true, verified: true };
  } },
  { method: 'POST', pattern: /^\/api\/projects\/([^/]+)\/unverify$/, handler: ({ params }) => {
    const project = PROJECTS.find((p) => p.id === params[0]);
    if (project) project.verified_at = null;
    return { ok: true, verified: false };
  } },
  { method: 'POST', pattern: /^\/api\/projects$/, handler: ({ body }) => {
    const id = `p-${Math.random().toString(36).slice(2, 8)}`;
    PROJECTS.push({
      id, slug: String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: String(body.name), developer: String(body.developer), emirate: String(body.emirate),
      area: (body.area as string) ?? null, starting_price_aed: (body.startingPriceAed as number) ?? null,
      payment_plan: (body.paymentPlan as string) ?? null, handover_date: (body.handoverDate as string) ?? null,
      golden_visa_eligible: body.goldenVisaEligible ? 1 : 0, brochure_url: (body.brochureUrl as string) ?? null,
      location_lat: body.locationLat ? String(body.locationLat) : null,
      location_lng: body.locationLng ? String(body.locationLng) : null,
      is_active: 1, verified_at: null,
    });
    return { id, verified: false };
  } },
  { method: 'PATCH', pattern: /^\/api\/projects\/([^/]+)$/, handler: () => ({ ok: true, requiresReverification: true }) },

  // --- templates ----------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/templates$/, handler: () => ({
    items: TEMPLATES, blocked: TEMPLATES.filter((t) => t.status !== 'APPROVED').length,
  }) },
  { method: 'GET', pattern: /^\/api\/templates\/field-map\/unmapped$/, handler: () => ({ items: UNMAPPED_QUESTIONS }) },
  { method: 'GET', pattern: /^\/api\/templates\/field-map\/all$/, handler: () => ({ items: [] }) },
  { method: 'GET', pattern: /^\/api\/templates\/library$/, handler: () => ({ items: [] }) },
  { method: 'POST', pattern: /^\/api\/templates\/sync$/, handler: () => ({ synced: TEMPLATES.length, newlyBroken: [], missingFromProvider: [] }) },
  { method: 'POST', pattern: /^\/api\/templates\/seed-library$/, handler: () => ({ inserted: 16, invalid: [] }) },
  { method: 'PATCH', pattern: /^\/api\/templates\/([^/]+)\/status$/, handler: ({ params, body }) => {
    const template = TEMPLATES.find((t) => t.id === params[0]);
    if (template) template.status = String(body.status);
    return { ok: true };
  } },

  // --- tasks --------------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/tasks$/, handler: ({ query }) => {
    const filter = query.get('filter') ?? 'open';
    const rows = TASKS.map((t) => {
      const lead = LEADS.find((l) => l.id === t.leadId);
      return {
        id: t.id, type: t.type, title: t.title, notes: t.notes, priority: t.priority,
        due_at: ago(-t.dueMinutesFromNow),
        completed_at: t.completed ? ago(120) : null,
        contact_id: lead?.contactId ?? null,
        opportunity_id: t.leadId,
        full_name: lead?.name ?? null,
        phone_e164: lead?.phone ?? null,
        lead_score: lead?.score ?? null,
        stage_key: lead?.stage ?? null,
        project_name: lead?.project ?? null,
        assigned_user_id: lead?.owner ?? OWNER.id,
        assignee_name: userName(lead?.owner ?? OWNER.id),
      };
    });
    const overdue = (r: typeof rows[number]) => !r.completed_at && new Date(r.due_at).getTime() < Date.now();
    const today = (r: typeof rows[number]) =>
      !r.completed_at && new Date(r.due_at).toDateString() === new Date().toDateString();
    const items = rows.filter((r) =>
      filter === 'done' ? r.completed_at : filter === 'overdue' ? overdue(r) : filter === 'today' ? today(r) : !r.completed_at,
    );
    return {
      items,
      counts: {
        overdue: rows.filter(overdue).length,
        today: rows.filter(today).length,
        open: rows.filter((r) => !r.completed_at).length,
        done: rows.filter((r) => r.completed_at).length,
      },
    };
  } },
  { method: 'POST', pattern: /^\/api\/tasks\/([^/]+)\/complete$/, handler: ({ params }) => {
    const task = TASKS.find((t) => t.id === params[0]);
    if (task) task.completed = true;
    return { ok: true };
  } },
  { method: 'POST', pattern: /^\/api\/tasks\/([^/]+)\/reopen$/, handler: ({ params }) => {
    const task = TASKS.find((t) => t.id === params[0]);
    if (task) task.completed = false;
    return { ok: true };
  } },

  // --- automations --------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/automations$/, handler: () => ({
    items: AUTOMATIONS.map((a) => ({
      key: a.key, name: a.name, description: a.description, isActive: a.isActive, runs: a.runs,
      lastRunAt: a.lastRunMinutesAgo === null ? null : ago(a.lastRunMinutesAgo),
    })),
  }) },
  { method: 'PATCH', pattern: /^\/api\/automations\/([^/]+)$/, handler: ({ params, body }) => {
    const automation = AUTOMATIONS.find((a) => a.key === params[0]);
    if (automation) automation.isActive = Boolean(body.isActive);
    return { ok: true };
  } },

  // --- lists --------------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/lists$/, handler: () => ({
    items: LISTS.map((list) => ({
      ...list,
      created_at: ago(2880),
      member_count: list.kind === 'smart' ? listContacts(list.id).length : list.member_count,
      summary: list.kind === 'smart' ? list.summary : `${listContacts(list.id).length} contacts`,
    })),
  }) },
  { method: 'POST', pattern: /^\/api\/lists$/, handler: ({ body }) => {
    const id = `ls-${LISTS.length + 1}`;
    LISTS.push({
      id,
      name: String(body.name ?? 'New list'),
      description: (body.description as string) ?? null,
      kind: (body.kind as 'smart' | 'static') ?? 'smart',
      filters: (body.filters as Record<string, unknown>) ?? null,
      recycle_after_days: (body.recycleAfterDays as number) ?? null,
      recycle_action: (body.recycleAction as 'pool' | 'reassign') ?? null,
      owner_name: null,
      member_count: 0,
      summary: 'stage new lead, excluding do-not-contact',
    });
    return { id };
  } },
  { method: 'GET', pattern: /^\/api\/lists\/([^/]+)\/members$/, handler: ({ params }) => {
    const items = listContacts(params[0] ?? '');
    return { items, total: items.length };
  } },
  { method: 'POST', pattern: /^\/api\/lists\/bulk$/, handler: ({ body }) => ({
    affected: (body.contactIds as string[] | undefined)?.length ?? 0,
  }) },

  // --- campaigns ----------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/campaigns$/, handler: () => ({
    items: CAMPAIGNS.map((campaign) => ({
      ...campaign,
      started_at: ago(campaign.startedMinutesAgo),
      finished_at: null,
      created_at: ago(campaign.startedMinutesAgo + 30),
    })),
  }) },
  { method: 'POST', pattern: /^\/api\/campaigns$/, handler: ({ body }) => {
    const kind = (body.kind as 'call' | 'whatsapp') ?? 'call';
    const id = `cp-${CAMPAIGNS.length + 1}`;
    const eligible = kind === 'whatsapp' ? 128 : 6;
    const skipped = kind === 'whatsapp' ? 412 : 0;
    CAMPAIGNS.push({
      id,
      name: String(body.name ?? 'New campaign'),
      kind,
      status: 'draft',
      total_members: eligible,
      skipped_no_consent: skipped,
      template_name: (body.templateName as string) ?? null,
      paused_reason: null,
      list_name: LISTS.find((l) => l.id === body.listId)?.name ?? null,
      done_count: 0,
      startedMinutesAgo: 0,
    });
    return {
      id,
      total: eligible + skipped,
      eligible,
      skipped,
      warning: skipped
        ? `${eligible} will be messaged. ${skipped} will be skipped: ${skipped} no recorded whatsapp consent.`
        : `All ${eligible} contacts will be messaged.`,
    };
  } },
  { method: 'GET', pattern: /^\/api\/campaigns\/([^/]+)$/, handler: ({ params }) => {
    const campaign = CAMPAIGNS.find((c) => c.id === params[0]) ?? CAMPAIGNS[0]!;
    const done = DIALLER_QUEUE.filter((m) => m.done).length;
    return {
      campaign: { ...campaign, started_at: ago(campaign.startedMinutesAgo), finished_at: null, created_at: ago(9000) },
      stats: {
        total: DIALLER_QUEUE.length,
        done,
        pending: DIALLER_QUEUE.length - done,
        skipped: campaign.skipped_no_consent,
        contactedPct: Math.round((done / DIALLER_QUEUE.length) * 100),
        reachedPct: done > 0 ? 50 : 0,
        interested: DIALLER_QUEUE.filter((m) => m.outcome === 'interested').length,
        appointments: 1,
        byAgent: [
          { userId: 'u-layla', name: 'Layla Hassan', done, reached: 1, interested: 1 },
        ],
        outcomes: DIALLER_QUEUE.filter((m) => m.outcome).map((m) => ({ outcome: m.outcome as string, n: 1 })),
      },
    };
  } },
  { method: 'POST', pattern: /^\/api\/campaigns\/([^/]+)\/(start|pause|build)$/, handler: ({ params }) => {
    const campaign = CAMPAIGNS.find((c) => c.id === params[0]);
    if (campaign && params[1] === 'start') { campaign.status = 'running'; campaign.paused_reason = null; }
    if (campaign && params[1] === 'pause') { campaign.status = 'paused'; campaign.paused_reason = 'Paused by a manager'; }
    return { ok: true };
  } },
  { method: 'POST', pattern: /^\/api\/campaigns\/([^/]+)\/next$/, handler: () => ({ card: diallerCard() }) },
  { method: 'POST', pattern: /^\/api\/campaigns\/([^/]+)\/outcome$/, handler: ({ body }) => {
    const member = DIALLER_QUEUE.find((m) => m.memberId === body.memberId);
    if (member) { member.done = true; member.outcome = body.outcome as never; }
    return { ok: true, card: diallerCard() };
  } },
  { method: 'POST', pattern: /^\/api\/campaigns\/([^/]+)\/release$/, handler: () => ({ ok: true }) },

  // --- imports ------------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/imports$/, handler: () => ({
    items: IMPORTS.map((row) => ({
      ...row,
      undo_deadline_at: ago(-600),
      undone_at: null,
      created_at: ago(row.createdMinutesAgo),
    })),
  }) },
  { method: 'GET', pattern: /^\/api\/imports\/mappings\/all$/, handler: () => ({ items: [] }) },
  { method: 'GET', pattern: /^\/api\/imports\/([^/]+)\/undo$/, handler: () => ({
    deletable: 248, keptBecauseWorkedOn: 2, expired: false,
  }) },
  { method: 'GET', pattern: /^\/api\/imports\/([^/]+)$/, handler: ({ params }) => {
    const record = IMPORTS.find((row) => row.id === params[0]) ?? IMPORTS[0]!;
    return {
      import: {
        ...record,
        headers: ['Full Name', 'Mobile No.', 'Email Address', 'Interested Project', 'Budget AED'],
        mapping: null, settings: null, assignment: null, error_message: null,
        started_at: ago(record.createdMinutesAgo), finished_at: ago(record.createdMinutesAgo - 3),
        undo_deadline_at: ago(-600), undone_at: null, created_at: ago(record.createdMinutesAgo),
      },
      problems: [
        { line_number: 251, status: 'invalid', reason: 'No phone number and no email address' },
        { line_number: 252, status: 'invalid', reason: '"call the office" is not a valid phone number' },
      ],
      undoWindowHours: 24,
    };
  } },
  { method: 'POST', pattern: /^\/api\/imports\/([^/]+)\/assignment-preview$/, handler: ({ body }) => {
    const method = String(body.method ?? 'pool');
    if (method === 'pool') return { leads: 250, plan: { method, counts: [] }, pooled: 250, unmatched: 0, warnings: [] };
    const agents = USERS.filter((u) => u.role === 'agent');
    const each = Math.floor(250 / agents.length);
    return {
      leads: 250,
      plan: {
        method,
        counts: agents.map((agent, i) => ({
          userId: agent.id, name: agent.name,
          before: 20 + i * 8, after: 20 + i * 8 + each + (i === 0 ? 250 % agents.length : 0),
        })),
      },
      pooled: 0, unmatched: 0, warnings: [],
    };
  } },

  // --- teams and the pool -------------------------------------------------
  { method: 'GET', pattern: /^\/api\/teams$/, handler: () => ({ items: TEAMS }) },
  { method: 'GET', pattern: /^\/api\/teams\/pool$/, handler: () => ({
    available: 12,
    claimedByYou: 2,
    maxOpenClaims: 50,
    claimed: LEADS.slice(0, 2).map((lead) => ({
      opportunity_id: lead.id, contact_id: lead.contactId, claimed_at: ago(180),
      full_name: lead.name, phone_e164: lead.phone, lead_score: lead.score,
      stage_key: lead.stage, project_name: lead.project,
    })),
  }) },
  { method: 'POST', pattern: /^\/api\/teams\/pool\/claim$/, handler: () => ({
    opportunityId: 'o-new', contactId: 'c-new', fullName: 'Hassan Al Marri',
  }) },
  { method: 'POST', pattern: /^\/api\/teams\/pool\/release$/, handler: () => ({ ok: true }) },

  // --- reports ------------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/reports\/dashboard$/, handler: ({ query }) => {
    const days = Number(query.get('days') ?? 30);
    const series = previewSeries(days);
    const total = series.reduce((sum, day) => sum + day.value, 0);
    const spark = series.slice(-8).map((day) => day.value);
    const won = LEADS.filter((l) => l.status === 'won').length;
    const appointments = LEADS.filter((l) =>
      ['appointment_scheduled', 'deal_sent', 'won'].includes(l.stage)).length;
    return {
      range: { days, from: ago(days * 1440), to: new Date().toISOString() },
      kpis: {
        newLeads: { value: spark[spark.length - 1] ?? 0, previous: spark[spark.length - 2] ?? 0, spark },
        whatsappRepliedPct: { value: 64, previous: 58, spark: [48, 52, 50, 55, 58, 57, 61, 64] },
        appointments: { value: Math.max(appointments, 17), previous: 13, spark: [8, 9, 11, 10, 13, 12, 15, 17] },
        reservations: { value: Math.max(won, 12), previous: 9, spark: [3, 4, 4, 6, 7, 8, 10, 12], pipelineValueAed: 31400000 },
      },
      series,
      sources: [
        { label: 'Meta forms', value: Math.round(total * 0.53), colour: '#0AA3BA' },
        { label: 'Click-to-WhatsApp', value: Math.round(total * 0.24), colour: '#5CC4C9' },
        { label: 'Google Ads', value: Math.round(total * 0.13), colour: '#9FB6C8' },
        { label: 'Website', value: Math.round(total * 0.10), colour: '#C9D6E0' },
      ],
      totalLeads: total,
      funnel: [
        { label: 'Leads', value: total },
        { label: 'Valid number', value: Math.round(total * 0.79) },
        { label: 'Contacted', value: Math.round(total * 0.70) },
        { label: 'Qualified', value: Math.round(total * 0.26) },
        { label: 'Appointments', value: Math.round(total * 0.09) },
        { label: 'Reservations', value: Math.round(total * 0.016) },
      ],
      speedToLead: { medianSeconds: 24, targetSeconds: 30, maxSeconds: 60, slaBreaches: 3 },
      arrivals: previewArrivals(),
      leaderboard: [
        { userId: 'u-layla', name: 'Layla Hassan', initials: 'LH', medianFirstReplySeconds: 18, qualified: 14, deals: 2 },
        { userId: 'u-omar', name: 'Omar Farouk', initials: 'OF', medianFirstReplySeconds: 26, qualified: 11, deals: 1 },
        { userId: 'u-priya', name: 'Priya Nair', initials: 'PN', medianFirstReplySeconds: 31, qualified: 9, deals: 1 },
        { userId: 'u-raj', name: 'Raj Kapoor', initials: 'RK', medianFirstReplySeconds: 130, qualified: 6, deals: 0 },
      ],
    };
  } },
  { method: 'GET', pattern: /^\/api\/reports\/source-quality$/, handler: () => ({
    from: ago(43200), to: new Date().toISOString(),
    note: 'CPL requires ad spend from Meta/Google Ads; join on campaign_id or ad_id.',
    items: [
      { source: 'meta_lead_ads', campaign_name: 'Q1-2026-Dubai-OffPlan-Leads', ad_name: 'DXB-Beachfront-Video-01', leads: 148, validPct: 91.2, contactedPct: 84.5, qualifiedPct: 38.5, appointmentPct: 16.9, showPct: 11.5, reservationPct: 4.1, deal_value_aed: 18500000, avg_score: 64, cplAed: null },
      { source: 'meta_ctwa', campaign_name: 'CTWA-Lagoons-Arabic', ad_name: 'Lagoons-Carousel-AR', leads: 96, validPct: 96.9, contactedPct: 93.8, qualifiedPct: 45.8, appointmentPct: 22.9, showPct: 15.6, reservationPct: 6.3, deal_value_aed: 12400000, avg_score: 71, cplAed: null },
      { source: 'google_ads', campaign_name: 'AUH-Reem-Search', ad_name: 'Responsive-Ad-2', leads: 54, validPct: 88.9, contactedPct: 79.6, qualifiedPct: 29.6, appointmentPct: 11.1, showPct: 7.4, reservationPct: 1.9, deal_value_aed: 3200000, avg_score: 51, cplAed: null },
      { source: 'website', campaign_name: 'creek-harbour-2026', ad_name: null, leads: 37, validPct: 94.6, contactedPct: 86.5, qualifiedPct: 32.4, appointmentPct: 13.5, showPct: 10.8, reservationPct: 2.7, deal_value_aed: 2900000, avg_score: 58, cplAed: null },
    ],
  }) },
  { method: 'GET', pattern: /^\/api\/reports\/agents$/, handler: () => {
    const items = [
      { userId: 'u-layla', name: 'Layla Hassan', leads: 112, medianSpeedToLeadSeconds: 74, slaBreaches: 2, contactRatePct: 93.8, qualifiedRatePct: 44.6, appointments: 27, reservations: 6 },
      { userId: 'u-omar', name: 'Omar Farouk', leads: 88, medianSpeedToLeadSeconds: 132, slaBreaches: 5, contactRatePct: 87.5, qualifiedRatePct: 38.6, appointments: 19, reservations: 4 },
      { userId: 'u-priya', name: 'Priya Nair', leads: 76, medianSpeedToLeadSeconds: 251, slaBreaches: 9, contactRatePct: 78.9, qualifiedRatePct: 27.6, appointments: 11, reservations: 1 },
    ];
    return { from: ago(10080), to: new Date().toISOString(), items, leaderboard: items, kingOfEmir: items[0] };
  } },
  { method: 'GET', pattern: /^\/api\/reports\/funnel$/, handler: () => ({
    from: ago(43200), to: new Date().toISOString(),
    stages: STAGES.map((s) => ({ stage_key: s.key, n: LEADS.filter((l) => l.stage === s.key).length, open_n: LEADS.filter((l) => l.stage === s.key && l.status === 'open').length })),
    lostReasons: [{ lost_reason: 'budget_mismatch', n: 1 }],
    slaBreaches: 1,
  }) },
  { method: 'GET', pattern: /^\/api\/reports\/health$/, handler: () => ({
    jobs: [{ status: 'done', n: 1284 }, { status: 'pending', n: 7 }, { status: 'failed', n: 0 }],
    failingJobTypes: [],
    inboundEvents24h: [
      { source: 'meta_lead_ads', status: 'processed', n: 41 },
      { source: 'whatsapp', status: 'processed', n: 158 },
      { source: 'website', status: 'processed', n: 12 },
    ],
    templatesNotApproved: TEMPLATES.filter((t) => t.status !== 'APPROVED'),
    unassignedLeads: LEADS.filter((l) => !l.owner).length,
    unverifiedActiveProjects: PROJECTS.filter((p) => !p.verified_at).length,
    crons: [
      { name: 'meta_backfill', lastRunAt: ago(4), status: 'done' },
      { name: 'imap_poll', lastRunAt: ago(1), status: 'done' },
      { name: 'template_sync', lastRunAt: ago(55), status: 'done' },
      { name: 'cleanup', lastRunAt: ago(55), status: 'done' },
    ],
    realtimeClients: 3,
  }) },
];

function resolve(method: string, path: string): { route: Route; params: string[] } | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (match) return { route, params: match.slice(1) };
  }
  return null;
}

/** Replace window.fetch for /api/* only; everything else passes through. */
export function installMockApi(): void {
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, window.location.origin);
    if (!url.pathname.startsWith('/api/')) return realFetch(input as RequestInfo, init);

    const method = (init?.method ?? 'GET').toUpperCase();
    const found = resolve(method, url.pathname);

    // A touch of latency, so loading states are visible rather than skipped.
    await new Promise((resolve) => setTimeout(resolve, 90));

    if (!found) {
      return json(404, { error: { code: 'not_found', message: `No route for ${method} ${url.pathname}` } });
    }

    let body: Record<string, unknown> = {};
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }

    try {
      return json(200, found.route.handler({ params: found.params, body, query: url.searchParams }));
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      return json(e.status ?? 500, { error: { code: e.code ?? 'server_error', message: e.message ?? 'Something went wrong' } });
    }
  };

  // The realtime stream has no server here; the app falls back to polling.
  Object.defineProperty(window, 'EventSource', { value: undefined, writable: true, configurable: true });
}

/** A smart list is a filter, so its members are computed rather than stored. */
function listContacts(listId: string) {
  const list = LISTS.find((row) => row.id === listId);
  const filters = (list?.filters ?? {}) as { minScore?: number; stages?: string[] };
  return LEADS.filter((lead) => {
    if (filters.minScore !== undefined && lead.score < filters.minScore) return false;
    if (filters.stages && !filters.stages.includes(lead.stage)) return false;
    return lead.dnc === 0;
  }).map((lead) => ({
    contact_id: lead.contactId, opportunity_id: lead.id, full_name: lead.name,
    phone_e164: lead.phone, email: lead.email, language: lead.language,
    lead_score: lead.score, dnc: lead.dnc, owner_user_id: lead.owner,
    owner_name: userName(lead.owner), stage_key: lead.stage,
    project_name: lead.project, budget_band: null, last_inbound_at: null,
  }));
}

/** The next lead the dialler hands out, with the queue's progress. */
function diallerCard() {
  const next = DIALLER_QUEUE.find((member) => !member.done);
  if (!next) return null;
  const lead = LEADS.find((row) => row.id === next.leadId);
  if (!lead) return null;
  return {
    memberId: next.memberId,
    contactId: lead.contactId,
    opportunityId: lead.id,
    fullName: lead.name,
    phone: lead.phone,
    language: lead.language,
    leadScore: lead.score,
    projectName: lead.project,
    budgetBand: null,
    budgetMinAed: lead.budgetMin,
    budgetMaxAed: lead.budgetMax,
    stageKey: lead.stage,
    lastContactedAt: null,
    attempts: 1,
    progress: { done: DIALLER_QUEUE.filter((m) => m.done).length, total: DIALLER_QUEUE.length },
  };
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildActivities(lead: (typeof LEADS)[number], thread: { messages: Array<Record<string, unknown>>; events: Array<Record<string, unknown>> }) {
  const activities: Array<Record<string, unknown>> = [
    ...thread.events.map((e) => ({ ...e, user_name: null })),
    ...thread.messages.slice().reverse().map((m) => ({
      id: `a-${m.id}`,
      type: m.direction === 'inbound' ? 'message.inbound' : m.is_automated ? 'message.automated' : 'message.outbound',
      title: m.template_name
        ? `Sent template ${String(m.template_name)}`
        : m.direction === 'inbound'
          ? `Inbound ${String(m.channel)} message`
          : `Sent ${String(m.channel)} message`,
      body: m.body,
      created_at: m.created_at,
      user_name: m.user_name,
    })),
    { id: `a-assign-${lead.id}`, type: 'lead.assigned', title: `Assigned by ${lead.project ? 'language and project' : 'round robin'}`, body: null, created_at: ago(lead.createdMinutesAgo), user_name: null },
    { id: `a-new-${lead.id}`, type: 'lead.created', title: `New lead from ${lead.source}`, body: [lead.project ? `Project: ${lead.project}` : null, lead.budgetMax ? `Budget: AED ${lead.budgetMax.toLocaleString()}` : null, `Timeline: ${lead.timeline}`].filter(Boolean).join('\n'), created_at: ago(lead.createdMinutesAgo), user_name: null },
  ];
  if (lead.slaBreached) {
    activities.unshift({ id: `a-sla-${lead.id}`, type: 'sla.breached', title: 'Speed-to-lead SLA breached after 5 minutes', body: 'Reassigned to another available agent.', created_at: ago(lead.createdMinutesAgo - 5), user_name: null });
  }
  return activities;
}
