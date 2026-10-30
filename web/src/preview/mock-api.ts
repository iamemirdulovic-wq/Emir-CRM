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

const routing = {
  slaMinutes: 5, reminderMinutes: 3, autoAssign: true, bounceToOwner: true,
  emailOwnerOnNewLead: true, quietHours: true, quietStart: '22:00', quietEnd: '08:00',
};

const NOTIFICATIONS: Array<{
  id: string; type: string; title: string; body: string | null; link: string | null;
  contact_id: string | null; priority: 'normal' | 'high'; read_at: string | null; created_at: string;
}> = [
  {
    id: 'n1', type: 'lead_assigned', title: 'New lead for you',
    body: 'Sara Al Mansoori · Emaar Beachfront · AED 2M',
    link: '/contacts/c-1', contact_id: 'c-1', priority: 'high', read_at: null,
    created_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  },
  {
    id: 'n2', type: 'sla_reminder', title: '2 minutes left',
    body: 'Khalid Mansour goes back to the owner if you do not call.',
    link: '/contacts/c-2', contact_id: 'c-2', priority: 'high', read_at: null,
    created_at: new Date(Date.now() - 46 * 60 * 1000).toISOString(),
  },
  {
    id: 'n3', type: 'lead_bounced', title: 'Lead bounced — needs reassigning',
    body: 'Yas Riva Reserve came back from Omar Farouk. It is waiting in Incoming.',
    link: '/incoming', contact_id: null, priority: 'high',
    read_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'n4', type: 'deal_won', title: '🏆 Sara just closed a deal',
    body: 'Sobha Hartland II — congratulations!',
    link: '/pipeline', contact_id: null, priority: 'normal',
    read_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 28 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'n5', type: 'enquiry_again', title: '🔁 Ahmed Khan enquired again',
    body: 'Came back after being marked Lost — via Meta ad.',
    link: '/contacts/c-3', contact_id: 'c-3', priority: 'normal',
    read_at: new Date(Date.now() - 70 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
  },
];

/** The mock leads as My Leads wants them, with a spread of next-step states. */
function myLeadRows() {
  const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
  return LEADS.slice(0, 8).map((lead, index) => ({
    id: `opp-${index}`,
    contact_id: lead.contactId,
    stage_key: index % 4 === 0 ? 'new_lead' : index % 3 === 0 ? 'appointment_scheduled' : 'engaged_qualified',
    status: 'open',
    project_name: lead.project,
    source: lead.source,
    budget_max_aed: lead.budgetMax,
    lead_score: lead.score,
    score_band: lead.score >= 70 ? 'hot' : lead.score >= 40 ? 'warm' : 'cold',
    score_reason: 'Budget AED 2M · ready now · asked for a call',
    next_step_type: index % 5 === 4 ? null : 'call',
    /* One overdue, one due today, one later, one with nothing promised —
       so every state on the row has something to show. */
    next_step_at: index % 5 === 4 ? null : at([-3, 4, 30, 54][index % 4] as number),
    next_step_note: null,
    last_contact_at: index % 6 === 5 ? null : at(-index * 9 - 2),
    no_answer_count: index % 3,
    created_at: at(-index * 24 - 6),
    full_name: lead.name,
    phone_e164: lead.phone,
    email: null,
    owner_name: lead.owner ? 'Layla Hassan' : null,
  }));
}

/** Set once the preview's new-lead card has been accepted, so it stays gone. */
let pendingAccepted = false;

/**
 * Who the preview is signed in as.
 *
 * The CRM looks genuinely different to an agent and to an owner — the agent
 * dashboard leads with what to do next, the owner's with what went wrong
 * yesterday — so a preview that can only be the owner can only show half of
 * it. Set `?as=agent` on the URL, or `localStorage.emir.previewRole`.
 */
function previewRole(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('as');
    if (fromUrl) localStorage.setItem('emir.previewRole', fromUrl);
    return localStorage.getItem('emir.previewRole') || OWNER.role;
  } catch {
    return OWNER.role;
  }
}

const AGENT_PERMISSIONS = PERMISSIONS.filter((name) =>
  !name.includes(':all') && !name.startsWith('users:') && !name.startsWith('audit:')
  && !name.startsWith('reports:') && !name.includes('export'));

const currentUser = () => {
  const role = previewRole();
  const as = role === 'owner' ? OWNER : (USERS.find((u) => u.role === role) ?? OWNER);
  return {
    id: as.id,
    name: as.name,
    email: as.email,
    role: as.role,
    locale: session.locale,
    availability: 'available' as const,
    mustChangePassword: false,
    permissions: as.role === 'owner' || as.role === 'admin' ? PERMISSIONS : AGENT_PERMISSIONS,
  };
};

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

/**
 * Notes, per contact, held in memory so pin, edit, delete and undo all behave
 * in the preview the way they do in the real app.
 */
interface PreviewNote {
  id: string; author_id: string | null; author_name: string | null;
  type: string; body: string; pinned: number;
  edited_at: string | null; created_at: string; deleted: boolean;
}

const NOTE_STORE: Record<string, PreviewNote[]> = {};

function previewNotes(contactId: string): PreviewNote[] {
  if (!NOTE_STORE[contactId]) {
    const lead = LEADS.find((l) => l.contactId === contactId);
    const author = USERS.find((u) => u.id === lead?.owner) ?? OWNER;
    NOTE_STORE[contactId] = lead && lead.score >= 70
      ? [
        {
          id: `${contactId}-n1`, author_id: author.id, author_name: author.name,
          type: 'budget', body: 'Said 1.9M is the real ceiling, not the 2.5M on the form.',
          pinned: 1, edited_at: null, created_at: ago(180), deleted: false,
        },
        {
          id: `${contactId}-n2`, author_id: author.id, author_name: author.name,
          type: 'objection', body: 'Worried about the 2027 handover slipping. Wants the DLD escrow number before he signs anything.',
          pinned: 1, edited_at: null, created_at: ago(160), deleted: false,
        },
        {
          id: `${contactId}-n3`, author_id: author.id, author_name: author.name,
          type: 'call_summary', body: 'Spoke 11 minutes. Walked through the payment plan. Sending the floor plans for the 2 BR type B tonight.',
          pinned: 0, edited_at: ago(140), created_at: ago(150), deleted: false,
        },
      ]
      : [];
    if (NOTE_STORE[contactId]!.length > 0) seedNoteFiles(contactId);
  }
  return NOTE_STORE[contactId]!;
}

interface PreviewNoteFile {
  id: string; note_id: string; kind: 'file' | 'voice'; filename: string;
  content_type: string; byte_size: number; duration_s: number | null; created_at: string;
}

/** One voice note and one document, so the preview shows both shapes. */
const NOTE_FILES: PreviewNoteFile[] = [];

/** How many rows the last paste carried; 0 means "an uploaded file", not a paste. */
let pastedRows = 0;

function seedNoteFiles(contactId: string): void {
  NOTE_FILES.push(
    {
      id: `${contactId}-vf1`, note_id: `${contactId}-n3`, kind: 'voice',
      filename: 'voice-note-2026-10-30-11-14.webm', content_type: 'audio/webm',
      byte_size: 184_320, duration_s: 47, created_at: ago(150),
    },
    {
      id: `${contactId}-vf2`, note_id: `${contactId}-n3`, kind: 'file',
      filename: 'emaar-beachfront-2br-type-b.pdf', content_type: 'application/pdf',
      byte_size: 1_245_184, duration_s: null, created_at: ago(149),
    },
  );
}

function findPreviewNote(noteId: string): PreviewNote | undefined {
  for (const list of Object.values(NOTE_STORE)) {
    const found = list.find((n) => n.id === noteId);
    if (found) return found;
  }
  return undefined;
}

/* ── Client email ─────────────────────────────────────────────────────── */

const EMAIL_TEMPLATES = [
  {
    id: 'tpl-first', template_key: 'first_reply', name: 'First reply', category: 'first_reply',
    subject: 'About {{project}} — {{agent_first_name}} from {{company}}',
    body: 'Hi {{first_name}},\n\nThanks for your enquiry about {{project}}. I\u2019m {{agent_name}}, and I look after buyers for this one.\n\nI\u2019d rather send you something useful than a generic brochure, so one quick question: are you buying to live in it or to invest?\n\nTell me that and I\u2019ll come back with the layouts and the current availability that actually fit.',
    preview_text: 'Thanks for your enquiry. A quick question so I send the right thing.',
    is_system: 1, enabled: 1,
  },
  {
    id: 'tpl-noanswer', template_key: 'after_no_answer', name: 'After a call they did not answer',
    category: 'follow_up', subject: 'Tried to reach you about {{project}}',
    body: 'Hi {{first_name}},\n\nI tried to call you earlier about {{project}} — I know the timing might not have suited.\n\nNothing urgent, and no pressure. If you\u2019d still like the details, just tell me a time that works and I\u2019ll call then. Evenings are fine.',
    preview_text: 'Happy to work around you — what time suits?', is_system: 1, enabled: 1,
  },
  {
    id: 'tpl-details', template_key: 'project_details', name: 'Sending project details',
    category: 'project', subject: '{{project}} — the details you asked for',
    body: 'Hi {{first_name}},\n\nHere are the details for {{project}}, as promised.\n\nI\u2019ve attached the brochure and the floor plans. Have a look and tell me which layout you prefer.',
    preview_text: 'Layouts, the payment plan and what is available right now.', is_system: 1, enabled: 1,
  },
  {
    id: 'tpl-quiet', template_key: 'quiet_lead', name: 'Checking in on a quiet lead',
    category: 'nurture', subject: 'Still looking in {{emirate}}?',
    body: 'Hi {{first_name}},\n\nIt\u2019s been a while since we spoke about {{project}}, so I thought I\u2019d check in rather than keep guessing.\n\nAre you still looking, or has this gone on the back burner for now?',
    preview_text: 'One line back is all I need.', is_system: 1, enabled: 1,
  },
];

interface PreviewCampaign {
  id: string; name: string; status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'cancelled';
  subject: string; list_name: string | null; created_by: string | null; throttle_per_hour: number;
  total_members: number; sent_count: number; opened_count: number; clicked_count: number;
  bounced_count: number; unsubscribed_count: number; failed_count: number; created_at: string;
}

const EMAIL_CAMPAIGNS: PreviewCampaign[] = [
  {
    id: 'ec-1', name: 'October — Beachfront launch', status: 'sent',
    subject: 'Emaar Beachfront — the new tower is open', list_name: 'Beachfront enquiries',
    created_by: 'Emir Dulovic', throttle_per_hour: 200, total_members: 412, sent_count: 412,
    opened_count: 173, clicked_count: 48, bounced_count: 6, unsubscribed_count: 4, failed_count: 0,
    created_at: ago(60 * 24 * 6),
  },
  {
    id: 'ec-2', name: 'Quiet leads — September', status: 'sending',
    subject: 'Still looking in Dubai?', list_name: 'No contact in 30 days',
    created_by: 'Emir Dulovic', throttle_per_hour: 200, total_members: 318, sent_count: 96,
    opened_count: 31, clicked_count: 7, bounced_count: 1, unsubscribed_count: 2, failed_count: 0,
    created_at: ago(190),
  },
];

/** The branded wrapper, close enough for the preview to look like the real one. */
function previewEmailHtml(subject: string, body: string, values: Record<string, string>): string {
  const paragraphs = body.split(/\n{2,}/).filter(Boolean)
    .map((block) => `<p style="margin:0 0 14px">${block.replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;background:#EAF3F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0AA3BA;padding:18px 24px;color:#fff;font-size:18px;font-weight:700">Emigeo Homes</td></tr>
<tr><td style="padding:26px 24px 8px;color:#0E1B2C;font-size:15px;line-height:1.65">${paragraphs}</td></tr>
<tr><td style="padding:14px 24px 24px"><div style="border-top:1px solid #E3ECF3;padding-top:16px">
<div style="font-weight:700;font-size:15px;color:#0E1B2C">${values.agent_name}</div>
<div style="font-size:13px;color:#4A5B70;line-height:1.6">Property Consultant<br>${values.agent_phone}<br>${values.agent_email}<br>BRN 48219</div>
</div></td></tr>
<tr><td style="background:#F4F9FC;padding:16px 24px;color:#7E8DA0;font-size:11.5px;line-height:1.6">
Emigeo Homes Real Estate LLC · Dubai, UAE · Licence 1120345</td></tr>
</table></td></tr></table></body></html>`;
}

/* ── Team wall ────────────────────────────────────────────────────────── */

interface PreviewWallPost {
  id: string; author_id: string | null; author_name: string | null; kind: string;
  body: string | null; poll: unknown; show_value: number; pinned_at: string | null;
  created_at: string;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  comments: Array<{ id: string; author_name: string | null; body: string; created_at: string }>;
  commentCount: number;
}

const WALL_POSTS: PreviewWallPost[] = [
  {
    id: 'wp-1', author_id: null, author_name: null, kind: 'best_of_week',
    body: 'Best of the week\n\n👑 Layla Hassan — 2 deals, 6 viewings\nOmar Haddad — 1 deal, 4 viewings\nRaj Mehta — 3 viewings',
    poll: null, show_value: 0, pinned_at: ago(60 * 26), created_at: ago(60 * 26),
    reactions: [{ emoji: '👏', count: 6, mine: true }, { emoji: '🔥', count: 3, mine: false }],
    comments: [], commentCount: 0,
  },
  {
    id: 'wp-2', author_id: 'u2', author_name: 'Layla Hassan', kind: 'deal_won',
    body: 'Layla Hassan just closed a deal at Emaar Beachfront.',
    poll: null, show_value: 0, pinned_at: null, created_at: ago(190),
    reactions: [{ emoji: '🎉', count: 7, mine: true }, { emoji: '💪', count: 2, mine: false }],
    comments: [
      { id: 'wc-1', author_name: 'Omar Haddad', body: 'Well done — that one took months.', created_at: ago(180) },
      { id: 'wc-2', author_name: 'Emir Dulovic', body: 'Excellent. The payment plan did it.', created_at: ago(170) },
    ],
    commentCount: 2,
  },
  {
    id: 'wp-3', author_id: 'u3', author_name: 'Omar Haddad', kind: 'post',
    body: 'Developer visit at Sobha tomorrow 11am — they are bringing the updated price list for Hartland II. Anyone with buyers waiting on that, tell me and I will ask.',
    poll: null, show_value: 0, pinned_at: null, created_at: ago(300),
    reactions: [{ emoji: '👍', count: 4, mine: false }],
    comments: [{ id: 'wc-3', author_name: 'Layla Hassan', body: 'Yes please — two waiting.', created_at: ago(290) }],
    commentCount: 1,
  },
  {
    id: 'wp-4', author_id: null, author_name: null, kind: 'welcome',
    body: 'Raj Mehta has joined the team as Property Consultant. Say hello.',
    poll: null, show_value: 0, pinned_at: null, created_at: ago(60 * 72),
    reactions: [{ emoji: '👏', count: 9, mine: true }],
    comments: [], commentCount: 0,
  },
];

/*
 * One person's own choices.
 *
 * Kept in the browser rather than in this module so they survive a reload,
 * the way the real ones survive a sign-out: a tour that started again on
 * every refresh would be a demo of the wrong thing. Empty on a first visit,
 * so the tour does run once.
 */
const PREFS_KEY = 'homes.preview.prefs';

const PREVIEW_PREFS: Record<string, string | null> = readPreviewPrefs();

function readPreviewPrefs(): Record<string, string | null> {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string | null>) : {};
  } catch {
    return {};
  }
}

function writePreviewPrefs(): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(PREVIEW_PREFS));
  } catch {
    /* Private mode. The preview still works, the tour just runs again. */
  }
}

/**
 * The lead brief: the notes summary, the verdict and the next step.
 *
 * Written out per lead rather than computed, because the point of the preview
 * is to show what a good one looks like — a lead with three sharp lines of
 * notes and an obvious next call, and one with nothing to do today.
 */
function leadBrief(opportunityId: string) {
  const lead = LEADS.find((entry) => entry.id === opportunityId) ?? LEADS[0];
  const briefs: Record<string, ReturnType<typeof brief>> = {
    'o-1': brief({
      verdict: 'hot',
      why: 'Replies within minutes and has asked for prices twice.',
      lines: [
        'Investor, second property in Dubai — bought in JVC in 2023.',
        'Wants a sea view and will not go below the 20th floor.',
        'Has the deposit ready; waiting on the floor plans to decide.',
      ],
      watchOut: 'Do not put her with the Damac agent again — she fell out with them over a missed call.',
      advice: {
        type: 'whatsapp',
        note: 'Answer their message',
        why: 'They wrote 3 hours ago and nobody has replied.',
        urgency: 'now',
        headline: 'Send a WhatsApp, today',
      },
    }),
    'o-2': brief({
      verdict: 'good',
      why: 'Answers every question and turned up to the first viewing.',
      lines: [
        'Family of five moving from Abu Dhabi, needs four bedrooms and a maid\u2019s room.',
        'School run to Dubai British matters more than the view.',
      ],
      watchOut: null,
      advice: {
        type: 'whatsapp',
        note: 'Confirm the appointment',
        why: 'Booked but not confirmed. A confirmed appointment is the one they turn up to.',
        urgency: 'soon',
        headline: 'Send a WhatsApp, today',
      },
    }),
  };

  return (
    briefs[lead?.id ?? ''] ?? brief({
      verdict: (lead?.score ?? 0) >= 70 ? 'hot' : (lead?.score ?? 0) >= 40 ? 'good' : 'weak',
      why: lead?.score !== undefined ? `Scored ${lead.score} from what they told us.` : null,
      lines: [],
      watchOut: null,
      advice:
        lead?.stage === 'new_lead'
          ? {
              type: 'call',
              note: 'First call',
              why: 'Nobody has spoken to them yet.',
              urgency: 'now',
              headline: 'Call them, today',
            }
          : null,
    })
  );
}

function brief(input: {
  verdict: 'hot' | 'good' | 'weak' | 'junk';
  why: string | null;
  lines: string[];
  watchOut: string | null;
  advice: { type: string; note: string; why: string; urgency: string; headline: string } | null;
}) {
  return {
    notes: {
      lines: input.lines,
      watchOut: input.watchOut,
      at: input.lines.length > 0 ? new Date(Date.now() - 36e5).toISOString() : null,
      stale: input.lines.length === 0,
    },
    verdict: {
      value: input.verdict,
      why: input.why,
      source: 'ai' as const,
      at: new Date(Date.now() - 7 * 36e5).toISOString(),
    },
    advice: input.advice
      ? { ...input.advice, at: new Date(Date.now() + 90 * 60_000).toISOString() }
      : null,
    adviceWhy: input.advice ? null : 'Nothing is owed on this lead today.',
    suggestInvalid: input.verdict === 'junk',
  };
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

  // --- incoming -----------------------------------------------------------
  /*
   * The exception queue. In the preview the unowned leads stand in for it,
   * with a couple marked as bounced so the screen shows both kinds: one
   * nobody could be given, and one an agent let go.
   */
  { method: 'GET', pattern: /^\/api\/incoming$/, handler: () => ({
    items: LEADS.filter((l) => !l.owner).map((l, index) => ({
      id: l.id,
      contactId: l.contactId,
      name: l.name,
      phone: l.phone,
      language: l.language,
      project: l.project,
      budgetMaxAed: l.budgetMax,
      source: l.source,
      score: l.score,
      bounceCount: index === 0 ? 1 : 0,
      reason: index === 0 ? 'Bounced from Omar Farouk' : 'No agent available',
      arrivedAt: ago(l.createdMinutesAgo),
    })),
  }) },
  { method: 'GET', pattern: /^\/api\/incoming\/count$/, handler: () => ({
    count: LEADS.filter((l) => !l.owner).length,
  }) },
  { method: 'POST', pattern: /^\/api\/incoming\/assign$/, handler: ({ body }) => {
    const ids = new Set((body as { opportunityIds?: string[] }).opportunityIds ?? []);
    const agent = (body as { agentUserId?: string }).agentUserId ?? null;
    for (const lead of LEADS) if (ids.has(lead.id)) lead.owner = agent;
    return { assigned: ids.size, skipped: 0 };
  } },
  /*
   * One lead sitting on the signed-in person's clock, so the new-lead card
   * shows in the preview. Accepting it clears the list, as it does for real.
   */
  { method: 'GET', pattern: /^\/api\/incoming\/pending$/, handler: () => {
    const lead = LEADS[0];
    if (pendingAccepted || !lead) return { items: [] };
    return {
      items: [{
        id: 'opp-pending', contactId: lead.contactId, name: lead.name, phone: lead.phone,
        project: lead.project, budgetMaxAed: lead.budgetMax, source: lead.source, secondsLeft: 184,
      }],
    };
  } },
  { method: 'POST', pattern: /^\/api\/incoming\/([^/]+)\/accept$/, handler: () => {
    pendingAccepted = true;
    return { acceptedAt: new Date().toISOString(), actionDueInMinutes: 5 };
  } },
  { method: 'GET', pattern: /^\/api\/incoming\/settings$/, handler: () => routing },
  { method: 'PATCH', pattern: /^\/api\/incoming\/settings$/, handler: ({ body }) => {
    Object.assign(routing, body);
    /* The server caps the reminder against the deadline; the preview does the
       same so the screen behaves the way it really will. */
    routing.reminderMinutes = Math.min(routing.reminderMinutes, routing.slaMinutes - 1);
    return routing;
  } },

  /* Push is a real browser capability the preview has no server for; saying
     "not configured" is what the screen expects when it is switched off. */
  { method: 'GET', pattern: /^\/api\/users\/me\/push-config$/, handler: () => ({ configured: false }) },

  /* The bell. A couple of each kind so the grouping and the unread tint can
     both be seen in the preview. */
  { method: 'GET', pattern: /^\/api\/notifications$/, handler: () => ({
    items: NOTIFICATIONS, unread: NOTIFICATIONS.filter((n) => !n.read_at).length,
  }) },
  { method: 'GET', pattern: /^\/api\/notifications\/count$/, handler: () => ({
    unread: NOTIFICATIONS.filter((n) => !n.read_at).length,
  }) },
  { method: 'POST', pattern: /^\/api\/notifications\/read$/, handler: ({ body }) => {
    const id = (body as { id?: string }).id;
    for (const item of NOTIFICATIONS) {
      if (!id || item.id === id) item.read_at = new Date().toISOString();
    }
    return { marked: 1 };
  } },

  /* Adding a lead by hand. The duplicate check answers for one known number
     so the warning can be seen in the preview. */
  { method: 'POST', pattern: /^\/api\/leads\/check$/, handler: ({ body }) => {
    const phone = String((body as { phone?: string }).phone ?? '');
    if (phone.endsWith('501234567')) {
      return { found: true, canOpen: true, contactId: 'c-1', name: 'Sara Al Mansoori', ownerName: 'Layla Hassan' };
    }
    return { found: false };
  } },
  { method: 'GET', pattern: /^\/api\/leads\/agents$/, handler: () => ({
    items: USERS.filter((u) => u.is_active).slice(0, 4).map((u, i) => ({
      id: u.id, name: u.name, open_leads: 4 + i * 3,
    })),
  }) },
  { method: 'POST', pattern: /^\/api\/leads$/, handler: () => ({
    contactId: 'c-1', opportunityId: 'opp-new', isNewContact: true, assignedTo: null,
  }) },

  /* My Leads. The mock leads are reshaped into the row the screen expects,
     with a spread of next-step states so every colour can be seen. */
  { method: 'GET', pattern: /^\/api\/my-leads$/, handler: ({ query }) => {
    const tab = query.get('tab') ?? 'today';
    const items = myLeadRows().filter((row) => {
      if (tab === 'new') return row.stage_key === 'new_lead';
      if (tab === 'hot') return row.score_band === 'hot';
      if (tab === 'no_next_step') return row.next_step_at === null;
      if (tab === 'overdue') return row.last_contact_at === null;
      if (tab === 'all') return true;
      return row.next_step_at !== null;
    });
    return {
      tab, items, total: items.length, page: 1, pageSize: 30,
      empty: { title: 'Nothing here', hint: 'Try another tab.' },
    };
  } },
  { method: 'GET', pattern: /^\/api\/my-leads\/counts$/, handler: () => {
    const rows = myLeadRows();
    return {
      today: rows.filter((r) => r.next_step_at !== null).length,
      new: rows.filter((r) => r.stage_key === 'new_lead').length,
      hot: rows.filter((r) => r.score_band === 'hot').length,
      overdue: rows.filter((r) => r.last_contact_at === null).length,
      no_next_step: rows.filter((r) => r.next_step_at === null).length,
      all: rows.length,
    };
  } },
  { method: 'POST', pattern: /^\/api\/my-leads\/([^/]+)\/action$/, handler: ({ body }) => ({
    stageKey: 'engaged_qualified', status: 'open', nextStepAt: null,
    needsNextStep: (body as { action?: string }).action !== 'won',
    said: 'Logged',
  }) },
  { method: 'POST', pattern: /^\/api\/my-leads\/([^/]+)\/next-step$/, handler: () => ({
    stageKey: 'attempted_contact', status: 'open',
    nextStepAt: new Date(Date.now() + 86_400_000).toISOString(),
    needsNextStep: false, said: 'Next step set',
  }) },

  // --- notes --------------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/notes\/([^/]+)$/, handler: ({ params }) => {
    const items = previewNotes(params[0] ?? '').filter((n) => !n.deleted);
    return { items, files: items.flatMap((n) => NOTE_FILES.filter((f) => f.note_id === n.id)) };
  } },
  { method: 'POST', pattern: /^\/api\/notes\/([^/]+)$/, handler: ({ params, body }) => {
    const id = `note-${Date.now()}`;
    previewNotes(params[0] ?? '').unshift({
      id, author_id: OWNER.id, author_name: OWNER.name,
      type: String(body.type ?? 'general'), body: String(body.body ?? ''),
      pinned: 0, edited_at: null, created_at: new Date().toISOString(), deleted: false,
    });
    return { id, mentions: [] };
  } },
  { method: 'POST', pattern: /^\/api\/notes\/item\/([^/]+)\/files$/, handler: ({ params }) => {
    const id = `nf-${Date.now()}`;
    NOTE_FILES.push({
      id, note_id: params[0] ?? '', kind: 'file', filename: 'uploaded',
      content_type: 'image/png', byte_size: 1024, duration_s: null,
      created_at: new Date().toISOString(),
    });
    return { id };
  } },
  { method: 'PATCH', pattern: /^\/api\/notes\/item\/([^/]+)$/, handler: ({ params, body }) => {
    const note = findPreviewNote(params[0] ?? '');
    if (!note) throw { status: 404, code: 'not_found', message: 'Note not found' };
    if (body.pinned !== undefined) note.pinned = body.pinned ? 1 : 0;
    if (body.body !== undefined) { note.body = String(body.body); note.edited_at = new Date().toISOString(); }
    if (body.deleted) note.deleted = true;
    return { ok: true };
  } },
  { method: 'POST', pattern: /^\/api\/notes\/item\/([^/]+)\/restore$/, handler: ({ params }) => {
    const note = findPreviewNote(params[0] ?? '');
    if (note) note.deleted = false;
    return { ok: true };
  } },

  // --- client email -------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/email\/templates$/, handler: () => ({
    items: EMAIL_TEMPLATES,
    mergeFields: [
      { key: 'first_name', label: 'Their first name' },
      { key: 'full_name', label: 'Their full name' },
      { key: 'project', label: 'The project they asked about' },
      { key: 'budget', label: 'Their budget' },
      { key: 'unit_type', label: 'The unit type they want' },
      { key: 'emirate', label: 'Dubai or Abu Dhabi' },
      { key: 'agent_name', label: 'Your full name' },
      { key: 'agent_first_name', label: 'Your first name' },
      { key: 'agent_phone', label: 'Your phone number' },
      { key: 'agent_email', label: 'Your email' },
      { key: 'company', label: 'The company name' },
    ],
  }) },
  { method: 'POST', pattern: /^\/api\/email\/preview$/, handler: ({ body }) => {
    const lead = LEADS.find((l) => l.contactId === String(body.contactId)) ?? LEADS[0]!;
    const values: Record<string, string> = {
      first_name: lead.name.split(' ')[0] ?? 'there',
      full_name: lead.name,
      project: lead.project ?? 'the project',
      budget: lead.budgetMax ? `AED ${lead.budgetMax.toLocaleString()}` : 'your budget',
      unit_type: lead.unitType ?? 'the unit',
      emirate: 'Dubai',
      agent_name: OWNER.name,
      agent_first_name: OWNER.name.split(' ')[0] ?? OWNER.name,
      agent_phone: '+971 50 123 4567',
      agent_email: OWNER.email,
      company: 'Emigeo Homes',
    };
    const known = new Set(Object.keys(values));
    const fill = (text: string) =>
      text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) =>
        values[key.toLowerCase()] ?? whole);
    const used = (text: string) =>
      [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => (m[1] ?? '').toLowerCase());

    const subject = String(body.subject ?? '');
    const text = String(body.body ?? '');
    const unknown = [...new Set([...used(subject), ...used(text)])].filter((k) => !known.has(k));

    return {
      subject: fill(subject),
      html: previewEmailHtml(fill(subject), fill(text), values),
      text: fill(text),
      unknown,
      usedFallback: [],
      to: lead.email,
      readiness: {
        sendingOn: false, provider: 'smtp', configured: false,
        testMode: false, testRedirect: null,
        problems: ['Email sending has not been switched on yet.'],
      },
    };
  } },
  { method: 'POST', pattern: /^\/api\/email\/send$/, handler: () => ({
    sent: false, reason: 'Email sending is switched off, so nothing was delivered.',
  }) },
  { method: 'GET', pattern: /^\/api\/email\/readiness$/, handler: () => ({
    sendingOn: false, provider: 'smtp', configured: false, testMode: false,
    testRedirect: null, problems: ['Email sending has not been switched on yet.'],
  }) },
  { method: 'GET', pattern: /^\/api\/email\/events\/([^/]+)$/, handler: () => ({ items: [] }) },
  { method: 'GET', pattern: /^\/api\/email\/whatsapp-openings\/([^/]+)$/, handler: ({ params }) => {
    const lead = LEADS.find((l) => l.contactId === params[0]) ?? LEADS[0]!;
    const first = lead.name.split(' ')[0] ?? 'there';
    const project = lead.project ?? 'the project';
    const openings = [
      { key: 'first_touch', label: 'First message', text: `Hi ${first}, this is ${OWNER.name} from Emigeo Homes. Thanks for your interest in ${project}. Is now a good time for a quick call?` },
      { key: 'missed_call', label: 'After a missed call', text: `Hi ${first}, I just tried to call you about ${project}. No rush — tell me a time that suits you and I will call then.` },
      { key: 'send_details', label: 'Sending details', text: `Hi ${first}, here are the details for ${project} as promised. Have a look and tell me which layout you prefer.` },
      { key: 'check_in', label: 'Checking in', text: `Hi ${first}, just checking in about ${project}. Are you still looking, or shall I leave it for now?` },
    ];
    return {
      phone: lead.phone,
      openings: openings.map((o) => ({
        ...o,
        url: `https://wa.me/${lead.phone.replace(/\D/g, '')}?text=${encodeURIComponent(o.text)}`,
      })),
    };
  } },
  { method: 'GET', pattern: /^\/api\/email\/campaigns$/, handler: () => ({ items: EMAIL_CAMPAIGNS }) },
  { method: 'POST', pattern: /^\/api\/email\/campaigns$/, handler: ({ body }) => {
    const id = `ec-${Date.now()}`;
    EMAIL_CAMPAIGNS.unshift({
      id, name: String(body.name ?? 'Untitled'), status: 'draft',
      subject: String(body.subject ?? ''), list_name: 'Beachfront enquiries',
      created_by: OWNER.name, throttle_per_hour: Number(body.throttlePerHour ?? 200),
      total_members: 0, sent_count: 0, opened_count: 0, clicked_count: 0,
      bounced_count: 0, unsubscribed_count: 0, failed_count: 0,
      created_at: new Date().toISOString(),
    });
    return { id };
  } },
  { method: 'GET', pattern: /^\/api\/email\/campaigns\/([^/]+)\/audience$/, handler: () => ({
    willReceive: 318,
    skipped: [
      { reason: 'Never agreed to be emailed', count: 94 },
      { reason: 'No email address', count: 37 },
      { reason: 'Unsubscribed', count: 11 },
    ],
    minutes: 96,
  }) },
  { method: 'POST', pattern: /^\/api\/email\/campaigns\/([^/]+)\/start$/, handler: ({ params }) => {
    const campaign = EMAIL_CAMPAIGNS.find((c) => c.id === params[0]);
    if (campaign) { campaign.status = 'sending'; campaign.total_members = 318; }
    return { ok: true };
  } },
  { method: 'POST', pattern: /^\/api\/email\/campaigns\/([^/]+)\/pause$/, handler: ({ params }) => {
    const campaign = EMAIL_CAMPAIGNS.find((c) => c.id === params[0]);
    if (campaign) campaign.status = 'paused';
    return { ok: true };
  } },

  // --- activity -----------------------------------------------------------
  { method: 'POST', pattern: /^\/api\/activity\/beat$/, handler: () => ({ ok: true }) },
  { method: 'GET', pattern: /^\/api\/activity\/do-now$/, handler: () => ({
    greeting: `Good morning, ${currentUser().name.split(' ')[0] ?? ''}`,
    cards: [
      {
        key: 'sla_running_out', title: 'Call 2 new leads now',
        why: 'They go back to the pool in a few minutes if you do not touch them.',
        count: 2, urgency: 'now', icon: 'alarm-clock', href: '/leads?tab=new',
      },
      {
        key: 'overdue', title: '7 follow-ups are overdue',
        why: 'You said you would come back to them and the time has passed.',
        count: 7, urgency: 'now', icon: 'clock-3', href: '/leads?tab=overdue',
      },
      {
        key: 'hot_never_called', title: '3 hot leads have never been called',
        why: 'These are the most likely to buy and nobody has spoken to them yet.',
        count: 3, urgency: 'now', icon: 'flame', href: '/leads?tab=hot',
      },
      {
        key: 'no_next_step', title: '18 leads have nothing planned',
        why: 'Nobody is coming back to these. Decide what happens next, or close them.',
        count: 18, urgency: 'soon', icon: 'circle-alert', href: '/leads?tab=no_next_step',
      },
    ],
  }) },
  { method: 'GET', pattern: /^\/api\/activity\/my-week$/, handler: () => ({
    contacted: 41, appointments: 6, won: 2, newLeads: 23, rank: 2, outOf: 7,
  }) },
  { method: 'GET', pattern: /^\/api\/activity\/insight$/, handler: () => ({
    quiet: false,
    source: 'Counted from your own data',
    lines: [
      { kind: 'problem', text: '3 leads arrived with nobody to work them.' },
      { kind: 'problem', text: '2 leads were not touched inside five minutes.' },
      { kind: 'problem', text: '11 follow-ups are overdue across the team.' },
      { kind: 'number', text: '34 new leads, 13 more than the day before.' },
      { kind: 'number', text: '29 of them were contacted (85%).' },
      { kind: 'number', text: '5 appointments and 1 reservation booked.' },
      { kind: 'good', text: 'Layla Hassan spoke to the most people — 12 leads.' },
    ],
  }) },
  { method: 'GET', pattern: /^\/api\/activity\/team$/, handler: () => ({
    liveWithinMs: 120000,
    items: [
      { userId: USERS[1]?.id ?? 'u2', name: 'Layla Hassan', role: 'agent', availability: 'available',
        device: 'iPhone · Safari', where: 'Dubai, United Arab Emirates', doing: '/leads',
        live: true, lastSeen: 'Just now', lastSeenAt: new Date().toISOString() },
      { userId: USERS[2]?.id ?? 'u3', name: 'Omar Haddad', role: 'agent', availability: 'busy',
        device: 'Windows · Chrome', where: 'Dubai, United Arab Emirates', doing: '/inbox',
        live: true, lastSeen: 'Just now', lastSeenAt: new Date().toISOString() },
      { userId: USERS[3]?.id ?? 'u4', name: 'Raj Mehta', role: 'agent', availability: 'off',
        device: 'Android · Chrome', where: 'Abu Dhabi, United Arab Emirates', doing: null,
        live: false, lastSeen: '2 h ago', lastSeenAt: ago(120) },
    ],
  }) },
  { method: 'GET', pattern: /^\/api\/activity\/sessions$/, handler: ({ query }) => {
    const all = [
      {
        id: 's1', name: 'Raj Mehta', device: 'Windows · Edge', where: 'Manila, Philippines',
        level: 'alarm',
        flags: [
          { key: 'new_country', level: 'alarm', message: 'Raj Mehta signed in from Philippines, which they have never done before.' },
          { key: 'impossible_travel', level: 'alarm', message: 'Raj Mehta was in United Arab Emirates and then in Philippines less than an hour later. That is not a journey anyone makes, so the password may be in use by somebody else.' },
        ],
        signedInAt: ago(45), signedOutAt: null, activeMinutes: 12,
      },
      {
        id: 's2', name: 'Layla Hassan', device: 'iPhone · Safari', where: 'Dubai, United Arab Emirates',
        level: 'none', flags: [], signedInAt: ago(180), signedOutAt: null, activeMinutes: 164,
      },
      {
        id: 's3', name: 'Omar Haddad', device: 'Windows · Chrome', where: 'Dubai, United Arab Emirates',
        level: 'watch',
        flags: [{ key: 'new_device', level: 'watch', message: 'Omar Haddad signed in on a Windows · Chrome for the first time.' }],
        signedInAt: ago(400), signedOutAt: ago(200), activeMinutes: 88,
      },
    ];
    return { items: query.get('flagged') === '1' ? all.filter((row) => row.level !== 'none') : all };
  } },
  { method: 'GET', pattern: /^\/api\/activity\/heatmap$/, handler: () => ({ cells: [] }) },
  { method: 'POST', pattern: /^\/api\/activity\/sign-out\/([^/]+)$/, handler: () => ({
    ok: true, endedSessions: 2, name: 'Raj Mehta',
  }) },
  { method: 'GET', pattern: /^\/api\/activity\/audit$/, handler: () => ({
    page: 1, pageSize: 50,
    actions: [
      { action: 'contact.updated', n: 412 },
      { action: 'opportunity.stage_changed', n: 288 },
      { action: 'auth.login', n: 190 },
      { action: 'contact.deleted', n: 4 },
    ],
    items: [
      {
        id: 'a1', actor_user_id: 'u1', actor_name: 'Emir Dulovic', actor_label: 'emir@emigeohomes.ae',
        actor_role: 'owner', action: 'contact.deleted', entity_type: 'contact', entity_id: 'c-9',
        before_json: { full_name: 'Test Lead', phone_e164: '+971500000000', owner_user_id: 'u2' },
        after_json: { deleted_at: new Date().toISOString() },
        ip: '94.200.12.45', created_at: ago(30),
      },
      {
        id: 'a2', actor_user_id: 'u2', actor_name: 'Layla Hassan', actor_label: 'layla@emigeohomes.ae',
        actor_role: 'agent', action: 'opportunity.stage_changed', entity_type: 'opportunity',
        entity_id: 'o-14',
        before_json: { stage_key: 'attempted_contact' },
        after_json: { stage_key: 'engaged_qualified' },
        ip: '94.200.12.51', created_at: ago(55),
      },
      {
        id: 'a3', actor_user_id: 'u1', actor_name: 'Emir Dulovic', actor_label: 'emir@emigeohomes.ae',
        actor_role: 'owner', action: 'auth.force_sign_out', entity_type: 'user', entity_id: 'u4',
        before_json: null, after_json: { reason: 'Lost phone', sessions: 2 },
        ip: '94.200.12.45', created_at: ago(90),
      },
    ],
  }) },

  // --- profiles -----------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/profiles\/covers$/, handler: () => ({
    items: [
      { key: 'marina-dusk', name: 'Marina at dusk' },
      { key: 'downtown-night', name: 'Downtown at night' },
      { key: 'creek-dawn', name: 'Creek at dawn' },
      { key: 'saadiyat-day', name: 'Saadiyat by day' },
      { key: 'desert-gold', name: 'Desert gold' },
      { key: 'teal-calm', name: 'Calm teal' },
    ],
  }) },
  { method: 'GET', pattern: /^\/api\/profiles\/([^/]+)$/, handler: () => {
    const me = currentUser();
    const badges = [
      { key: 'first_deal', name: 'First deal', how: 'Close your first deal', icon: 'trophy', earned: true, progress: 1 },
      { key: 'fast_hands', name: 'Fast hands', how: 'Answer new leads in under two minutes, typically', icon: 'zap', earned: true, progress: null },
      { key: 'week_streak', name: 'Seven days running', how: 'Speak to at least one lead every day for a week', icon: 'calendar-check', earned: true, progress: 1 },
      { key: 'tidy_desk', name: 'Tidy desk', how: 'Have a next step on every open lead', icon: 'check-check', earned: true, progress: 1 },
      { key: 'under_thirty', name: 'Under thirty', how: 'Answer new leads in under thirty seconds, typically', icon: 'flame', earned: false, progress: null },
      { key: 'ten_deals', name: 'Ten deals', how: 'Close ten deals', icon: 'crown', earned: false, progress: 0.4 },
      { key: 'month_streak', name: 'Thirty days running', how: 'Speak to at least one lead every day for a month', icon: 'target', earned: false, progress: 0.23 },
      { key: 'fifty_meetings', name: 'Fifty viewings', how: 'Book fifty viewings', icon: 'map-pin', earned: false, progress: 0.62 },
      { key: 'note_taker', name: 'Note taker', how: 'Write a hundred notes', icon: 'sticky-note', earned: false, progress: 0.41 },
      { key: 'one_year', name: 'One year', how: 'Be here a year', icon: 'badge-check', earned: false, progress: 0.75 },
    ];
    return {
      profile: {
        user_id: me.id, slug: me.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: me.name, email: me.email, role: me.role,
        job_title: 'Property Consultant', brn: '48219', photo_url: null,
        phone_e164: '+971501234567',
        headline: 'Off-plan in Dubai Marina and Downtown. I answer in minutes, not days.',
        bio: 'Six years selling off-plan in Dubai. I work with buyers who want a straight answer about what a unit really costs, including the fees nobody mentions.',
        cover_key: 'marina-dusk',
        languages: ['English', 'Arabic', 'Hindi'],
        specialities: ['Off-plan', 'Dubai Marina', 'Investment'],
        public_phone: null, public_email: null, whatsapp: '+971501234567',
        instagram: null, linkedin: null, is_public: 1,
      },
      stats: { leadsWorking: 46, dealsWon: 4, appointments: 31, speedToLeadSeconds: 48, monthsHere: 9 },
      badges,
      level: { level: 'Solid', index: 2, earned: 4, of: badges.length },
      editable: true,
    };
  } },
  { method: 'PATCH', pattern: /^\/api\/profiles\/([^/]+)$/, handler: () => ({ ok: true }) },

  // --- the command palette, the tour, and the lead brief -------------------
  /*
   * What Cmd+K asks for. The same two-list shape the real endpoint returns,
   * matched the same way: a name, an email, a project, or a phone number in
   * whatever shape it was typed.
   */
  { method: 'GET', pattern: /^\/api\/search$/, handler: ({ query }) => {
    const q = (query.get('q') ?? '').trim().toLowerCase();
    if (!q) return { leads: [], projects: [] };
    const digits = q.replace(/\D/g, '').replace(/^0+/, '');

    const leads = LEADS.filter((lead) => {
      if (lead.name.toLowerCase().includes(q)) return true;
      if ((lead.email ?? '').toLowerCase().includes(q)) return true;
      if ((lead.project ?? '').toLowerCase().includes(q)) return true;
      return digits.length >= 6 && lead.phone.replace(/\D/g, '').endsWith(digits.slice(-9));
    })
      .slice(0, 6)
      .map((lead) => ({
        id: lead.id,
        label: lead.name,
        hint: [lead.project, STAGES.find((stage) => stage.key === lead.stage)?.name].filter(Boolean).join(' · ') || null,
        to: `/contacts/${lead.contactId}`,
      }));

    const projects = PROJECTS.filter((project) =>
      [project.name, project.developer, project.area].some((field) => (field ?? '').toLowerCase().includes(q)),
    )
      .slice(0, 6)
      .map((project) => ({
        id: project.id,
        label: project.name,
        hint: [project.developer, project.area].filter(Boolean).join(' · ') || null,
        to: `/projects?project=${project.id}`,
      }));

    return { leads, projects };
  } },

  /* The tour starts unseen in the preview, so it can be demonstrated. */
  { method: 'GET', pattern: /^\/api\/prefs$/, handler: () => ({ prefs: PREVIEW_PREFS }) },
  { method: 'PUT', pattern: /^\/api\/prefs$/, handler: ({ body }) => {
    const name = String(body.name ?? '');
    if (name) {
      PREVIEW_PREFS[name] = body.value === null ? null : String(body.value);
      writePreviewPrefs();
    }
    return { ok: true };
  } },

  { method: 'GET', pattern: /^\/api\/my-leads\/([^/]+)\/brief$/, handler: ({ params }) => leadBrief(params[0] ?? '') },
  { method: 'POST', pattern: /^\/api\/my-leads\/([^/]+)\/brief$/, handler: ({ params }) => ({
    ...leadBrief(params[0] ?? ''), refreshed: true,
  }) },

  // --- team wall ----------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/wall$/, handler: () => ({ items: WALL_POSTS }) },
  { method: 'POST', pattern: /^\/api\/wall$/, handler: ({ body }) => {
    const id = `wp-${Date.now()}`;
    WALL_POSTS.unshift({
      id, author_id: currentUser().id, author_name: currentUser().name, kind: 'post',
      body: String(body.body ?? ''), poll: null, show_value: 0, pinned_at: null,
      created_at: new Date().toISOString(), reactions: [], comments: [], commentCount: 0,
    });
    return { id };
  } },
  { method: 'POST', pattern: /^\/api\/wall\/([^/]+)\/react$/, handler: ({ params, body }) => {
    const post = WALL_POSTS.find((p) => p.id === params[0]);
    const emoji = String(body.emoji ?? '👏');
    if (post) {
      const found = post.reactions.find((r) => r.emoji === emoji);
      if (found) {
        found.mine = !found.mine;
        found.count += found.mine ? 1 : -1;
        if (found.count <= 0) post.reactions = post.reactions.filter((r) => r.emoji !== emoji);
      } else post.reactions.push({ emoji, count: 1, mine: true });
    }
    return { on: true };
  } },
  { method: 'POST', pattern: /^\/api\/wall\/([^/]+)\/comments$/, handler: ({ params, body }) => {
    const post = WALL_POSTS.find((p) => p.id === params[0]);
    if (post) {
      post.comments.push({
        id: `wc-${Date.now()}`, author_name: currentUser().name,
        body: String(body.body ?? ''), created_at: new Date().toISOString(),
      });
      post.commentCount += 1;
    }
    return { id: `wc-${Date.now()}` };
  } },
  { method: 'DELETE', pattern: /^\/api\/wall\/([^/]+)$/, handler: ({ params }) => {
    const index = WALL_POSTS.findIndex((p) => p.id === params[0]);
    if (index >= 0) WALL_POSTS.splice(index, 1);
    return { ok: true };
  } },
  { method: 'POST', pattern: /^\/api\/wall\/kudos$/, handler: () => ({ left: 3 }) },
  { method: 'GET', pattern: /^\/api\/wall\/sidebar$/, handler: () => ({
    leaderboard: [
      { id: USERS[1]?.id ?? 'u2', name: 'Layla Hassan', points: 418 },
      { id: OWNER.id, name: OWNER.name, points: 377 },
      { id: USERS[2]?.id ?? 'u3', name: 'Omar Haddad', points: 265 },
      { id: USERS[3]?.id ?? 'u4', name: 'Raj Mehta', points: 191 },
    ],
    online: [
      { id: USERS[1]?.id ?? 'u2', name: 'Layla Hassan' },
      { id: USERS[2]?.id ?? 'u3', name: 'Omar Haddad' },
    ],
    me: {
      points: 377,
      level: { level: 4, name: 'Steady', points: 377, from: 150, next: 400, progress: 0.908 },
      streak: 9,
      kudosLeft: 3,
      badges: ['first_deal', 'fast_hands', 'week_streak', 'tidy_desk'],
    },
    badgeCount: 10,
  }) },
  { method: 'GET', pattern: /^\/api\/wall\/unseen-badges$/, handler: () => ({ items: [] }) },
  { method: 'POST', pattern: /^\/api\/wall\/unseen-badges\/seen$/, handler: () => ({ ok: true }) },

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
        first_source: lead.source, created_at: ago(lead.createdMinutesAgo),
        notes: lead.score >= 70
          ? 'Looking for a 2 bedroom with a sea view, handover 2027 or sooner. Budget is flexible for the right unit. Please call after 6pm, I am at work during the day.'
          : null,
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
        { channel: 'whatsapp', granted: 1, source: lead.source, consent_text: 'I agree to be contacted by Emigeo Homes Real Estate LLC by phone, WhatsApp and email about property offers.', created_at: ago(lead.createdMinutesAgo) },
        ...(lead.email ? [{ channel: 'email', granted: 1, source: lead.source, consent_text: 'I agree to be contacted by Emigeo Homes Real Estate LLC by phone, WhatsApp and email about property offers.', created_at: ago(lead.createdMinutesAgo) }] : []),
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
  /*
   * The wizard's first step. Without this the preview could show the import
   * list but never the wizard itself, because nothing answered the upload.
   */
  { method: 'POST', pattern: /^\/api\/imports\/paste$/, handler: ({ body }) => {
    const text = String(body.text ?? '');
    const rows = text.split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => line.split(','));
    const headers = (rows[0] ?? ['Column 1']).map((cell) => cell.trim());
    /* Remembered so the validate step reports what was actually pasted, which
       is what decides whether the five-minute switch is available. */
    pastedRows = Math.max(0, rows.length - 1);
    return {
      id: 'imp-preview',
      filename: String(body.filename ?? 'Pasted rows'),
      kind: 'paste',
      headers,
      preview: rows.slice(1, 21),
      suggestedMapping: Object.fromEntries(headers.map((header) => {
        const key = header.toLowerCase();
        if (key.includes('name')) return [header, 'fullName'];
        if (key.includes('mobile') || key.includes('phone')) return [header, 'phone'];
        if (key.includes('mail')) return [header, 'email'];
        if (key.includes('project')) return [header, 'projectName'];
        if (key.includes('budget')) return [header, 'budgetBand'];
        return [header, null];
      })),
      defaults: {
        sourceLabel: 'Import', source: 'csv_import', tags: [], projectName: null,
        pipelineKey: 'sales', stageKey: 'new_lead', consent: 'unknown',
        duplicateStrategy: 'fill_empty', phoneRegion: 'AE', treatAsNew: false,
      },
    };
  } },
  { method: 'PATCH', pattern: /^\/api\/imports\/([^/]+)$/, handler: () => ({ ok: true }) },
  { method: 'POST', pattern: /^\/api\/imports\/([^/]+)\/start$/, handler: () => ({
    ok: true, batchTag: 'pasted-rows-30oct-impp', treatAsNew: false,
  }) },
  { method: 'POST', pattern: /^\/api\/imports\/([^/]+)\/duplicates$/, handler: () => ({
    exact: 0, possible: 0, sample: [],
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
        mapping: null,
        settings: { batchTag: 'expo-2026-30oct-a3f2', treatAsNew: false },
        assignment: null,
        error_message: null,
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
  { method: 'POST', pattern: /^\/api\/imports\/([^/]+)\/validate$/, handler: () => ({
    total: pastedRows || 250, treatAsNewMaxRows: 200,
  }) },
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


/**
 * Media the mock cannot serve.
 *
 * `window.fetch` is patched, but an `<audio src>` or `<img src>` is loaded by
 * the browser itself and never goes through it, so a voice note in the preview
 * asked the dev server for `/api/notes/files/…` and got a 500. Rather than put
 * a preview check inside the component, the element's own `src` setter is
 * redirected here — this file is dropped from a production build.
 */
function installMediaMock(): void {
  /* A second of silence, built rather than fetched, so the player has a real
     duration and the controls behave. */
  const silentWav = (): string => {
    const rate = 8000;
    const samples = rate * 2;
    const buffer = new ArrayBuffer(44 + samples);
    const view = new DataView(buffer);
    const ascii = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + samples, true);
    ascii(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    ascii(36, 'data');
    view.setUint32(40, samples, true);
    for (let i = 0; i < samples; i += 1) view.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  };

  const audio = silentWav();
  /* A 1×1 teal pixel, stretched by the thumbnail's object-fit. */
  const image = 'data:image/gif;base64,R0lGODlhAQABAPAAAAqjugAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';

  const redirect = (value: string, fallback: string): string =>
    (value.includes('/api/notes/files/') || value.includes('/api/tasks/attachments/')) ? fallback : value;

  for (const [element, fallback] of [
    [HTMLAudioElement, audio],
    [HTMLImageElement, image],
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(element.prototype, 'src');
    if (descriptor?.set && descriptor.get) {
      Object.defineProperty(element.prototype, 'src', {
        ...descriptor,
        set(this: HTMLElement, value: string) {
          descriptor.set!.call(this, redirect(String(value), fallback));
        },
      });
    }

    /* React writes `src` on a media or image element with setAttribute rather
       than the property, so the setter above never sees it. */
    const setAttribute = element.prototype.setAttribute;
    element.prototype.setAttribute = function patched(
      this: HTMLElement, name: string, value: string,
    ): void {
      setAttribute.call(this, name, name === 'src' ? redirect(String(value), fallback) : value);
    };
  }
}

/** Replace window.fetch for /api/* only; everything else passes through. */
export function installMockApi(): void {
  installMediaMock();
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
