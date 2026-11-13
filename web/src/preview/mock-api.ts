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
import { SETTINGS_ROUTES } from './mock-settings.js';
import { DASHBOARD_ROUTES } from './mock-dashboard.js';
import { previewLive } from './live.js';

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
const session = {
  /*
   * Signed in, unless somebody asked not to be.
   *
   * The preview exists to show screens, and until this flag the login screen
   * was the one screen it could not show: every load reset this to true and
   * /login bounced straight to the Dashboard. Set
   * `localStorage['emir.previewSignedOut'] = '1'` to look at it.
   */
  signedIn: (() => {
    try { return localStorage.getItem('emir.previewSignedOut') !== '1'; } catch { return true; }
  })(),
  locale: 'en',
};

const routing = {
  slaEnabled: false, slaMinutes: 5, reminderMinutes: 3, autoAssign: true, bounceToOwner: true,
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
/*
 * A lead list the size a real one is.
 *
 * Eight rows made every list on this screen fit on one page, so the preview
 * never showed the "Show more" button and never would have caught it being
 * missing -- which is how Emir ended up with a tab reading 419 and a list of
 * thirty. The demo leads are cycled to a believable number instead.
 */
const DEMO_LEAD_ROWS = 124;

function myLeadRows() {
  const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
  return Array.from({ length: DEMO_LEAD_ROWS }, (_unused, index) => {
    const lead = LEADS[index % LEADS.length]!;
    return { lead, index };
  }).map(({ lead, index }) => ({
    /*
     * The real lead's own id for the ones that have a contact page behind
     * them. The list used to invent `opp-0`, `opp-1`, ... while the lead
     * page used `o-1`, so "Next lead" could never find where it was in the
     * list here -- the preview mirrored the live bug instead of catching it.
     */
    id: index < LEADS.length ? lead.id : `opp-${index}`,
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
    /* The real /api/auth/me carries this, so the preview must too, or the
       sidebar shows initials here and a face in production. */
    photoUrl: photoOf(as.id),
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
    /*
     * Only the lead that really is on the clock in the preview carries a
     * deadline. The rest show no countdown, which is the point of the change:
     * a clock on a card has to mean a clock that is running.
     */
    sla_due_at: lead.id === 'opp-1' && !lead.slaBreached
      ? new Date(Date.now() + 184_000).toISOString()
      : null,
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

/* What people have written about themselves, for the team tab. Only the
   working half of a person: that is all the real endpoint returns. */
const PREVIEW_TITLES: Record<string, string> = {
  'u-owner': 'Founder',
  'u-layla': 'Senior property consultant',
  'u-omar': 'Property consultant',
  'u-priya': 'Property consultant',
  'u-yousef': 'Sales manager',
};

const PREVIEW_CALLED: Record<string, string> = { 'u-yousef': 'Yas' };

/*
 * Who has uploaded a photo. Deliberately not everybody: the live CRM is a
 * mix, and a preview where every avatar is a photograph hides the case that
 * matters — initials and a face side by side in the same list.
 */
const PREVIEW_PHOTOS: Record<string, string> = {
  'u-owner': '/preview/face-1.svg',
  'u-layla': '/preview/face-2.svg',
  'u-yousef': '/preview/face-3.svg',
};
const photoOf = (id: string | null): string | null => (id ? PREVIEW_PHOTOS[id] ?? null : null);

/* Blank fields, in the words the profile page uses for them. */
const PREVIEW_MISSING: Record<string, string[]> = {
  'u-owner': [],
  'u-layla': ['photo'],
  'u-omar': ['photo', 'about them'],
  'u-priya': ['photo', 'about them', 'headline', 'phone for clients', 'email for clients'],
  'u-yousef': ['about them'],
};

const PREVIEW_ANSWERS: Record<string, Record<string, string>> = {
  'u-layla': {
    goal_this_year: 'My first AED 10M deal, and to stop losing the ones that go quiet after the brochure.',
    deals_per_month: '3',
    growth_view: 'Top three in Dubai off-plan within two years. We are faster than the big ones.',
    the_dream: 'A house for my mother in Beirut, and a team of my own here.',
    five_years: 'Running the Beachfront desk with four people under me.',
  },
  'u-omar': {
    goal_this_year: 'Thirty reservations. Last year I did nineteen and half of those came in December.',
    deals_per_month: '2',
    growth_view: 'Twice the size if we keep the Arabic desk properly staffed.',
    the_dream: 'My own brokerage one day. Learning how it is run first.',
    five_years: 'Partner somewhere, or running my own small office in Abu Dhabi.',
  },
  'u-yousef': {
    goal_this_year: 'Get every agent on the desk to a deal a month. That is the whole job.',
    deals_per_month: '1',
    growth_view: 'We can double if the lead quality holds. The people are not the problem.',
    the_dream: 'A desk that runs itself without me checking the board at midnight.',
    five_years: 'Head of sales, and a second office in Abu Dhabi.',
  },
  /* Part way through: three of five. */
  'u-priya': {
    goal_this_year: 'Learn the market properly and close my first deal.',
    deals_per_month: '1',
    growth_view: 'No idea yet, I only started three weeks ago.',
  },
};

const PREVIEW_SPEAKS: Record<string, string[]> = {
  'u-owner': ['English', 'Bosnian'],
  'u-layla': ['English', 'Arabic'],
  'u-omar': ['Arabic', 'English'],
  'u-priya': ['English', 'Hindi', 'Malayalam'],
  'u-yousef': ['English', 'Arabic'],
};

const PREVIEW_SELLS: Record<string, string[]> = {
  'u-layla': ['Emaar Beachfront', 'Dubai Harbour'],
  'u-omar': ['Damac Lagoons', 'Dubailand'],
  'u-priya': ['Studios', 'One-beds'],
  'u-yousef': ['Dubai desk'],
};

const PREVIEW_HEADLINES: Record<string, string> = {
  'u-layla': 'Beachfront and Dubai Harbour. Arabic and English.',
  'u-omar': 'Lagoons and Dubailand. Arabic first.',
  'u-priya': 'First-time investors, studios and one-beds.',
  'u-yousef': 'Looks after the Dubai desk.',
};

/*
 * Attendance, for the preview. The owner is shown on the office Wi-Fi so the
 * card's main state is the one on screen; a month of plausible days follows,
 * with one person who is often out and one who misses days, because a grid
 * where everybody is perfect shows nothing.
 */
const previewAttendance = {
  marked: null as 'office' | 'outside' | null,
  at: null as string | null,
  note: null as string | null,
  settings: {
    enabled: true,
    officeIps: ['203.0.113.10'],
    start: '10:00',
    end: '19:00',
    satStart: '11:00',
    satEnd: '15:00',
    closedDays: [0],
    graceMinutes: 10,
  },
  today(): Record<string, unknown> {
    return {
      closed: false,
      marked: previewAttendance.marked,
      markedAt: previewAttendance.at,
      wasLate: false,
      note: previewAttendance.note,
      onOfficeNetwork: true,
      seenIp: '203.0.113.10',
      enabled: true,
      startsAt: '10:00',
    };
  },
};

function previewMonth(query: URLSearchParams): Record<string, unknown> {
  /* Honour the range the chips ask for, so 7 / 30 / 90 days actually differ. */
  const to = query.get('to') ?? new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
  const from = query.get('from') ?? to;
  const last = Date.parse(`${to}T00:00:00Z`);
  const span = Math.min(
    120,
    Math.max(1, Math.round((last - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1),
  );

  const dates: Array<{ date: string; closed: boolean }> = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const at = new Date(last - i * 86_400_000);
    dates.push({ date: at.toISOString().slice(0, 10), closed: at.getUTCDay() === 0 });
  }

  /* A fixed pattern per person rather than Math.random, so the grid looks the
     same every time somebody opens the preview. */
  const shape: Array<[string, string, number, number]> = [
    ['u-layla', 'Layla Hassan', 0, 7],
    ['u-omar', 'Omar Farouk', 1, 5],
    ['u-priya', 'Priya Nair', 2, 4],
    ['u-yousef', 'Yousef Karim', 3, 9],
  ];

  return {
    from: dates[0]?.date,
    to: dates[dates.length - 1]?.date,
    dates,
    people: shape.map(([id, name, offset, every]) => {
      let inOffice = 0; let outside = 0; let late = 0; let absent = 0;
      const days = dates.map((d, i) => {
        if (d.closed) return { date: d.date, kind: null, at: null, late: false, note: null };
        const n = i + offset;
        if (n % every === 0) {
          outside += 1;
          return {
            date: d.date, kind: 'outside', at: `${d.date}T05:50:00Z`,
            late: false, note: 'Emaar sales centre',
          };
        }
        if (n % 11 === 0) { absent += 1; return { date: d.date, kind: null, at: null, late: false, note: null }; }
        const isLate = n % 6 === 0;
        inOffice += 1;
        if (isLate) late += 1;
        return {
          date: d.date, kind: 'office',
          at: `${d.date}T0${isLate ? '6:4' : '5:5'}0:00Z`,
          late: isLate, note: null,
        };
      });
      return {
        userId: id, name, role: 'agent', photoUrl: photoOf(id),
        days, inOffice, outside, late, absent,
      };
    }),
  };
}

/* ── Team wall ────────────────────────────────────────────────────────── */

interface PreviewWallPost {
  id: string; author_id: string | null; author_name: string | null;
  author_photo_url?: string | null; kind: string;
  body: string | null; media?: unknown; poll: unknown; show_value: number;
  pinned_at: string | null; created_at: string;
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
    id: 'wp-2', author_id: 'u2', author_name: 'Layla Hassan',
    author_photo_url: '/preview/face-2.svg', kind: 'deal_won',
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
    id: 'wp-5', author_id: 'u2', author_name: 'Layla Hassan',
    author_photo_url: '/preview/face-2.svg', kind: 'post',
    body: 'Site visit this morning at Beachfront. Tower is at 62% and the show apartment is open — worth taking buyers.',
    media: [
      { id: 'pm-1', url: '/preview/wall-1.svg', kind: 'image', name: 'Tower at dusk' },
      { id: 'pm-2', url: '/preview/wall-2.svg', kind: 'image', name: 'Show apartment' },
    ],
    poll: null, show_value: 0, pinned_at: null, created_at: ago(240),
    reactions: [{ emoji: '🔥', count: 5, mine: false }, { emoji: '👏', count: 2, mine: true }],
    comments: [{ id: 'wc-4', author_name: 'Raj Mehta', body: 'Taking two couples Saturday.', created_at: ago(80) }],
    commentCount: 1,
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
  /* Owner news: a pinned post by a person. The wall draws it on top, and the
     project library reads it for the note across the top of that screen. */
  {
    id: 'wp-6', author_id: OWNER.id, author_name: OWNER.name,
    author_photo_url: '/preview/face-1.svg', kind: 'post',
    body: 'This week we push Emaar Beachfront.\nSobha Hartland II launches soon: write down every client who asks, the first units go fast.',
    poll: null, show_value: 0, pinned_at: ago(60 * 5), created_at: ago(60 * 5),
    reactions: [{ emoji: '👏', count: 8, mine: false }, { emoji: '🔥', count: 5, mine: true }],
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

/* The server's onboarding questions, copied so the preview can show the flow
   with no server. If the real list changes, change this one too. */
const PREVIEW_WELCOME_QUESTIONS = [
  { id: 'goal_this_year', image: 'working', emoji: '\u{1F3AF}', prompt: 'What are you going after this year?', hint: 'One thing. The one that would make the year a good one.', kind: 'text', placeholder: 'My first AED 10M deal', maxLength: 280 },
  { id: 'deals_per_month', image: 'keys', emoji: '\u{1F91D}', prompt: 'Deals a month. What is your number?', hint: 'Not a promise. What you think you can do.', kind: 'number', min: 0, max: 100 },
  { id: 'growth_view', image: 'ideas', emoji: '\u{1F4C8}', prompt: 'How big do you think homes.me can get?', hint: 'Say it however you like. Deals, people, a feeling.', kind: 'text', placeholder: 'Top three in Dubai off-plan within two years', maxLength: 280 },
  { id: 'the_dream', image: 'dream', emoji: '\u2728', prompt: 'What is the dream?', hint: 'Yours, not the company\u2019s.', kind: 'text', placeholder: 'A house for my mother, and a team of my own', maxLength: 280 },
  { id: 'five_years', image: 'celebrate', emoji: '\u{1F5FA}\uFE0F', prompt: 'Where are you in five years?', kind: 'text', placeholder: 'Running the Abu Dhabi desk', maxLength: 280 },
];


/* What the welcome has been told so far, for the length of a preview visit. */
const previewWelcome: {
  preferredName: string | null;
  avatarSet: 'man' | 'woman' | null;
  answers: Record<string, string>;
} = { preferredName: null, avatarSet: null, answers: {} };

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

/* The project library, built from the same projects the rest of the preview
   uses — a project named on a lead is the project found here. */
const LIBRARY_CARDS = PROJECTS.map((project, index) => ({
  id: project.id,
  slug: project.slug,
  name: project.name,
  developer: project.developer,
  developer_id: `dv-${index + 1}`,
  emirate: project.emirate,
  community: project.area,
  property_type: index === 1 ? 'villa' : 'apartment',
  sale_status: (index === 3 ? 'coming_soon' : 'selling_now') as 'selling_now' | 'coming_soon' | 'sold_out',
  starting_price_aed: project.starting_price_aed,
  handover_date: project.handover_date,
  payment_plan: project.payment_plan,
  image_url: null as string | null,
  cover_photo_id: null as string | null,
  visibility: 'private' as const,
  starred: index === 0 ? 1 : 0,
  verified_at: project.verified_at,
  archived_at: null as string | null,
  units_available: [34, 29, 23, 0][index] ?? 0,
  units_total: [120, 96, 74, 0][index] ?? 0,
}));

const DEVELOPERS = [
  { id: 'dv-1', slug: 'emaar', legal_name: 'Emaar Properties PJSC', short_name: 'Emaar', orn: '1122',
    trn: '100111222333444', head_office: 'Downtown Dubai', escrow_bank: 'Emirates NBD',
    website: 'https://www.emaar.com', track_record: 'Listed developer, delivering since 1997.',
    commission_pct: '4.00', payment_terms: '60 days from SPA', project_count: 1, contact_count: 2 },
  { id: 'dv-2', slug: 'damac', legal_name: 'DAMAC Properties Dubai Co.', short_name: 'Damac', orn: '2244',
    trn: '100222333444555', head_office: 'Business Bay', escrow_bank: 'Mashreq',
    website: 'https://www.damacproperties.com', track_record: 'High volume across Dubailand.',
    commission_pct: '5.00', payment_terms: '45 days from booking', project_count: 1, contact_count: 1 },
  { id: 'dv-3', slug: 'aldar', legal_name: 'Aldar Properties PJSC', short_name: 'Aldar', orn: '3366',
    trn: '100333444555666', head_office: 'Al Raha Beach, Abu Dhabi', escrow_bank: 'First Abu Dhabi Bank',
    website: 'https://www.aldar.com', track_record: 'Abu Dhabi master developer.',
    commission_pct: '4.50', payment_terms: '30 days from SPA', project_count: 1, contact_count: 3 },
  { id: 'dv-4', slug: 'sobha', legal_name: 'Sobha Realty LLC', short_name: 'Sobha', orn: '4488',
    trn: null, head_office: 'Sobha Hartland', escrow_bank: null,
    website: 'https://www.sobharealty.com', track_record: null,
    commission_pct: null, payment_terms: null, project_count: 1, contact_count: 0 },
];

/* The offer library. One of each state a card can be in, so the screen shows
   what it looks like in use rather than an empty folder. */
const OFFER_FOLDERS = [
  { id: 'ofd-1', name: 'Saadiyat Island', parent_id: null, is_shared: 0, created_by: 'u-layla', offer_count: 2 },
  { id: 'ofd-2', name: 'VIP investors', parent_id: null, is_shared: 0, created_by: 'u-omar', offer_count: 1 },
  { id: 'ofd-3', name: 'Templates', parent_id: null, is_shared: 1, created_by: null, offer_count: 3 },
];

type PreviewOffer = {
  id: string; slug: string; title: string; folder_id: string | null; contact_id: string | null;
  project_id: string | null; agent_user_id: string; client_name: string | null;
  project_name: string | null; agent_name: string | null; language: string; cover_style: number;
  status: 'draft' | 'sent' | 'revoked'; starred: number; hold_until: string | null;
  sent_at: string | null; deleted_at: string | null; updated_at: string; opens: number;
  total_secs: number; last_view_at: string | null; state: 'draft' | 'sent' | 'opened' | 'reading' | 'revoked';
};

function offerCard(over: Partial<PreviewOffer>): PreviewOffer {
  return {
    id: 'of-0', slug: 'of-0', title: 'Offer', folder_id: null, contact_id: 'c-1', project_id: 'p-1',
    agent_user_id: 'u-layla', client_name: 'Sara Al Mansoori', project_name: 'Emaar Beachfront',
    agent_name: 'Layla Hassan', language: 'en', cover_style: 1, status: 'sent', starred: 0,
    hold_until: null, sent_at: null, deleted_at: null, updated_at: new Date().toISOString(),
    opens: 0, total_secs: 0, last_view_at: null, state: 'sent',
    ...over,
  };
}

const OFFERS: PreviewOffer[] = [
  offerCard({
    id: 'of-1', slug: 'beachfront-sara', title: 'Emaar Beachfront — 2 BR sea view',
    starred: 1, status: 'sent', state: 'reading', opens: 7, total_secs: 622,
    sent_at: new Date(Date.now() - 36e5 * 26).toISOString(),
    last_view_at: new Date(Date.now() - 60_000).toISOString(),
    hold_until: new Date(Date.now() + 36e5 * 48).toISOString(),
  }),
  offerCard({
    id: 'of-2', slug: 'lagoons-omar', title: 'Damac Lagoons — 4 BR villa',
    client_name: 'Omar Haddad', project_name: 'Damac Lagoons', agent_name: 'Omar Farouk',
    agent_user_id: 'u-omar', contact_id: 'c-2', language: 'ar',
    cover_style: 2, status: 'sent', state: 'opened', opens: 2, total_secs: 143,
    sent_at: new Date(Date.now() - 36e5 * 70).toISOString(),
    last_view_at: new Date(Date.now() - 36e5 * 5).toISOString(),
  }),
  offerCard({
    id: 'of-3', slug: 'saadiyat-david', title: 'Saadiyat Lagoons — payment plan',
    client_name: 'David Chen', project_name: 'Saadiyat Lagoons', contact_id: 'c-4',
    cover_style: 3, status: 'sent', state: 'sent', opens: 0,
    sent_at: new Date(Date.now() - 36e5 * 3).toISOString(),
  }),
  offerCard({
    id: 'of-4', slug: 'draft-nadia', title: 'Untitled offer',
    client_name: null, project_name: null, cover_style: 4, status: 'draft', state: 'draft', opens: 0,
  }),
  offerCard({
    id: 'of-5', slug: 'old-offer', title: 'Creek Harbour — 1 BR',
    client_name: 'Ahmed Khalil', project_name: 'Emaar Creek Harbour', contact_id: 'c-3',
    cover_style: 5, status: 'sent', state: 'sent', opens: 1,
    deleted_at: new Date(Date.now() - 36e5 * 100).toISOString(),
  }),
];

/* The company as a client sees it. Filled in, so the Settings screen shows
   what a finished record looks like rather than an empty form. */
const PREVIEW_COMPANY = {
  legalName: 'Emigeo Homes Real Estate LLC',
  tradingName: 'Emigeo Homes',
  localityEn: 'Dubai & Abu Dhabi',
  localityAr: 'دبي وأبوظبي',
  trn: '100123456700003',
  orn: '31482',
  licenceNo: 'CN-4471920',
  licenceExpiry: '2027-04-18',
  address: 'Office 1204, Boulevard Plaza Tower 1, Downtown Dubai',
  phone: '+971 4 123 4567',
  whatsapp: '+971501112233',
  email: 'hello@homes.me',
  website: 'https://homes.me',
  logoUrl: '',
};

const PREVIEW_MESSAGING = { quietStartHour: 22, quietEndHour: 8, maxPer24h: 3, botPauseHours: 24 };

function previewCompanyIssues(): string[] {
  const issues: string[] = [];
  if (!PREVIEW_COMPANY.trn) issues.push('No TRN yet. It has to appear on every tax invoice.');
  if (PREVIEW_COMPANY.trn && !/^\d{15}$/.test(PREVIEW_COMPANY.trn.replace(/\s/g, ''))) {
    issues.push('A UAE tax registration number is fifteen digits. Check the TRN.');
  }
  if (!PREVIEW_COMPANY.logoUrl) {
    issues.push('No logo yet. Offers and the business card fall back to the initials.');
  }
  return issues;
}

function previewMessaging() {
  const length = (PREVIEW_MESSAGING.quietEndHour - PREVIEW_MESSAGING.quietStartHour + 24) % 24;
  const pad = (hour: number) => String(hour).padStart(2, '0');
  return {
    ...PREVIEW_MESSAGING,
    describes: `${pad(PREVIEW_MESSAGING.quietStartHour)}:00 to ${pad(PREVIEW_MESSAGING.quietEndHour)}:00 — ${length} hours`,
    customised:
      PREVIEW_MESSAGING.quietStartHour !== 22 || PREVIEW_MESSAGING.quietEndHour !== 8
      || PREVIEW_MESSAGING.maxPer24h !== 3 || PREVIEW_MESSAGING.botPauseHours !== 24,
    defaults: { quietStartHour: 22, quietEndHour: 8, maxPer24h: 3, botPauseHours: 24 },
    limits: { maxPer24hCeiling: 6, botPauseHours: [1, 72] },
  };
}

/* ── settings state the preview mutates ─────────────────────────────────
 *
 * Module-level so a change made on one panel is still there when the page is
 * navigated away from and back, the way it would be with a real server.
 */

const notifyState = {
  switches: {} as Record<string, boolean>,
  computer: true,
  sounds: true,
  volume: 0.12,
  soundNewLead: true,
  soundWon: true,
  quiet: '22:00-08:00' as string | null,
  vipIgnoresQuiet: true,
};

/** The groups, with the server's own wording. */
const NOTIFY_GROUPS = [
  { key: 'agent_leads', title: 'My leads', forRole: 'agent', switches: [
    { id: 'vip_lead', title: 'VIP lead from the owner', note: 'You have a time limit to call. This alert is always loud.', alwaysOn: true },
    { id: 'new_lead', title: 'New lead given to me', note: 'From the owner, an import or a transfer', alwaysOn: false },
    { id: 'going_back', title: 'Lead goes back soon', note: '10 min before a VIP lead and 1 hour before an imported lead goes back to Incoming', alwaysOn: false },
    { id: 'link_opened', title: 'Client opened my link', note: 'Brochure, payment plan or location link', alwaysOn: false },
    { id: 'transfer_in', title: 'Transfer request for me', note: 'A colleague wants to give you a lead', alwaysOn: false },
    { id: 'what_happened', title: '"What happened?" reminders', note: 'When a WhatsApp or Telegram tap has no update yet', alwaysOn: false },
  ] },
  { key: 'agent_day', title: 'My day', forRole: 'agent', switches: [
    { id: 'followup_due', title: 'Follow-up is due', note: 'At the time you planned', alwaysOn: false },
    { id: 'meeting_soon', title: 'Meeting or site visit', note: '2 hours before, and again 15 min before', alwaysOn: false },
    { id: 'how_did_it_go', title: '"How did it go?"', note: 'After each meeting · answer before 21:00', alwaysOn: false },
    { id: 'task_from_owner', title: 'Task from the owner', note: 'A new task or a change', alwaysOn: false },
    { id: 'check_in', title: 'Check-in reminder', note: 'At the start of the shift, only if you are not checked in', alwaysOn: false },
  ] },
  { key: 'agent_team', title: 'Team and office', forRole: 'agent', switches: [
    { id: 'leave_answered', title: 'Leave request answered', note: 'Approved or refused', alwaysOn: false },
    { id: 'owner_news', title: 'News from the owner', note: 'Home banners and owner posts on the Team wall', alwaysOn: false },
    { id: 'wall', title: 'Team wall and Best of Homes', note: 'New posts, reactions, weekly results', alwaysOn: false },
  ] },
  { key: 'owner_leads', title: 'Leads', forRole: 'owner', switches: [
    { id: 'vip_late', title: 'VIP lead not called in time', note: 'The lead came back to Incoming', alwaysOn: true },
    { id: 'incoming_waiting', title: 'Leads waiting in Incoming', note: 'When a lead waits more than 15 min', alwaysOn: false },
    { id: 'transfer_approval', title: 'Transfer needs my approval', note: 'Leads in Meeting or Offer stage', alwaysOn: false },
    { id: 'unit_booked', title: 'Unit booked', note: 'An agent marks a lead as Won', alwaysOn: false },
    { id: 'wrong_number', title: 'Wrong number flagged', note: 'An agent says the number is wrong', alwaysOn: false },
    { id: 'import_done', title: 'Import finished', note: 'Result per agent', alwaysOn: false },
  ] },
  { key: 'owner_team', title: 'Team', forRole: 'owner', switches: [
    { id: 'leave_requests', title: 'Leave requests', note: 'A new request to answer', alwaysOn: false },
    { id: 'agent_absent', title: 'Agent absent', note: 'No check-in and no leave an hour into the shift', alwaysOn: false },
    { id: 'agent_late', title: 'Agent late', note: 'Check-in after the grace minutes', alwaysOn: false },
    { id: 'working_outside', title: 'Working outside', note: 'An agent starts or ends work outside', alwaysOn: false },
    { id: 'meeting_result_missing', title: 'Meeting result missing', note: 'Not answered by 21:00', alwaysOn: false },
  ] },
  { key: 'owner_system', title: 'System', forRole: 'owner', switches: [
    { id: 'new_sign_in', title: 'New or unusual sign-in', note: 'A new device or a new place', alwaysOn: false },
    { id: 'blocking_bug', title: 'Blocking bug report', note: 'Feedback marked "Blocking my work"', alwaysOn: false },
    { id: 'health', title: 'System health problem', note: 'A service is slow or down', alwaysOn: false },
    { id: 'ai_budget', title: 'Homes AI budget', note: 'At 80% and at 100% of the month', alwaysOn: false },
  ] },
];

/** The same six that start off on the real server. */
const NOTIFY_OFF = new Set(['check_in', 'wall', 'wrong_number', 'agent_late', 'working_outside', 'ai_budget']);

function previewNotify() {
  const switches: Record<string, boolean> = {};
  for (const group of NOTIFY_GROUPS) {
    for (const one of group.switches) {
      switches[one.id] = notifyState.switches[one.id] ?? !NOTIFY_OFF.has(one.id);
    }
  }
  return { ...notifyState, switches, groups: NOTIFY_GROUPS };
}

const companyState = {
  legalName: 'Emigeo Homes Real Estate L.L.C',
  tradingName: 'homes.me',
  /* Left blank on purpose: the whole point of the preview panel is showing
     what a missing TRN looks like in the offer footer. */
  trn: '',
  orn: '41234',
  licenceNo: 'CN-4821907',
  licenceExpiry: '2027-03-14',
  address: 'Office 1204, Bay Square 11, Business Bay, Dubai, UAE',
  phone: '+971 4 123 4567',
  whatsapp: '+971 50 123 4567',
  email: 'hello@homes.me',
  website: 'homes.me',
  logoUrl: '',
};

const attendanceState = {
  enabled: false,
  officeIps: [] as string[],
  start: '10:00',
  end: '19:00',
  satStart: '11:00',
  satEnd: '15:00',
  closedDays: [0],
  graceMinutes: 10,
  outsideAllowed: true,
  outsideLocationOnce: true,
  outsideAskBack: true,
  outsideTellOwners: false,
  callNeedsCheckIn: true,
  callAnyway: true,
};

const aiState = {
  capUsd: 100,
  features: { summary: true, bestTime: true, voice: true, brief: true, chat: true } as Record<string, boolean>,
};

const knowledgeState = {
  company: `We are homes.me, a real estate brokerage in Business Bay, Dubai. We sell off-plan projects in Dubai and Abu Dhabi.
Our clients are mostly investors from the GCC, Europe, India and CIS countries. Agents speak English, Arabic, Russian, Hindi, Urdu and Serbian.
Write short and simple English. Say "booking", not other words for it. Never promise a price, a discount or a return.`,
};

/* ── sales offers ───────────────────────────────────────────────────────
 *
 * Deliberately mixed: a draft, two shared (one opened, one not) and an
 * accepted one, because a demo where everything is in the same state never
 * shows what the status column is for.
 */
interface PreviewOfferSheet {
  id: string; slug: string; reference: string;
  contactId: string | null; opportunityId: string | null; leadName: string | null;
  projectId: string | null; projectName: string | null; unitLabel: string | null;
  priceAed: number | null; paymentPlan: string | null; handover: string | null;
  note: string | null; validUntil: string | null;
  agentUserId: string; agentName: string | null;
  status: 'draft' | 'shared' | 'accepted';
  createdAt: string; sharedAt: string | null; acceptedAt: string | null;
  opens: number; lastOpenedAt: string | null;
}

const offerState: PreviewOfferSheet[] = [
  {
    id: 'so-1', slug: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4', reference: 'SO-0148',
    contactId: 'c-1', opportunityId: 'o-1', leadName: 'Ahmed Khan',
    projectId: 'p-1', projectName: 'The Archive', unitLabel: '2BR · 1204',
    priceAed: 2_050_000, paymentPlan: '60 / 40', handover: 'Q4 2027',
    note: 'High floor, canal view. Price from the developer list of 10 Nov.',
    validUntil: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    agentUserId: 'u-layla', agentName: 'Layla Hassan', status: 'shared',
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    sharedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), acceptedAt: null,
    opens: 4, lastOpenedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
  {
    id: 'so-2', slug: 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5', reference: 'SO-0147',
    contactId: 'c-2', opportunityId: 'o-2', leadName: 'Fatima Al Marri',
    projectId: 'p-2', projectName: 'Damac Islands', unitLabel: '3BR townhouse · TH-41',
    priceAed: 4_300_000, paymentPlan: '40 / 60 post-handover', handover: 'Q2 2028',
    note: null,
    validUntil: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    agentUserId: 'u-omar', agentName: 'Omar Haddad', status: 'shared',
    createdAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    sharedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(), acceptedAt: null,
    opens: 0, lastOpenedAt: null,
  },
  {
    id: 'so-3', slug: 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6', reference: 'SO-0146',
    contactId: 'c-3', opportunityId: 'o-3', leadName: 'Sergei Volkov',
    projectId: 'p-1', projectName: 'The Archive', unitLabel: '1BR · 0908',
    priceAed: 1_620_000, paymentPlan: '60 / 40', handover: 'Q4 2027', note: null,
    validUntil: new Date(Date.now() + 9 * 86_400_000).toISOString(),
    agentUserId: 'u-layla', agentName: 'Layla Hassan', status: 'accepted',
    createdAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
    sharedAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
    acceptedAt: new Date(Date.now() - 86_400_000).toISOString(),
    opens: 11, lastOpenedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
  },
  {
    id: 'so-4', slug: 'd4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607', reference: 'SO-0149',
    contactId: 'c-4', opportunityId: 'o-4', leadName: 'Priya Nair',
    projectId: 'p-3', projectName: 'Valia', unitLabel: '2BR · 1702',
    priceAed: 2_780_000, paymentPlan: '60 / 40', handover: 'Q1 2029', note: null,
    validUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    agentUserId: 'u-priya', agentName: 'Priya Nair', status: 'draft',
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    sharedAt: null, acceptedAt: null, opens: 0, lastOpenedAt: null,
  },
];

/* ── import ─────────────────────────────────────────────────────────────
 *
 * A file with every kind of row in it: new people, somebody already in the
 * CRM, and rows that cannot become a lead. A demo file where everything is
 * clean never shows what steps 3 and 6 are for.
 */
const importState = {
  id: 'imp-1',
  filename: 'Nov_batch_C.xlsx',
  status: 'uploaded',
  total_rows: 240,
  processed_rows: 0,
  created_count: 0,
  updated_count: 0,
  skipped_count: 0,
  failed_count: 0,
  headers: ['Full Name', 'Mobile No.', 'Email', 'Project', 'Budget AED', 'Notes', 'Source'],
  mapping: null as Record<string, string | null> | null,
  undo_deadline_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
  startedAt: 0,
};

/* ── the office's rules ─────────────────────────────────────────────────── */
const rulesState = {
  takeBack: { enabled: true, vipMinutes: 30, importHours: 24 },
  rules: {
    warnBeforeBack: true, markGoingCold: true, askWhatHappened: true,
    followupDue: true, meetingSoon: true, howDidItGo: true, flagNoShows: true,
    checkInReminder: true, markLate: false, tellOwnersAbsent: true,
  } as Record<string, boolean>,
};

const RULE_GROUPS = [
  { key: 'leads', title: 'Leads', rules: [
    { key: 'warnBeforeBack', title: 'Warn the agent before a lead goes back', note: '10 minutes before a VIP lead, an hour before an imported one' },
    { key: 'markGoingCold', title: 'Mark leads as “going cold”', note: 'No call, no message and no plan for 7 days' },
    { key: 'askWhatHappened', title: 'Ask “What happened?” after WhatsApp or Telegram', note: 'The agent answers. Open ones show on My Day.' },
  ] },
  { key: 'followups', title: 'Follow-ups and meetings', rules: [
    { key: 'followupDue', title: 'Remind the agent when a follow-up is due', note: 'At the planned time, and again after an hour' },
    { key: 'meetingSoon', title: 'Remind 2 hours before a meeting', note: 'The agent only. The client message is ready; the agent presses send.' },
    { key: 'howDidItGo', title: 'Ask “How did it go?” after each meeting', note: 'Answered before 21:00. Owners see who did not answer.' },
    { key: 'flagNoShows', title: 'Red flag after 2 no-shows', note: 'A cancelled meeting is not a no-show' },
  ] },
  { key: 'attendance', title: 'Attendance', rules: [
    { key: 'checkInReminder', title: 'Remind people to check in', note: 'At the start of the shift, on working days, only if they have not' },
    { key: 'markLate', title: 'Mark somebody late', note: 'After the grace minutes. The agent can write a reason.' },
    { key: 'tellOwnersAbsent', title: 'Tell owners about an absent agent', note: 'An hour into the shift, with no check-in and no leave' },
  ] },
];

function previewRules() {
  return {
    ...rulesState,
    groups: RULE_GROUPS,
    vipChoices: [15, 30, 60, 120],
    importChoices: [4, 24, 48, 72],
  };
}

const ROUTES: Route[] = [
  /* The settings pages' answers live in their own file; see the note there. */
  ...SETTINGS_ROUTES,
  ...DASHBOARD_ROUTES,

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
    const project = query.get('projectName') ?? '';
    const visible = LEADS.filter((lead) => {
      if (owner && lead.owner !== owner) return false;
      if (project && lead.project !== project) return false;
      if (!search) return true;
      return [lead.name, lead.phone, lead.email, lead.project].some((v) => (v ?? '').toLowerCase().includes(search));
    });
    return {
      pipelineKey: 'offplan_sales',
      columns: STAGES.map((stage) => {
        const here = visible.filter((l) => l.stage === stage.key);
        /*
         * A column with two cards in it never shows the five-card limit or
         * the "+N more" link under it, so the demo could not catch either
         * being broken. The leads of the other stages are borrowed to fill
         * this one out, the same way `myLeadRows` cycles them into the lead
         * list — borrowed rather than repeated, because five cards with the
         * same name on them is not a column anybody can read.
         */
        const spare = visible.filter((l) => l.stage !== stage.key);
        const deep = here.length === 0 ? [] : [
          ...here,
          ...spare.slice(0, Math.max(0, 6 - here.length)).map((lead, i) => ({
            ...lead, id: `${lead.id}-${stage.key}-${i}`, stage: stage.key,
          })),
        ];
        const cards = deep.map(card);
        /* The real endpoint counts every lead in the stage and sends only the
           first page of cards, so the total is deliberately the larger. */
        const total = cards.length === 0 ? 0 : cards.length * 3 + stage.position;
        return { stageKey: stage.key, stageName: stage.name, position: stage.position, total, cards };
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
      /*
       * The first one came back to you because the agent ran out of time --
       * the case that actually bites -- and any other is a lead nobody could
       * be given to in the first place.
       */
      returnedAt: index === 0 ? ago(12) : null,
      reason: index === 0 ? 'Came back from Omar Farouk' : 'No agent available',
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
    return { assigned: ids.size, skipped: 0, urgent: (body as { urgent?: boolean }).urgent === true };
  } },
  /*
   * One lead sitting on the signed-in person's clock, so the new-lead card
   * shows in the preview. Accepting it clears the list, as it does for real.
   */
  /*
   * One waiting lead by default, so the preview shows the single card. Add
   * `?pending=12` to the URL to see the batch card instead -- the one an
   * agent gets when a pile is handed over at once.
   */
  { method: 'GET', pattern: /^\/api\/incoming\/pending$/, handler: () => {
    const lead = LEADS[0];
    if (pendingAccepted || !lead) return { items: [], total: 0 };
    const asked = Number(new URLSearchParams(window.location.search).get('pending') ?? '1');
    const total = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 50) : 1;
    return {
      total,
      items: Array.from({ length: total }, (_unused, i) => ({
        id: i === 0 ? 'opp-pending' : `opp-pending-${i}`,
        contactId: lead.contactId, name: lead.name, phone: lead.phone,
        project: lead.project, budgetMaxAed: lead.budgetMax, source: lead.source,
        secondsLeft: 184 - i,
      })),
    };
  } },
  { method: 'POST', pattern: /^\/api\/incoming\/accept-all$/, handler: () => {
    const asked = Number(new URLSearchParams(window.location.search).get('pending') ?? '1');
    pendingAccepted = true;
    return { accepted: Number.isFinite(asked) && asked > 0 ? Math.min(asked, 50) : 1, skipped: 0 };
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
  /*
   * ── v2 home ───────────────────────────────────────────────────────────
   *
   * Built from the same demo leads the rest of the preview uses, so the
   * figures on the home screen agree with the list behind them. Every block
   * of the page has something in it -- a VIP lead with a live clock, a tap
   * waiting for an update, a link somebody opened, a banner -- because a
   * preview where half the blocks are empty is a preview that cannot show
   * whether they work. `?as=agent` for My Day, otherwise the owner's.
   */
  { method: 'GET', pattern: /^\/api\/v2\/home$/, handler: () => {
    const rows = myLeadRows();
    const now = new Date();
    const dubai = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dubai',
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      hour12: false,
    }).format(now);
    const me = currentUser();
    const counts = {
      today: rows.filter((r) => r.next_step_at !== null).length,
      new: rows.filter((r) => r.stage_key === 'new_lead').length,
      hot: rows.filter((r) => r.score_band === 'hot').length,
      overdue: rows.filter((r) => r.next_step_at !== null && new Date(r.next_step_at) < now).length,
      no_next_step: rows.filter((r) => r.next_step_at === null).length,
      vip: 1,
      lost: 2,
      all: rows.length,
    };
    const asLead = (row: (typeof rows)[number]) => ({
      id: row.id,
      name: row.full_name,
      phone: row.phone_e164,
      project: row.project_name,
      stage: row.stage_key,
      score: row.lead_score,
      nextStepAt: row.next_step_at,
      nextStepNote: row.next_step_note,
      lastContactAt: row.last_contact_at,
      isVip: false,
    });
    const banners = [
      {
        id: 'b-1',
        title: 'Cityscape Global · 17–19 Nov',
        body: 'DWTC · stand B12. Everyone is on the stand for one day.',
        linkUrl: null,
      },
      {
        id: 'b-2',
        title: 'Valia launches soon',
        body: 'Emaar · The Oasis · from AED 1.4M · 80 / 20.',
        linkUrl: null,
      },
    ];

    if (me.role !== 'agent') {
      const team = USERS.filter((u) => u.role === 'agent' || u.role === 'manager').map((u, i) => ({
        id: u.id,
        name: u.name,
        photoUrl: photoOf(u.id),
        marked: i % 3 === 0 ? 'office' : i % 3 === 1 ? 'outside' : null,
        openLeads: rows.filter((r) => r.owner_name === u.name).length || 3 + i,
        callsToday: [11, 7, 4, 0, 9][i % 5] as number,
        lastSeenAt: new Date(now.getTime() - (i + 1) * 23 * 60_000).toISOString(),
      }));
      return {
        role: 'owner',
        me: { name: me.name, firstName: me.name.split(' ')[0] },
        now: dubai,
        needsYou: [
          { kind: 'vip_late', n: 1, text: 'VIP lead not called in time', action: 'Give again', to: '/v2/incoming' },
          { kind: 'waiting', n: 3, text: 'leads waiting to be given out', action: 'Give', to: '/v2/incoming' },
          { kind: 'transfer', n: 1, text: 'lead transfers need your approval', action: 'Approve', to: '/v2/transfers' },
          { kind: 'leave', n: 2, text: 'leave requests to answer', action: 'Answer', to: '/v2/attendance' },
        ],
        teamToday: {
          inOffice: team.filter((t) => t.marked === 'office').length,
          late: 1,
          outside: team.filter((t) => t.marked === 'outside').length,
          absent: team.filter((t) => t.marked === null).length,
          closed: false,
        },
        todayNumbers: {
          newLeads: counts.new, calls: 31, whatsapp: 18, telegram: 2,
          meetings: 3, unitsBooked: 1, overdue: counts.overdue, noNextStep: counts.no_next_step,
        },
        teamRightNow: team,
        freeLeads: 3,
        banners,
        unread: 2,
      };
    }

    return {
      role: 'agent',
      me: { name: me.name, firstName: me.name.split(' ')[0] },
      now: dubai,
      attendance: {
        closed: false, marked: 'office', markedAt: new Date(now.getTime() - 5 * 3_600_000).toISOString(),
        wasLate: false, note: null, onOfficeNetwork: true, enabled: true, startsAt: '09:00',
      },
      counts,
      freeLeads: 3,
      today: { calls: 18, answered: 11, messages: 9, meetings: 1, newLeads: 3 },
      goals: { calls: 40, messages: 20, meetings: 2 },
      streakDays: 12,
      kudosThisMonth: 4,
      byStage: [
        { stage: 'new_lead', n: counts.new },
        { stage: 'attempted_contact', n: 16 },
        { stage: 'engaged_qualified', n: 14 },
        { stage: 'appointment_scheduled', n: 8 },
        { stage: 'deal_sent', n: 6 },
        { stage: 'won', n: 2 },
      ],
      nextUp: asLead(rows[0]!),
      callNow: rows.slice(0, 8).map(asLead),
      vip: {
        id: 'vip-1',
        leadId: rows[1]!.id,
        name: rows[1]!.full_name,
        phone: rows[1]!.phone_e164,
        project: rows[1]!.project_name,
        givenBy: 'Emir',
        note: 'Wrote to me by email. Serious, wants to see the show flat this week. Call him in English.',
        deadlineAt: new Date(now.getTime() + 24 * 60_000 + 12_000).toISOString(),
        accepted: false,
      },
      waitingUpdate: [
        {
          id: 'tap-1', app: 'whatsapp', name: rows[2]!.full_name, leadId: rows[2]!.id,
          tappedAt: new Date(now.getTime() - 24 * 60_000).toISOString(),
        },
        {
          id: 'tap-2', app: 'telegram', name: rows[3]!.full_name, leadId: rows[3]!.id,
          tappedAt: new Date(now.getTime() - 105 * 60_000).toISOString(),
        },
      ],
      linkOpens: [{
        name: rows[4]!.full_name, leadId: rows[4]!.id, label: 'Brochure', kind: 'brochure',
        openedAt: new Date(now.getTime() - 18 * 60_000).toISOString(), opens: 2,
      }],
      transfersForMe: 1,
      tasksOverdue: counts.overdue,
      unread: 2,
      banners,
    };
  } },
  /* The project library, in the shape `listLibrary` returns. */
  { method: 'GET', pattern: /^\/api\/library$/, handler: ({ query }) => {
    const search = (query.get('search') ?? '').toLowerCase();
    const emirate = query.get('emirate');
    const status = query.get('status');
    const starred = query.get('starred');
    const items = PROJECTS.map((project, i) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      developer: project.developer,
      developer_id: null,
      /* The enum the column stores, not the words a screen prints: the
         filter chips send `emirate=dubai` and matched nothing while this
         answered "Dubai". */
      emirate: project.emirate,
      community: project.area,
      property_type: 'Apartment',
      sale_status: (['selling_now', 'selling_now', 'coming_soon', 'sold_out'][i % 4]) as string,
      starting_price_aed: project.starting_price_aed,
      handover_date: project.handover_date ? '2027-12-01' : null,
      payment_plan: project.payment_plan,
      image_url: null,
      cover_photo_id: null,
      visibility: 'private',
      starred: i === 0 ? 1 : 0,
      verified_at: project.verified_at,
      archived_at: null,
      units_available: [24, 8, 0, 0][i % 4] as number,
      units_total: [120, 40, 60, 0][i % 4] as number,
    })).filter((one) => {
      if (emirate && one.emirate !== emirate) return false;
      if (status && one.sale_status !== status) return false;
      if (starred === '1' && one.starred !== 1) return false;
      if (search && ![one.name, one.developer, one.community]
        .filter(Boolean).join(' ').toLowerCase().includes(search)) return false;
      return true;
    });
    return { items };
  } },

  /* The team directory, with the numbers only an owner is sent. */
  { method: 'GET', pattern: /^\/api\/v2\/team$/, handler: () => {
    const isOwner = currentUser().role !== 'agent';
    return {
      canSeeNumbers: isOwner,
      items: USERS.filter((u) => u.role !== 'automation').map((u, i) => ({
        id: u.id,
        name: u.name,
        email: isOwner ? u.email : null,
        role: u.role,
        photoUrl: photoOf(u.id),
        title: u.role === 'owner' ? 'Founder' : u.role === 'manager' ? 'Sales manager' : 'Property consultant',
        headline: i % 2 === 0 ? 'Off-plan, Dubai Marina and JVC' : 'Abu Dhabi waterfront',
        languages: i % 3 === 0 ? ['English', 'Arabic'] : i % 3 === 1 ? ['English', 'Russian'] : ['English', 'Hindi'],
        specialities: ['Emaar', 'Damac'],
        phone: '+971500000000',
        whatsapp: '+971500000000',
        markedToday: i % 3 === 0 ? 'office' : i % 3 === 1 ? 'outside' : null,
        onLeave: i === 4,
        openLeads: isOwner ? [14, 9, 22, 6, 11][i % 5] : null,
      })),
    };
  } },

  /* Transfers, in the four lists the real endpoint returns. */
  { method: 'GET', pattern: /^\/api\/v2\/transfers$/, handler: () => {
    const mine = currentUser();
    const make = (i: number, over: Record<string, unknown>) => ({
      id: `tr-${i}`,
      opportunityId: LEADS[i % LEADS.length]!.id,
      leadName: LEADS[i % LEADS.length]!.name,
      project: LEADS[i % LEADS.length]!.project,
      stage: ['new_lead', 'engaged_qualified', 'appointment_scheduled'][i % 3],
      fromUserId: USERS[1]!.id,
      fromName: USERS[1]!.name,
      toUserId: mine.id,
      toName: mine.name,
      reason: ['language', 'leave', 'too_many'][i % 3],
      note: i % 3 === 0 ? 'He asked for a Russian speaker' : null,
      status: 'pending',
      requestedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
      expiresAt: new Date(new Date().setHours(18, 0, 0, 0)).toISOString(),
      ...over,
    });
    return {
      forMe: [make(0, {})],
      iSent: [make(1, { fromUserId: mine.id, fromName: mine.name, toUserId: USERS[2]!.id, toName: USERS[2]!.name })],
      toApprove: mine.role === 'agent' ? [] : [make(2, { status: 'needs_approval' })],
      recent: mine.role === 'agent' ? [] : [make(3, { status: 'accepted' }), make(4, { status: 'refused' })],
    };
  } },
  { method: 'GET', pattern: /^\/api\/v2\/transfers\/who$/, handler: () => ({
    items: USERS.filter((u) => u.role === 'agent' || u.role === 'manager').map((u, i) => ({
      id: u.id,
      name: u.name,
      photoUrl: photoOf(u.id),
      openLeads: [4, 9, 14, 22][i % 4] as number,
      language: i % 2 === 0 ? 'en' : 'ar',
      markedToday: i % 3 === 0 ? 'office' : i % 3 === 1 ? 'outside' : null,
      onLeave: i === 3,
    })),
  }) },
  { method: 'POST', pattern: /^\/api\/v2\/transfers$/, handler: ({ body }) => ({
    id: `tr-${Date.now()}`, status: 'pending', toName: 'Omar Farouk',
    ...(body as Record<string, unknown>),
  }) },
  { method: 'POST', pattern: /^\/api\/v2\/transfers\/([^/]+)\/(answer|approve|cancel)$/, handler: () => ({ ok: true }) },

  /* The calendar window: tasks and meetings together, as one answer. */
  { method: 'GET', pattern: /^\/api\/v2\/calendar$/, handler: ({ query }) => {
    const from = new Date(query.get('from') ?? Date.now());
    const to = new Date(query.get('to') ?? Date.now());
    const tasks = TASKS.slice(0, 8).map((task, i) => ({
      id: `ct-${i}`,
      type: task.type ?? 'call',
      title: task.title,
      due_at: new Date(Date.now() + (i - 3) * 86_400_000 + 9 * 3_600_000).toISOString(),
      completed_at: i % 4 === 0 ? new Date().toISOString() : null,
      opportunity_id: LEADS[i % LEADS.length]!.id,
      full_name: LEADS[i % LEADS.length]!.name,
    })).filter((t) => new Date(t.due_at) >= from && new Date(t.due_at) < to);

    const meetings = [0, 2, 5, 9].map((offset, i) => {
      const starts = new Date(Date.now() + (offset - 2) * 86_400_000);
      starts.setHours(16, 0, 0, 0);
      return {
        id: `mt-${i}`,
        opportunityId: LEADS[i % LEADS.length]!.id,
        kind: i % 2 === 0 ? 'site_visit' : 'meeting',
        title: i % 2 === 0 ? 'Site visit' : 'Meeting at the office',
        startsAt: starts.toISOString(),
        endsAt: new Date(starts.getTime() + 3_600_000).toISOString(),
        allDay: false,
        place: i % 2 === 0 ? 'Emaar Beachfront sales centre' : 'Office',
        result: offset < 2 ? 'showed' : null,
        interest: null,
        who: LEADS[i % LEADS.length]!.name,
        phone: LEADS[i % LEADS.length]!.phone,
        agent: USERS[1]?.name ?? 'Rocky',
      };
    }).filter((m) => new Date(m.startsAt) >= from && new Date(m.startsAt) < to);

    return { from: from.toISOString(), to: to.toISOString(), tasks, meetings };
  } },
  { method: 'POST', pattern: /^\/api\/v2\/meetings$/, handler: () => ({ id: `mt-${Date.now()}` }) },
  { method: 'PATCH', pattern: /^\/api\/v2\/meetings\/([^/]+)\/result$/, handler: () => ({ saved: true }) },

  /* Attendance: my own sixty days, and the team grid for an owner. */
  { method: 'GET', pattern: /^\/api\/v2\/attendance\/me$/, handler: () => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const days: Array<{ on_date: string; kind: string; was_late: number; note: string | null }> = [];
    for (let back = 1; back < 60; back += 1) {
      const at = new Date(today.getTime() - back * 86_400_000);
      if (at.getUTCDay() === 0) continue;
      if (back % 11 === 0) continue;
      days.push({
        on_date: iso(at),
        kind: back % 7 === 3 ? 'outside' : 'office',
        was_late: back % 9 === 4 ? 1 : 0,
        note: back % 7 === 3 ? 'Emaar sales centre' : null,
      });
    }
    return {
      today: {
        closed: false, marked: null, markedAt: null, wasLate: false, note: null,
        onOfficeNetwork: true, enabled: true, startsAt: '09:00',
      },
      from: iso(new Date(today.getTime() - 59 * 86_400_000)),
      to: iso(today),
      days,
      taken: { annual: 6, sick: 2 },
      leave: [
        {
          id: 'lv-1', userId: 'u-1', kind: 'annual',
          fromDate: iso(new Date(today.getTime() + 20 * 86_400_000)),
          toDate: iso(new Date(today.getTime() + 24 * 86_400_000)),
          workingDays: 4, reason: 'Family wedding', status: 'pending', decisionNote: null,
        },
        {
          id: 'lv-2', userId: 'u-1', kind: 'sick',
          fromDate: iso(new Date(today.getTime() - 30 * 86_400_000)),
          toDate: iso(new Date(today.getTime() - 30 * 86_400_000)),
          workingDays: 1, reason: null, status: 'approved', decisionNote: 'Get well.',
        },
      ],
    };
  } },
  { method: 'GET', pattern: /^\/api\/v2\/attendance\/team$/, handler: () => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const dates = Array.from({ length: 14 }, (_u, i) => {
      const at = new Date(today.getTime() - (13 - i) * 86_400_000);
      return { date: iso(at), closed: at.getUTCDay() === 0 };
    });
    const people = USERS.filter((u) => u.role === 'agent' || u.role === 'manager').map((u, n) => ({
      userId: u.id,
      name: u.name,
      role: u.role,
      photoUrl: photoOf(u.id),
      days: dates.map((d, i) => ({
        date: d.date,
        kind: d.closed || (i + n) % 9 === 0 ? null : (i + n) % 5 === 0 ? 'outside' : 'office',
        at: null,
        late: (i + n) % 7 === 2,
        note: null,
      })),
      inOffice: 9, outside: 2, late: 1, absent: 1,
    }));
    return {
      from: dates[0]!.date, to: dates[dates.length - 1]!.date, dates, people,
      leave: [{
        id: 'lv-9', userId: people[0]?.userId ?? 'u-2', userName: people[0]?.name ?? 'Rocky',
        kind: 'annual',
        fromDate: iso(new Date(today.getTime() + 10 * 86_400_000)),
        toDate: iso(new Date(today.getTime() + 12 * 86_400_000)),
        workingDays: 3, reason: 'Trip home', status: 'pending', decisionNote: null,
      }],
    };
  } },
  { method: 'POST', pattern: /^\/api\/v2\/leave$/, handler: ({ body }) => ({
    id: `lv-${Date.now()}`, ...(body as Record<string, unknown>), workingDays: 2, status: 'pending',
  }) },
  { method: 'PATCH', pattern: /^\/api\/v2\/leave\/([^/]+)$/, handler: ({ body }) => ({
    ...(body as Record<string, unknown>), id: 'lv-9',
  }) },
  { method: 'POST', pattern: /^\/api\/v2\/leave\/([^/]+)\/cancel$/, handler: () => ({ cancelled: true }) },

  /* The numbers on the menu, in one answer, as the real endpoint gives them. */
  /* ── the office's rules ───────────────────────────────────────────────── */
  { method: 'GET', pattern: /^\/api\/v2\/rules$/, handler: () => previewRules() },
  { method: 'PATCH', pattern: /^\/api\/v2\/rules$/, handler: ({ body }) => {
    const patch = (body ?? {}) as { takeBack?: Record<string, unknown>; rules?: Record<string, boolean> };
    if (patch.takeBack) Object.assign(rulesState.takeBack, patch.takeBack);
    if (patch.rules) Object.assign(rulesState.rules, patch.rules);
    return previewRules();
  } },
  { method: 'GET', pattern: /^\/api\/v2\/rules\/taken-back$/, handler: () => ({
    items: rulesState.takeBack.enabled ? [
      {
        id: 'o-1', name: 'Omar Khan', project: 'Shahrukhz', isVip: true,
        returnedAt: new Date(Date.now() - 70 * 60_000).toISOString(), agentName: 'Bassam',
      },
      {
        id: 'o-2', name: 'Lina Rahimi', project: 'Damac Islands', isVip: false,
        returnedAt: new Date(Date.now() - 112 * 60_000).toISOString(), agentName: 'Shan',
      },
    ] : [],
  }) },

  /* ── import ───────────────────────────────────────────────────────────── */
  { method: 'POST', pattern: /^\/api\/imports$/, handler: () => {
    Object.assign(importState, {
      status: 'uploaded', processed_rows: 0, created_count: 0,
      updated_count: 0, skipped_count: 0, failed_count: 0, startedAt: 0,
    });
    return {
      id: importState.id,
      filename: importState.filename,
      kind: 'xlsx',
      bytes: 49_152,
      headers: importState.headers,
      preview: [
        ['Sara Ahmed', '0501234567', 'sara@example.com', 'The Archive', 'AED 1.5M - 2.5M', 'Called once', 'Portal'],
        ['Omar Haddad', '0559876543', 'omar@example.com', 'Damac Islands', 'AED 2M - 3M', '', 'Referral'],
      ],
      suggestedMapping: {
        'Full Name': 'fullName',
        'Mobile No.': 'phone',
        Email: 'email',
        Project: 'projectName',
        'Budget AED': 'budgetBand',
        Notes: 'notes',
        Source: 'source',
      },
    };
  } },

  { method: 'PATCH', pattern: /^\/api\/imports\/([^/]+)$/, handler: ({ body }) => {
    const patch = (body ?? {}) as { mapping?: Record<string, string | null> };
    if (patch.mapping) importState.mapping = patch.mapping;
    return { ok: true };
  } },

  { method: 'POST', pattern: /^\/api\/imports\/([^/]+)\/validate$/, handler: () => ({
    total: importState.total_rows,
  }) },

  { method: 'POST', pattern: /^\/api\/imports\/([^/]+)\/preflight$/, handler: () => ({
    total: 240,
    fresh: 208,
    duplicates: 18,
    invalid: 14,
    contactsInCrm: 863,
    duplicateRows: [
      { line: 12, name: 'Marco Bellini', phone: '+39 333 455 4821', detail: 'with Rocky' },
      { line: 31, name: 'Lina Rahimi', phone: '+971 55 555 0142', detail: 'in Incoming' },
      { line: 77, name: 'Dave Patel', phone: '+44 7700 900 456', detail: 'with Rocky' },
    ],
    invalidRows: [
      { line: 17, name: 'Hamad R.', phone: null, detail: 'No phone number and no email address' },
      { line: 52, name: 'Julia Stein', phone: '0550', detail: 'Phone number is too short' },
      { line: 118, name: null, phone: null, detail: 'No phone number and no email address' },
    ],
    invalidReasons: [
      { reason: 'No phone number and no email address', n: 9 },
      { reason: 'Phone number is too short', n: 4 },
      { reason: 'Not a name', n: 1 },
    ],
  }) },

  { method: 'POST', pattern: /^\/api\/imports\/([^/]+)\/start$/, handler: () => {
    importState.status = 'importing';
    importState.startedAt = Date.now();
    return { ok: true };
  } },

  { method: 'GET', pattern: /^\/api\/imports\/([^/]+)$/, handler: () => {
    /* Counts up over about four seconds, so the progress bar on step 6 is a
       real one rather than a picture of one. */
    if (importState.status === 'importing') {
      const share = Math.min(1, (Date.now() - importState.startedAt) / 4000);
      importState.processed_rows = Math.round(240 * share);
      importState.created_count = Math.round(208 * share);
      importState.skipped_count = Math.round(32 * share);
      if (share >= 1) importState.status = 'completed';
    }
    return { import: { ...importState }, problems: [], undoWindowHours: 24 };
  } },

  { method: 'POST', pattern: /^\/api\/imports\/([^/]+)\/undo$/, handler: () => {
    importState.status = 'undone';
    return { undone: importState.created_count };
  } },

  { method: 'GET', pattern: /^\/api\/teams\/candidates$/, handler: () => ({
    items: USERS.filter((one) => one.role === 'agent').map((one, index) => ({
      userId: one.id,
      name: one.name,
      languages: ['english'],
      projectsCovered: [],
      openLeads: [22, 14, 18, 12, 16][index % 5] ?? 10,
      isEligible: true,
    })),
  }) },

  { method: 'GET', pattern: /^\/api\/teams$/, handler: () => ({
    items: [
      { id: 't-1', name: 'Dubai off-plan', description: null, manager_name: 'Yousef' },
      { id: 't-2', name: 'Arabic desk', description: null, manager_name: 'Yousef' },
      { id: 't-3', name: 'Abu Dhabi', description: null, manager_name: null },
    ],
  }) },

  /* ── sales offers ─────────────────────────────────────────────────────── */
  { method: 'GET', pattern: /^\/api\/v2\/offers$/, handler: ({ query }) => {
    const me = currentUser();
    const mine = me.role === 'agent'
      ? offerState.filter((one) => one.agentUserId === me.id)
      : offerState;

    const tab = query.get('tab') ?? 'all';
    const needle = (query.get('q') ?? '').toLowerCase();
    const project = query.get('project') ?? '';
    const agent = query.get('agent') ?? '';

    const filtered = mine.filter((one) => {
      if (project && one.projectId !== project) return false;
      if (agent && one.agentUserId !== agent) return false;
      if (needle && ![one.leadName, one.unitLabel, one.projectName, one.reference]
        .some((text) => (text ?? '').toLowerCase().includes(needle))) return false;
      return true;
    });

    const counts = {
      all: filtered.length,
      draft: filtered.filter((one) => one.status === 'draft').length,
      shared: filtered.filter((one) => one.status === 'shared').length,
      accepted: filtered.filter((one) => one.status === 'accepted').length,
    };
    const items = tab === 'all' ? filtered : filtered.filter((one) => one.status === tab);

    return {
      items,
      counts,
      stats: {
        thisMonth: mine.length,
        valueAed: mine.reduce((sum, one) => sum + (one.priceAed ?? 0), 0),
        accepted: mine.filter((one) => one.status === 'accepted').length,
        waiting: mine.filter((one) => one.status === 'shared').length,
      },
    };
  } },

  { method: 'GET', pattern: /^\/api\/v2\/offers-form$/, handler: () => ({
    leads: myLeadRows().slice(0, 12).map((row) => ({
      id: row.id, name: row.full_name, project: row.project_name, projectId: 'p-1',
    })),
    projects: [
      { id: 'p-1', name: 'The Archive', priceFrom: 1_600_000 },
      { id: 'p-2', name: 'Damac Islands', priceFrom: 2_400_000 },
      { id: 'p-3', name: 'Valia', priceFrom: 2_100_000 },
      { id: 'p-4', name: 'Shahrukhz', priceFrom: 980_000 },
    ],
  }) },

  { method: 'POST', pattern: /^\/api\/v2\/offers$/, handler: ({ body }) => {
    const input = (body ?? {}) as Record<string, unknown>;
    const me = currentUser();
    const lead = myLeadRows().find((row) => row.id === input.opportunityId);
    const made = {
      id: `so-${Date.now()}`,
      slug: `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.padEnd(40, '0'),
      reference: `SO-0${150 + offerState.length}`,
      contactId: lead?.contact_id ?? null,
      opportunityId: String(input.opportunityId ?? ''),
      leadName: lead?.full_name ?? 'New client',
      projectId: (input.projectId as string) ?? 'p-1',
      projectName: lead?.project_name ?? 'The Archive',
      unitLabel: String(input.unitLabel ?? ''),
      priceAed: Number(input.priceAed ?? 0),
      paymentPlan: (input.paymentPlan as string) ?? null,
      handover: 'Q4 2027',
      note: (input.note as string) ?? null,
      validUntil: `${String(input.validUntil ?? '')}T23:59:59.000Z`,
      agentUserId: me.id, agentName: me.name, status: 'draft' as const,
      createdAt: new Date().toISOString(), sharedAt: null, acceptedAt: null,
      opens: 0, lastOpenedAt: null,
    };
    offerState.unshift(made);
    return made;
  } },

  { method: 'POST', pattern: /^\/api\/v2\/offers\/([^/]+)\/(shared|accepted)$/, handler: ({ params }) => {
    const one = offerState.find((row) => row.id === params[0]);
    if (!one) return { ok: false };
    if (params[1] === 'shared') {
      one.status = 'shared';
      one.sharedAt = new Date().toISOString();
    } else {
      one.status = 'accepted';
      one.acceptedAt = new Date().toISOString();
    }
    return one;
  } },

  { method: 'DELETE', pattern: /^\/api\/v2\/offers\/([^/]+)$/, handler: ({ params }) => {
    const at = offerState.findIndex((row) => row.id === params[0]);
    if (at >= 0) offerState.splice(at, 1);
    return { deleted: true };
  } },

  /*
   * ── v2 settings ────────────────────────────────────────────────────────
   *
   * The shapes the Settings panels read. Deliberately not all tidy: the
   * company has a missing TRN and the office has no address saved, because
   * those are the states the screens were built to make obvious and a demo
   * where everything is filled in never shows them.
   */
  { method: 'GET', pattern: /^\/api\/v2\/notify$/, handler: () => previewNotify() },
  { method: 'PUT', pattern: /^\/api\/v2\/notify$/, handler: ({ body }) => {
    const patch = (body ?? {}) as Record<string, unknown>;
    if (patch.switches) {
      for (const [key, on] of Object.entries(patch.switches as Record<string, boolean>)) {
        /* The real server refuses to switch a VIP alert off. */
        notifyState.switches[key] = key === 'vip_lead' || key === 'vip_late' ? true : on;
      }
    }
    for (const key of ['computer', 'sounds', 'volume', 'soundNewLead', 'soundWon', 'vipIgnoresQuiet', 'quiet']) {
      if (patch[key] !== undefined) (notifyState as Record<string, unknown>)[key] = patch[key];
    }
    return previewNotify();
  } },

  { method: 'GET', pattern: /^\/api\/v2\/settings-summary$/, handler: () => ({
    people: 13,
    notifyOn: 9,
    attendance: { enabled: false, start: '10:00', end: '19:00', graceMinutes: 10 },
    automations: { on: AUTOMATIONS.filter((a) => a.isActive).length, total: AUTOMATIONS.length },
    company: { missing: 1 },
    ai: { spentUsd: '38.40', capUsd: '100.00' },
    health: { ok: 4, total: 5 },
  }) },

  { method: 'GET', pattern: /^\/api\/company$/, handler: () => ({
    company: { ...companyState },
    issues: companyState.trn.trim()
      ? []
      : ['No TRN. Every sales offer footer and every invoice needs it.'],
    messaging: {
      quietFrom: 22, quietTo: 8, maxPer24h: 3, botPauseHours: 24,
      describes: 'No automated messages 22:00–08:00 Dubai time', customised: false,
    },
  }) },
  { method: 'PUT', pattern: /^\/api\/company$/, handler: ({ body }) => {
    Object.assign(companyState, (body ?? {}) as Record<string, string>);
    return { company: { ...companyState }, issues: [] };
  } },

  { method: 'GET', pattern: /^\/api\/attendance\/settings$/, handler: () => ({
    ...attendanceState,
    /* The documentation range, never a real office address. */
    yourIp: '203.0.113.17',
  }) },
  { method: 'PUT', pattern: /^\/api\/attendance\/settings$/, handler: ({ body }) => {
    Object.assign(attendanceState, (body ?? {}) as Record<string, unknown>);
    return { ...attendanceState, yourIp: '203.0.113.17' };
  } },

  { method: 'GET', pattern: /^\/api\/ai\/usage$/, handler: () => ({
    spentUsd: '38.40',
    capUsd: String(aiState.capUsd.toFixed(2)),
    calls: 1284,
    spentMicros: 38_400_000,
    capMicros: aiState.capUsd * 1_000_000,
    byFeature: [
      { feature: 'summary', micros: 14_100_000, calls: 612, usd: '14.10' },
      { feature: 'voice', micros: 9_200_000, calls: 143, usd: '9.20' },
      { feature: 'ask', micros: 8_300_000, calls: 388, usd: '8.30' },
      { feature: 'brief', micros: 4_100_000, calls: 11, usd: '4.10' },
      { feature: 'best-time', micros: 2_700_000, calls: 130, usd: '2.70' },
    ],
    features: { ...aiState.features },
    featureList: [
      { key: 'summary', name: 'AI_CAN_SUMMARY', title: 'Write "In short" on each lead', note: '3 lines from the notes and timeline, new after each change' },
      { key: 'bestTime', name: 'AI_CAN_BEST_TIME', title: 'Suggest the best time to call', note: "From the client's country, local time and past answers" },
      { key: 'voice', name: 'AI_CAN_VOICE', title: 'Turn voice notes into text', note: 'And find fields like budget and unit: "Save 4 to lead"' },
      { key: 'brief', name: 'AI_CAN_BRIEF', title: 'Write the morning brief for owners', note: 'One short text on the dashboard at 08:30' },
      { key: 'chat', name: 'AI_CAN_CHAT', title: 'Answer questions in Homes AI chat', note: 'Agents ask about their own leads. Owners ask about the team.' },
    ],
  }) },
  { method: 'PUT', pattern: /^\/api\/ai\/limits$/, handler: ({ body }) => {
    const patch = (body ?? {}) as { capUsd?: number; features?: Record<string, boolean> };
    if (patch.capUsd !== undefined) aiState.capUsd = patch.capUsd;
    if (patch.features) Object.assign(aiState.features, patch.features);
    return { capUsd: String(aiState.capUsd.toFixed(2)), features: { ...aiState.features } };
  } },

  { method: 'GET', pattern: /^\/api\/ai\/knowledge$/, handler: () => ({
    sections: [
      {
        section: 'company',
        title: 'About us',
        language: 'en',
        content: knowledgeState.company,
      },
    ],
  }) },
  { method: 'PUT', pattern: /^\/api\/ai\/knowledge\/([^/]+)$/, handler: ({ body }) => {
    knowledgeState.company = ((body ?? {}) as { content?: string }).content ?? '';
    return { saved: true };
  } },

  { method: 'GET', pattern: /^\/api\/integrations\/setup-checklist$/, handler: () => ({
    outstanding: 1,
    items: [
      { key: 'email', title: 'Email', consequence: 'Client emails will not send.', ready: true, to: '/settings/integrations' },
      { key: 'whatsapp', title: 'WhatsApp', consequence: 'Follow-ups outside 24 hours will not send.', ready: true, to: '/settings/integrations' },
      { key: 'push', title: 'Phone alerts', consequence: 'The five-minute rule only works with the CRM open.', ready: true, to: '/settings/integrations' },
      { key: 'ai', title: 'Homes AI', consequence: 'Every AI answer fails with a key error.', ready: true, to: '/settings/ai' },
      { key: 'attendance', title: 'Office check-in', consequence: 'Nobody is asked to check in.', ready: false, to: '/v2/settings/attendance' },
    ],
  }) },

  { method: 'GET', pattern: /^\/api\/v2\/badges$/, handler: () => {
    const rows = myLeadRows();
    const now = Date.now();
    return {
      incoming: 6,
      followups: rows.filter((r) => r.next_step_at !== null && new Date(r.next_step_at).getTime() < now).length,
      transfers: 1,
      tasks: 3,
      leave: currentUser().role === 'agent' ? 0 : 2,
    };
  } },

  /* Incoming, role-shaped exactly as the real endpoint shapes it. */
  { method: 'GET', pattern: /^\/api\/v2\/incoming$/, handler: () => {
    const rows = myLeadRows().slice(0, 6);
    const free = rows.map((row, i) => ({
      id: `free-${i}`,
      contactId: row.contact_id,
      name: row.full_name,
      phone: row.phone_e164,
      language: i % 2 === 0 ? 'English' : 'Arabic',
      project: row.project_name,
      budgetMaxAed: row.budget_max_aed,
      source: row.source,
      score: row.lead_score,
      isVip: i === 1,
      waitingMinutes: [12, 48, 190, 1500, 23, 4][i] as number,
      returnedAt: i === 2 ? new Date(Date.now() - 3 * 3_600_000).toISOString() : null,
      bounceCount: i === 2 ? 1 : 0,
      reason: i === 4 ? 'no_agent_available' : null,
    }));
    if (currentUser().role === 'agent') return { role: 'agent', free };
    return {
      role: 'owner',
      free,
      cameBack: free.slice(2, 3),
      agents: USERS.filter((u) => u.role === 'agent' || u.role === 'manager').map((u, i) => ({
        id: u.id,
        name: u.name,
        photoUrl: photoOf(u.id),
        openLeads: [14, 9, 22, 6, 11][i % 5] as number,
        availability: 'available',
        markedToday: i % 3 === 0 ? 'office' : i % 3 === 1 ? 'outside' : null,
      })),
    };
  } },
  { method: 'POST', pattern: /^\/api\/v2\/incoming\/([^/]+)\/take$/, handler: () => ({ taken: true }) },
  { method: 'POST', pattern: /^\/api\/v2\/incoming\/share$/, handler: ({ body }) => {
    const ids = (body as { opportunityIds?: string[] }).opportunityIds ?? [];
    const agents = (body as { agentUserIds?: string[] }).agentUserIds ?? [];
    return {
      given: Math.max(0, ids.length - 1),
      vipSkipped: 1,
      perAgent: agents.map((id, i) => ({ agentUserId: id, n: Math.floor((ids.length - 1) / agents.length) + (i === 0 ? (ids.length - 1) % agents.length : 0) })),
    };
  } },

  /* The call queue: the Today rows, VIP first, as the real endpoint sorts them. */
  { method: 'GET', pattern: /^\/api\/v2\/queue$/, handler: () => {
    const rows = myLeadRows().filter((r) => r.next_step_at !== null).slice(0, 12);
    return {
      items: rows.map((row, i) => ({
        id: row.id,
        contactId: row.contact_id,
        name: row.full_name,
        phone: row.phone_e164,
        project: row.project_name,
        unitType: '2 Bedroom',
        budgetMinAed: 1_000_000,
        budgetMaxAed: row.budget_max_aed,
        language: i % 3 === 0 ? 'Arabic, English' : 'English',
        stage: row.stage_key,
        score: row.lead_score,
        scoreReason: row.score_reason,
        isVip: i === 0,
        nextStepAt: row.next_step_at,
        nextStepNote: row.next_step_note,
        lastContactAt: row.last_contact_at,
        noAnswerCount: row.no_answer_count,
        calledToday: false,
      })),
    };
  } },
  { method: 'POST', pattern: /^\/api\/v2\/calls$/, handler: () => ({ id: `call-${Date.now()}` }) },
  { method: 'PATCH', pattern: /^\/api\/v2\/calls\/([^/]+)$/, handler: ({ body }) => ({
    stageKey: 'attempted_contact',
    status: 'open',
    nextStepAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    said: `Saved: ${String((body as { outcome?: string }).outcome ?? '').replace(/_/g, ' ')}`,
  }) },
  { method: 'POST', pattern: /^\/api\/v2\/taps$/, handler: () => ({ id: `tap-${Date.now()}` }) },
  { method: 'PATCH', pattern: /^\/api\/v2\/taps\/([^/]+)$/, handler: () => ({ moved: true }) },
  { method: 'POST', pattern: /^\/api\/v2\/vip\/([^/]+)\/accept$/, handler: () => ({ acceptedAt: new Date().toISOString() }) },
  { method: 'POST', pattern: /^\/api\/v2\/vip\/([^/]+)\/refuse$/, handler: () => ({ refusedAt: new Date().toISOString() }) },

  { method: 'GET', pattern: /^\/api\/my-leads$/, handler: ({ query }) => {
    const tab = query.get('tab') ?? 'today';
    /* The real endpoint narrows by project name, which is how a project page
       asks for the leads that belong to it. */
    const project = query.get('project');
    const matching = myLeadRows().filter((row) => {
      if (project && row.project_name !== project) return false;
      if (tab === 'new') return row.stage_key === 'new_lead';
      if (tab === 'hot') return row.score_band === 'hot';
      if (tab === 'no_next_step') return row.next_step_at === null;
      if (tab === 'overdue') return row.last_contact_at === null;
      if (tab === 'all') return true;
      return row.next_step_at !== null;
    });
    /* Paged like the real endpoint, so "Show more" is exercised here. */
    const page = Math.max(1, Number(query.get('page') ?? '1'));
    const pageSize = Math.min(50, Math.max(1, Number(query.get('pageSize') ?? '30')));
    const items = matching.slice((page - 1) * pageSize, page * pageSize);
    return {
      tab, items, total: matching.length, page, pageSize,
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
  { method: 'POST', pattern: /^\/api\/my-leads\/([^/]+)\/action$/, handler: ({ body }) => {
    const action = (body as { action?: string }).action ?? 'call';
    const stage = action === 'won' ? 'won'
      : action === 'lost' ? 'lost'
        : action === 'meeting' ? 'appointment_scheduled'
          : action === 'call_back' ? 'attempted_contact' : 'engaged_qualified';
    const said = action === 'won' ? 'Marked Won. Congratulations.'
      : action === 'lost' ? 'Closed, with the reason you gave.'
        : action === 'meeting' ? 'Meeting booked and in your calendar.'
          : 'Follow-up set.';
    return {
      stageKey: stage,
      status: action === 'won' ? 'won' : action === 'lost' ? 'lost' : 'open',
      nextStepAt: (body as { nextStep?: { at?: string } }).nextStep?.at ?? null,
      needsNextStep: false,
      said,
    };
  } },
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
      { userId: USERS[1]!.id, name: USERS[1]!.name, role: 'agent', availability: 'available',
        device: 'iPhone \u00b7 Safari', where: 'Dubai, United Arab Emirates', doing: '/leads',
        live: true, lastSeen: 'Just now', lastSeenAt: new Date().toISOString() },
      { userId: USERS[0]!.id, name: USERS[0]!.name, role: 'owner', availability: 'available',
        device: 'Mac \u00b7 Safari', where: 'Dubai, United Arab Emirates', doing: '/v2',
        live: true, lastSeen: 'Just now', lastSeenAt: new Date().toISOString() },
      { userId: USERS[2]!.id, name: USERS[2]!.name, role: 'agent', availability: 'busy',
        device: 'Windows \u00b7 Chrome', where: 'Dubai, United Arab Emirates', doing: '/inbox',
        live: false, lastSeen: '3 h ago', lastSeenAt: ago(200) },
      { userId: USERS[3]!.id, name: USERS[3]!.name, role: 'agent', availability: 'off',
        device: 'Windows \u00b7 Edge', where: 'Manila, Philippines', doing: null,
        live: true, lastSeen: 'Just now', lastSeenAt: new Date().toISOString() },
    ],
  }) },
  /*
   * The sign-in log.
   *
   * Every row names somebody in USERS, because the real query joins
   * `session_log` to `users` — a name here that belongs to nobody is a state
   * the real endpoint cannot produce, and it hid the fact that the time-in-CRM
   * table matches a session to a person by name.
   */
  { method: 'GET', pattern: /^\/api\/activity\/sessions$/, handler: ({ query }) => {
    const who = (i: number) => USERS[i]!.name;
    const all = [
      {
        id: 's1', name: who(3), device: 'Windows \u00b7 Edge', where: 'Manila, Philippines',
        level: 'alarm',
        flags: [
          { key: 'new_country', level: 'alarm', message: `${who(3)} signed in from Philippines, which they have never done before.` },
          { key: 'impossible_travel', level: 'alarm', message: `${who(3)} was in United Arab Emirates and then in Philippines less than an hour later. That is not a journey anyone makes, so the password may be in use by somebody else.` },
        ],
        signedInAt: ago(45), signedOutAt: null, activeMinutes: 12,
      },
      {
        id: 's2', name: who(1), device: 'iPhone \u00b7 Safari', where: 'Dubai, United Arab Emirates',
        level: 'none', flags: [], signedInAt: ago(180), signedOutAt: null, activeMinutes: 164,
      },
      {
        id: 's3', name: who(2), device: 'Windows \u00b7 Chrome', where: 'Dubai, United Arab Emirates',
        level: 'watch',
        flags: [{ key: 'new_device', level: 'watch', message: `${who(2)} signed in on a Windows \u00b7 Chrome for the first time.` }],
        signedInAt: ago(400), signedOutAt: ago(200), activeMinutes: 88,
      },
      /*
       * The rest of the office, so the time-in-CRM table is a table.
       *
       * Three rows showed neither the average, the quietest person nor
       * anybody missing \u2014 which is most of what that screen is for.
       */
      {
        id: 's4', name: who(0), device: 'Mac \u00b7 Safari', where: 'Dubai, United Arab Emirates',
        level: 'none', flags: [], signedInAt: ago(330), signedOutAt: null, activeMinutes: 148,
      },
      {
        id: 's5', name: who(1), device: 'Windows \u00b7 Chrome', where: 'Dubai, United Arab Emirates',
        level: 'none', flags: [], signedInAt: ago(500), signedOutAt: ago(430), activeMinutes: 48,
      },
    ];
    return { items: query.get('flagged') === '1' ? all.filter((row) => row.level !== 'none') : all };
  } },
  { method: 'GET', pattern: /^\/api\/activity\/heatmap$/, handler: () => ({ cells: [] }) },
  { method: 'POST', pattern: /^\/api\/activity\/sign-out\/([^/]+)$/, handler: ({ params }) => ({
    ok: true, endedSessions: 2, name: USERS.find((u) => u.id === params[0])?.name ?? 'That person',
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

  // --- the project library --------------------------------------------------
  /*
   * The library screen, its four KPI cards and the developer list. Built from
   * the same PROJECTS the rest of the preview uses, so a project mentioned on
   * a lead is the same project found here.
   */
  { method: 'GET', pattern: /^\/api\/library$/, handler: ({ query }) => {
    const emirate = query.get('emirate') ?? '';
    const status = query.get('status') ?? '';
    const starred = query.get('starred') === '1';
    const search = (query.get('search') ?? '').toLowerCase();

    const items = LIBRARY_CARDS.filter((card) => {
      if (emirate && card.emirate !== emirate) return false;
      if (status && card.sale_status !== status) return false;
      if (starred && card.starred !== 1) return false;
      if (search) {
        const haystack = `${card.name} ${card.developer} ${card.community ?? ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    return { items };
  } },
  { method: 'GET', pattern: /^\/api\/library\/stats$/, handler: () => ({
    mostLeads: { project_name: 'Emaar Beachfront', leads: 41 },
    trending: { project_name: 'Damac Lagoons', rise_pct: 38 },
    bestConverting: { project_name: 'Shams Abu Dhabi', rate_pct: 9.4, deals: 3 },
    inventory: {
      available: 86,
      value_aed: 214_500_000,
      top: [
        { name: 'Emaar Beachfront', available: 34 },
        { name: 'Damac Lagoons', available: 29 },
        { name: 'Shams Abu Dhabi', available: 23 },
      ],
    },
  }) },
  { method: 'GET', pattern: /^\/api\/library\/developers$/, handler: () => ({ items: DEVELOPERS }) },
  { method: 'GET', pattern: /^\/api\/library\/developers\/([^/]+)$/, handler: ({ params }) => ({
    developer: DEVELOPERS.find((entry) => entry.id === params[0]) ?? DEVELOPERS[0],
    contacts: [
      { id: 'dc-1', name: 'Hala Mansour', role: 'Broker relations', phone: '+97144011200',
        whatsapp: '+971501200340', email: 'hala@example.ae' },
      { id: 'dc-2', name: 'Yousef Karim', role: 'Inventory', phone: '+97144011233',
        whatsapp: null, email: 'inventory@example.ae' },
    ],
  }) },
  { method: 'POST', pattern: /^\/api\/library\/([^/]+)\/star$/, handler: ({ params, body }) => {
    const card = LIBRARY_CARDS.find((entry) => entry.id === params[0]);
    if (card) card.starred = (body as { starred?: boolean }).starred ? 1 : 0;
    return { ok: true };
  } },

  // --- sales offers --------------------------------------------------------
  /*
   * The library, so the screen can be shown rather than an error. Enough rows
   * to show every state a card has: a draft, one sent and not yet opened, one
   * being read right now, and one in the trash.
   */
  { method: 'GET', pattern: /^\/api\/offers$/, handler: ({ query }) => {
    const filter = query.get('filter') ?? 'all';
    const folder = query.get('folder');
    const search = (query.get('search') ?? '').toLowerCase();

    const items = OFFERS.filter((offer) => {
      if (filter === 'trash') return offer.deleted_at !== null;
      if (offer.deleted_at !== null) return false;
      if (filter === 'star' && !offer.starred) return false;
      if (filter === 'viewed' && offer.opens === 0) return false;
      if (filter === 'draft' && offer.status !== 'draft') return false;
      if (folder && offer.folder_id !== folder) return false;
      if (!folder && filter === 'all' && offer.folder_id !== null) return false;
      if (search) {
        const haystack = [offer.title, offer.client_name, offer.project_name, offer.agent_name]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    return { items };
  } },
  { method: 'GET', pattern: /^\/api\/offers\/folders$/, handler: () => ({ items: OFFER_FOLDERS }) },
  { method: 'POST', pattern: /^\/api\/offers$/, handler: () => {
    const id = `of-${Date.now()}`;
    OFFERS.unshift({
      ...OFFERS[0]!, id, slug: id, title: 'Untitled offer', status: 'draft', state: 'draft',
      client_name: null, sent_at: null, opens: 0, total_secs: 0, last_view_at: null, starred: 0,
      folder_id: null, deleted_at: null, updated_at: new Date().toISOString(),
    });
    return { id };
  } },
  { method: 'PATCH', pattern: /^\/api\/offers\/([^/]+)$/, handler: ({ params, body }) => {
    const offer = OFFERS.find((entry) => entry.id === params[0]);
    if (offer) Object.assign(offer, body);
    return offer ?? { ok: true };
  } },
  { method: 'DELETE', pattern: /^\/api\/offers\/([^/]+)$/, handler: ({ params }) => {
    const offer = OFFERS.find((entry) => entry.id === params[0]);
    if (offer) offer.deleted_at = new Date().toISOString();
    return { ok: true };
  } },
  { method: 'POST', pattern: /^\/api\/offers\/([^/]+)\/restore$/, handler: ({ params }) => {
    const offer = OFFERS.find((entry) => entry.id === params[0]);
    if (offer) offer.deleted_at = null;
    return { ok: true };
  } },
  { method: 'POST', pattern: /^\/api\/offers\/folders$/, handler: ({ body }) => {
    const id = `ofd-${Date.now()}`;
    OFFER_FOLDERS.push({
      id, name: String((body as { name?: string }).name ?? 'New folder'),
      parent_id: null, is_shared: 0, created_by: currentUser().id, offer_count: 0,
    });
    return { id };
  } },

  // --- the company record and the messaging limits -------------------------
  { method: 'GET', pattern: /^\/api\/company$/, handler: () => ({
    company: PREVIEW_COMPANY,
    issues: previewCompanyIssues(),
    renameWarning:
      'The WhatsApp templates Meta has already approved carry the old name in their footer. '
      + 'Changing it here updates what we would submit next time; the approved ones have to be '
      + 're-submitted and approved again before clients see the new name.',
    messaging: previewMessaging(),
  }) },
  { method: 'PUT', pattern: /^\/api\/company$/, handler: ({ body }) => {
    const changed: string[] = [];
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (!(key in PREVIEW_COMPANY) || typeof value !== 'string') continue;
      const next = value.trim();
      if (next === PREVIEW_COMPANY[key as keyof typeof PREVIEW_COMPANY]) continue;
      PREVIEW_COMPANY[key as keyof typeof PREVIEW_COMPANY] = next;
      changed.push(key);
    }
    return { company: PREVIEW_COMPANY, issues: previewCompanyIssues(), changed };
  } },
  { method: 'PUT', pattern: /^\/api\/company\/messaging$/, handler: ({ body }) => {
    for (const key of ['quietStartHour', 'quietEndHour', 'maxPer24h', 'botPauseHours'] as const) {
      const value = Number((body as Record<string, unknown>)[key]);
      if (Number.isFinite(value)) PREVIEW_MESSAGING[key] = value;
    }
    /* The same ceilings the server enforces, so the preview shows the clamp. */
    PREVIEW_MESSAGING.maxPer24h = Math.min(6, Math.max(1, PREVIEW_MESSAGING.maxPer24h));
    PREVIEW_MESSAGING.botPauseHours = Math.min(72, Math.max(1, PREVIEW_MESSAGING.botPauseHours));
    return previewMessaging();
  } },
  { method: 'DELETE', pattern: /^\/api\/company\/logo$/, handler: () => {
    PREVIEW_COMPANY.logoUrl = '';
    return { ok: true };
  } },

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

  /*
   * The welcome. Starts unanswered in the preview so the whole thing can be
   * walked through, and the questions are the server's list copied here,
   * because the preview has no server to ask.
   */
  { method: 'GET', pattern: /^\/api\/onboarding$/, handler: () => ({
    questions: PREVIEW_WELCOME_QUESTIONS,
    preferredName: previewWelcome.preferredName,
    avatarSet: previewWelcome.avatarSet,
    answers: {},
    completed: false,
    skipped: false,
  }) },
  /* The owner's view. Written out rather than derived, because the point of
     the preview is to show the three states side by side: finished, part way
     and never started. */
  // --- attendance ----------------------------------------------------------
  /* Held in memory so the preview can be walked: tap "I am here" and the card
     changes, the way it does on the real thing. */
  { method: 'GET', pattern: /^\/api\/attendance\/today$/, handler: () => previewAttendance.today() },
  { method: 'POST', pattern: /^\/api\/attendance\/check-in$/, handler: () => {
    previewAttendance.marked = 'office';
    previewAttendance.at = new Date().toISOString();
    previewAttendance.note = null;
    return previewAttendance.today();
  } },
  { method: 'POST', pattern: /^\/api\/attendance\/outside$/, handler: ({ body }) => {
    previewAttendance.marked = 'outside';
    previewAttendance.at = new Date().toISOString();
    previewAttendance.note = String(body.note ?? '');
    return previewAttendance.today();
  } },
  { method: 'GET', pattern: /^\/api\/attendance\/month/, handler: ({ query }) => previewMonth(query) },
  { method: 'GET', pattern: /^\/api\/attendance\/settings$/, handler: () => ({
    ...previewAttendance.settings, yourIp: '203.0.113.10',
  }) },
  { method: 'PUT', pattern: /^\/api\/attendance\/settings$/, handler: ({ body }) => {
    Object.assign(previewAttendance.settings, body);
    return { ...previewAttendance.settings, yourIp: '203.0.113.10' };
  } },

  { method: 'GET', pattern: /^\/api\/onboarding\/all$/, handler: () => ({
    questions: PREVIEW_WELCOME_QUESTIONS,
    items: USERS.filter((u) => u.role !== 'automation').map((u) => {
      const said = PREVIEW_ANSWERS[u.id] ?? {};
      const missing = PREVIEW_MISSING[u.id] ?? [];
      return {
        userId: u.id,
        name: u.name,
        preferredName: PREVIEW_CALLED[u.id] ?? null,
        email: u.email,
        role: u.role,
        isActive: u.is_active === 1,
        jobTitle: PREVIEW_TITLES[u.id] ?? null,
        photoUrl: photoOf(u.id),
        headline: PREVIEW_HEADLINES[u.id] ?? null,
        profileFilled: 8 - missing.length,
        profileTotal: 8,
        profileMissing: missing,
        answers: said,
        completedAt: Object.keys(said).length === PREVIEW_WELCOME_QUESTIONS.length
          ? ago(60 * 24 * 3) : null,
        skippedAt: u.id === 'u-priya' ? ago(60 * 24) : null,
      };
    }),
  }) },
  /* Held in memory so the whole flow can be walked: the name chosen on
     step one and the character chosen on step two have to survive into the
     questions, or every picture after it is the default one. */
  { method: 'PUT', pattern: /^\/api\/onboarding$/, handler: ({ body }) => {
    if (body.preferredName !== undefined) {
      previewWelcome.preferredName = (body.preferredName as string) ?? null;
    }
    if (body.avatarSet !== undefined) {
      const set = body.avatarSet === 'woman' ? 'woman' : body.avatarSet === 'man' ? 'man' : null;
      previewWelcome.avatarSet = set;
    }
    Object.assign(previewWelcome.answers, (body.answers as Record<string, string>) ?? {});
    return {
      preferredName: previewWelcome.preferredName,
      avatarSet: previewWelcome.avatarSet,
      answers: previewWelcome.answers,
      completed: false,
      skipped: Boolean(body.skip),
    };
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
      { id: USERS[1]?.id ?? 'u2', name: 'Layla Hassan', photo_url: photoOf(USERS[1]?.id ?? null), points: 418 },
      { id: OWNER.id, name: OWNER.name, photo_url: photoOf(OWNER.id), points: 377 },
      { id: USERS[2]?.id ?? 'u3', name: 'Omar Haddad', photo_url: photoOf(USERS[2]?.id ?? null), points: 265 },
      { id: USERS[3]?.id ?? 'u4', name: 'Raj Mehta', photo_url: null, points: 191 },
    ],
    online: [
      { id: USERS[1]?.id ?? 'u2', name: 'Layla Hassan', photo_url: photoOf(USERS[1]?.id ?? null) },
      { id: USERS[2]?.id ?? 'u3', name: 'Omar Haddad', photo_url: photoOf(USERS[2]?.id ?? null) },
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
  /* Built from USERS rather than written out again, so a name changed in one
     place does not disagree with itself across two panels. */
  { method: 'GET', pattern: /^\/api\/wall\/top-posters$/, handler: () => ({
    items: [
      { id: 'u-layla', name: 'Layla Hassan', photo_url: photoOf('u-layla'), posts: 6 },
      { id: 'u-omar', name: 'Omar Farouk', photo_url: photoOf('u-omar'), posts: 4 },
      { id: 'u-priya', name: 'Priya Nair', photo_url: photoOf('u-priya'), posts: 2 },
    ],
  }) },
  { method: 'GET', pattern: /^\/api\/wall\/team$/, handler: () => ({
    items: USERS.filter((u) => u.is_active).map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      jobTitle: PREVIEW_TITLES[u.id] ?? null,
      photoUrl: photoOf(u.id),
      headline: PREVIEW_HEADLINES[u.id] ?? null,
      /* The real endpoint reads agent_profiles, which is what the person
         typed about themselves, not the routing codes on the users row. */
      languages: PREVIEW_SPEAKS[u.id] ?? [],
      specialities: PREVIEW_SELLS[u.id] ?? [],
    })),
  }) },
  { method: 'POST', pattern: /^\/api\/wall\/media$/, handler: () => ({
    id: 'pm-new', url: '/preview/wall-1.svg', kind: 'image', name: 'Picture',
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
  { method: 'POST', pattern: /^\/api\/users\/invite$/, handler: ({ body }) => {
    const emails = Array.isArray(body.emails) ? (body.emails as string[]) : [];
    const sendEmail = body.sendEmail === true;
    const seen = new Set<string>();
    const results = emails.map((raw) => {
      const email = String(raw).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { email: String(raw).trim(), status: 'invalid' };
      if (seen.has(email) || USERS.some((u) => u.email === email)) return { email, status: 'already_exists' };
      seen.add(email);
      /* A fixed-shape fake, so the preview looks like the real handover list
         without ever showing something that would work anywhere. */
      const pw = `Tmp${email.slice(0, 2).toUpperCase()}${(email.length * 7) % 97}qR!`;
      return {
        email, status: 'created', temporaryPassword: pw,
        /* The preview has no mail server, which is what an unconfigured CRM
           looks like too. */
        ...(sendEmail ? { emailSent: false, emailReason: 'smtp_not_configured' } : {}),
      };
    });
    return {
      results,
      created: results.filter((r) => r.status === 'created').length,
      skipped: results.filter((r) => r.status !== 'created').length,
    };
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
        /* `?phone=+44…` swaps the number, so the country card can be seen
           for any country without inventing a contact per nation. */
        phone_e164: new URLSearchParams(window.location.search).get('phone') ?? lead.phone,
        wa_id: lead.phone.replace('+', ''), email: lead.email,
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
      importedRow: lead.source === 'csv_import' || lead.id === 'o-1' ? {
        sourceLabel: 'agent_1_leads',
        importedAt: ago(90),
        lineNumber: 2,
        fields: [
          { label: 'Full Name', value: lead.name },
          { label: 'Phone', value: lead.phone },
          { label: 'Alternate Phone', value: '554813624' },
          { label: 'Country', value: 'US' },
          { label: 'Project', value: 'KORE by Imtiaz' },
          { label: 'Developer', value: 'Imtiaz Developments' },
          { label: 'Lead Source', value: 'Instagram' },
          { label: 'Campaign', value: 'KORE by Imtiaz \u2013 English' },
          { label: 'Priority', value: 'Hot' },
          { label: 'Purpose', value: 'Investor' },
          { label: 'Buying Timeline', value: 'Immediately' },
          { label: 'Pay Ready', value: 'Yes' },
        ],
      } : null,
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
  { method: 'GET', pattern: /^\/api\/templates\/library$/, handler: () => ({ items: WA_TEMPLATE_LIBRARY }) },
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
        duplicateStrategy: 'fill_empty', phoneRegion: 'AE',
      },
    };
  } },
  { method: 'PATCH', pattern: /^\/api\/imports\/([^/]+)$/, handler: () => ({ ok: true }) },
  { method: 'POST', pattern: /^\/api\/imports\/([^/]+)\/start$/, handler: () => ({
    ok: true, batchTag: 'pasted-rows-30oct-impp',
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
    total: pastedRows || 250,
  }) },
  { method: 'POST', pattern: /^\/api\/imports\/([^/]+)\/assignment-preview$/, handler: ({ body }) => {
    const method = String(body.method ?? 'pool');
    if (method === 'pool') return { leads: 250, plan: { method, counts: [] }, pooled: 250, unmatched: 0, warnings: [] };
    const agents = USERS.filter((u) => u.role === 'agent');

    /* Split by number: show the numbers that were actually typed, so the
       preview answers the question the screen is asking. */
    if (method === 'split_count') {
      const asked = (body.counts ?? []) as { userId: string; count: number }[];
      let left = 250;
      const counts = asked
        .map((entry, i) => {
          const agent = agents.find((u) => u.id === entry.userId);
          if (!agent) return null;
          const got = Math.max(0, Math.min(entry.count, left));
          left -= got;
          return { userId: agent.id, name: agent.name, before: 20 + i * 8, after: 20 + i * 8 + got };
        })
        .filter(Boolean);
      return { leads: 250, plan: { method, counts }, pooled: left, unmatched: 0, warnings: [] };
    }

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

  /*
   * The one AFTER this one, in the order of the tab the agent came off.
   *
   * This used to hand back LEADS[1] every single time -- the same bug the
   * real endpoint had, mirrored here, which is why no check against the
   * preview could ever have caught "it's just repeating only first two
   * leads all over again."
   */
  /*
   * One lead, for the v2 lead page.
   *
   * Declared after `/counts` and `/:id/next`, because this pattern matches
   * anything and would swallow them -- the same trap the real route has, and
   * the reason one-lead.integration.test.ts opens with a test for it.
   */
  { method: 'GET', pattern: /^\/api\/my-leads\/([^/]+)$/, handler: ({ params }) => {
    const row = myLeadRows().find((r) => r.id === params[0]) ?? myLeadRows()[0]!;
    const lead = LEADS.find((l) => l.id === row.id) ?? LEADS[0]!;
    return {
      lead: {
        ...row,
        is_vip: row.id === LEADS[0]!.id ? 1 : 0,
        returned_at: null,
        unit_type: lead.unitType ?? '2 bedroom',
        preferred_location: lead.project ?? null,
        budget_min_aed: lead.budgetMin ?? null,
        language: lead.language ?? 'English',
        email: `${lead.name.split(' ')[0]!.toLowerCase()}@example.com`,
      },
      contact: { id: row.contact_id, full_name: row.full_name, phone_e164: row.phone_e164 },
      activities: [
        { id: 'a-1', type: 'lead.created', body: 'Added from an import', created_at: ago(2880) },
        { id: 'a-2', type: 'call.logged', body: 'No answer', created_at: ago(300) },
        { id: 'a-3', type: 'note.added', body: 'Asked for the payment plan', created_at: ago(90) },
      ],
      tags: ['src:import', 'lang:en'],
      tasks: [], consents: [], opportunities: [],
      importedRow: null,
    };
  } },

  { method: 'GET', pattern: /^\/api\/my-leads\/([^/]+)\/next$/, handler: ({ params, query }) => {
    const tab = query.get('tab') ?? 'all';
    const rows = myLeadRows().filter((row) => {
      if (tab === 'new') return row.stage_key === 'new_lead';
      if (tab === 'hot') return row.score_band === 'hot';
      if (tab === 'no_next_step') return row.next_step_at === null;
      if (tab === 'overdue') return row.last_contact_at === null;
      if (tab === 'all') return true;
      return row.next_step_at !== null;
    });
    const seat = rows.findIndex((row) => row.id === params[0]);
    const next = seat === -1 ? rows[0] : rows[seat + 1];
    return { next: next ? { id: next.id, contact_id: next.contact_id, full_name: next.full_name } : null };
  } },

  // --- starting the leads again -------------------------------------------
  { method: 'GET', pattern: /^\/api\/company\/lead-data$/, handler: () => ({
    phrase: 'DELETE ALL LEADS',
    counts: {
      contacts: 643, opportunities: 690, offers: 12, messages: 2841,
      activities: 1960, inboundEvents: 712, imports: 3, jobs: 48,
    },
  }) },
  { method: 'POST', pattern: /^\/api\/company\/clear-leads$/, handler: () => ({
    removed: {
      contacts: 643, opportunities: 690, offers: 12, messages: 2841,
      activities: 1960, inboundEvents: 712, imports: 3, jobs: 48,
    },
    leftBehind: [],
  }) },

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
        { label: 'Meta forms', value: Math.round(total * 0.53), colour: '#9BE01E' },
        { label: 'Click-to-WhatsApp', value: Math.round(total * 0.24), colour: '#6E7F62' },
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

  /* ── desks (Settings → Desks) ─────────────────────────────────────────── */
  { method: 'GET', pattern: /^\/api\/v2\/desks$/, handler: () => previewDesks() },
  { method: 'POST', pattern: /^\/api\/v2\/desks$/, handler: ({ body }) => {
    const id = `dk-${DESKS.length + 1}`;
    DESKS.push({
      id,
      name: String(body.name ?? 'New desk'),
      maxOpenLeads: body.maxOpenLeads === null ? null : Number(body.maxOpenLeads),
      memberIds: Array.isArray(body.memberIds) ? (body.memberIds as string[]) : [],
    });
    return { id };
  } },
  { method: 'PATCH', pattern: /^\/api\/v2\/desks\/([^/]+)$/, handler: ({ params, body }) => {
    const desk = DESKS.find((one) => one.id === params[0]);
    if (!desk) throw { status: 404, code: 'not_found', message: 'That desk is not there.' };
    if (body.name !== undefined) desk.name = String(body.name);
    if (body.maxOpenLeads !== undefined) {
      desk.maxOpenLeads = body.maxOpenLeads === null ? null : Number(body.maxOpenLeads);
    }
    if (Array.isArray(body.memberIds)) desk.memberIds = body.memberIds as string[];
    return { ok: true };
  } },
  { method: 'DELETE', pattern: /^\/api\/v2\/desks\/([^/]+)$/, handler: ({ params }) => {
    const at = DESKS.findIndex((one) => one.id === params[0]);
    if (at >= 0) DESKS.splice(at, 1);
    return { ok: true };
  } },

  /* ── what the team is doing right now (see `live.ts`) ─────────────────── */
  { method: 'GET', pattern: /^\/api\/v2\/live$/, handler: () => previewLive() },

  /* ── the messaging report ─────────────────────────────────────────────── */
  { method: 'GET', pattern: /^\/api\/v2\/messaging$/, handler: ({ query }) =>
    previewTapReport(query.get('period')) },
  { method: 'POST', pattern: /^\/api\/v2\/messaging\/remind$/, handler: ({ body }) => {
    const row = TAP_ROWS.find((one) => one[0] === String(body.userId));
    return { reminded: row ? Number(row[4]) : 1 };
  } },

  /* ── managing projects ────────────────────────────────────────────────── */
  { method: 'GET', pattern: /^\/api\/v2\/projects\/manage$/, handler: () => ({
    items: LIBRARY_CARDS.map((card, index) => ({
      ...card,
      leads: [115, 64, 52, 0][index] ?? 0,
      brochure: PROJECT_BROCHURES[card.id] ?? null,
    })),
  }) },
  { method: 'POST', pattern: /^\/api\/library$/, handler: ({ body }) => {
    const id = `p-new-${LIBRARY_CARDS.length + 1}`;
    LIBRARY_CARDS.push({
      ...(LIBRARY_CARDS[LIBRARY_CARDS.length - 1] as (typeof LIBRARY_CARDS)[number]),
      id,
      slug: String(body.name ?? 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: String(body.name ?? 'New project'),
      developer: String(body.developer ?? ''),
      emirate: String(body.emirate ?? 'dubai'),
      community: body.community === null ? null : String(body.community ?? ''),
      sale_status: 'coming_soon',
      starting_price_aed: body.startingPriceAed ? Number(body.startingPriceAed) : null,
      starred: 0,
      archived_at: null,
      units_available: 0,
      units_total: 0,
    });
    return { id };
  } },
  { method: 'PATCH', pattern: /^\/api\/library\/([^/]+)$/, handler: ({ params, body }) => {
    const card = LIBRARY_CARDS.find((one) => one.id === params[0]);
    if (!card) throw { status: 404, code: 'not_found', message: 'That project does not exist' };
    if (body.name !== undefined) card.name = String(body.name);
    if (body.developer !== undefined) card.developer = String(body.developer);
    if (body.emirate !== undefined) card.emirate = String(body.emirate);
    if (body.community !== undefined) card.community = body.community === null ? null : String(body.community);
    if (body.startingPriceAed !== undefined) {
      card.starting_price_aed = body.startingPriceAed === null ? null : Number(body.startingPriceAed);
    }
    if (body.saleStatus !== undefined) {
      card.sale_status = String(body.saleStatus) as (typeof card)['sale_status'];
    }
    return { ok: true };
  } },
  { method: 'POST', pattern: /^\/api\/library\/([^/]+)\/archive$/, handler: ({ params, body }) => {
    const card = LIBRARY_CARDS.find((one) => one.id === params[0]);
    if (card) card.archived_at = body.archived ? new Date().toISOString() : null;
    return { ok: true };
  } },

  /*
   * Homes AI, answering from the demo leads.
   *
   * The real endpoint calls Gemini through read-only, permission-checked
   * tools; there is no model here, so the answer is written from the same
   * in-memory leads the rest of the preview uses, and `toolsUsed` names them.
   * No price, payment plan or handover date appears in any of these answers —
   * the screen has to be shown behaving the way the hard rule requires.
   */
  { method: 'POST', pattern: /^\/api\/ai\/ask$/, handler: ({ body }) => {
    const asked = String(body.question ?? '').toLowerCase();
    const mine = currentUser().role === 'agent'
      ? LEADS.filter((lead) => lead.owner === currentUser().id)
      : LEADS;
    const open = mine.filter((lead) => lead.status === 'open');
    const name = (lead: (typeof LEADS)[number]) => `${lead.name} · ${lead.project ?? 'no project'}`;

    const answer = /call|first|priority|now|need/.test(asked)
      ? [
        `${open.length} of your leads are open. Call these first:`,
        /* The id in square brackets is what the real prompt asks the model
           for (server/src/ai/ask.ts, rule 6), so the screen's link handling
           is exercised here too. */
        ...open.slice(0, 3).map((lead, i) => `- ${name(lead)} · score ${lead.score}${i === 0 ? ' · highest score' : ''} [lead:${lead.id}]`),
        'I have not written to any of them. Open the lead and send it yourself.',
      ].join('\n')
      : /cold|next step|forgot|nothing planned/.test(asked)
        ? [
          `${open.filter((lead) => lead.unread === 0).length} leads have had nothing from us today.`,
          ...open.slice(0, 2).map((lead) => `- ${name(lead)} · stage ${lead.stage.replace(/_/g, ' ')}`),
          'Add a follow-up on each so they do not go quiet.',
        ].join('\n')
        : /project|most leads|which project/.test(asked)
          ? [
            'Open leads by project:',
            ...[...new Set(open.map((lead) => lead.project))].filter(Boolean)
              .map((project) => `- ${String(project)} · ${open.filter((lead) => lead.project === project).length}`),
            'Prices and payment plans are on the project page — I do not quote a figure that is not in the library.',
          ].join('\n')
          : /too many|load|busy|team|how is/.test(asked)
            ? [
              'Open leads by person:',
              ...USERS.filter((u) => u.role === 'agent')
                .map((u) => `- ${u.name} · ${LEADS.filter((lead) => lead.owner === u.id && lead.status === 'open').length}`),
            ].join('\n')
            : 'This is the demo, so I only answer a few questions here. Try one of the suggestions under the chat. In the real CRM I read your leads, your calendar and the project library, and I say I do not know rather than guessing.';

    return {
      answer,
      toolsUsed: ['search_leads', 'get_pipeline_stats'],
      model: 'preview',
      conversationId: String(body.conversationId ?? 'ai-demo-1'),
    };
  } },

  /*
   * One project, in the shape the real `GET /api/library/:id` returns. It is
   * last in the list on purpose: the pattern would also match
   * `/api/library/stats` and `/api/library/developers`, and the first match
   * wins, so those have to be declared above it.
   */
  { method: 'GET', pattern: /^\/api\/library\/([^/]+)$/, handler: ({ params }) => {
    const project = PROJECTS.find((one) => one.id === params[0]) ?? PROJECTS[0]!;
    const index = PROJECTS.indexOf(project);
    const total = [120, 40, 60, 0][index % 4] as number;
    const spare = [24, 8, 0, 0][index % 4] as number;
    const types = ['Studio', '1 Bedroom', '2 Bedroom', '3 Bedroom'];

    return {
      project: {
        id: project.id,
        slug: project.slug,
        name: project.name,
        developer: project.developer,
        developer_name: project.developer,
        emirate: project.emirate,
        community: project.area,
        property_type: 'apartment',
        sale_status: (['selling_now', 'selling_now', 'coming_soon', 'sold_out'][index % 4]) as string,
        starting_price_aed: project.starting_price_aed,
        handover_date: project.handover_date,
        payment_plan: project.payment_plan,
        rera_no: project.starting_price_aed ? '2104' : null,
        ownership: 'freehold',
        escrow_account: 'Emirates NBD · escrow',
        construction_pct: [62, 38, 81, null][index % 4] as number | null,
        service_charge_sqft: 16,
        golden_visa_threshold_aed: 2_000_000,
        visibility: 'private',
        starred: index === 0 ? 1 : 0,
        verified_at: project.verified_at,
        cover_photo_id: null,
        image_url: null,
        brochure_url: project.brochure_url,
        description: project.starting_price_aed
          ? [
            `${project.area}, a short drive from Downtown and the business district.`,
            `From ${project.starting_price_aed.toLocaleString('en-GB')} AED on a ${project.payment_plan ?? 'standard'} plan.`,
            `${project.developer} delivers on time, and people who work nearby want to rent here.`,
          ].join('\n')
          : null,
      },
      units: Array.from({ length: Math.min(total, 12) }, (_unused, i) => ({
        id: `${project.id}-u${i + 1}`,
        unit_no: `${10 + i}0${i + 1}`,
        unit_type: types[i % types.length] as string,
        bedrooms: i % 4,
        price_aed: (project.starting_price_aed ?? 1_200_000) + i * 85_000,
        status: i < spare ? 'available' : 'sold',
      })),
      plans: project.payment_plan
        ? [{
          id: `${project.id}-plan`,
          name: project.payment_plan,
          is_default: 1,
          rows: [
            { id: 'r1', seq: 1, milestone: 'On booking', percent: '20', due_note: 'Immediate' },
            { id: 'r2', seq: 2, milestone: 'During construction', percent: '40', due_note: 'By milestones' },
            { id: 'r3', seq: 3, milestone: 'On handover', percent: '40', due_note: project.handover_date },
          ],
        }]
        : [],
      commission: currentUser().role === 'agent' ? null : { project_id: project.id, rate_pct: '4.00' },
      location: project.location_lat
        ? { lat: project.location_lat, lng: project.location_lng, address: project.area }
        : null,
      amenities: [],
    };
  } },

  /* Pinning is its own permission on the server; the wall's "Owner news"
     switch posts and then pins, so the preview needs both. */
  { method: 'POST', pattern: /^\/api\/wall\/([^/]+)\/pin$/, handler: ({ params, body }) => {
    const post = WALL_POSTS.find((one) => one.id === params[0]);
    if (post) post.pinned_at = (body as { pinned?: boolean }).pinned ? new Date().toISOString() : null;
    return { ok: true };
  } },
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

/**
 * The WhatsApp template library the real `/api/templates/library` returns.
 *
 * `wa_templates.components` holds the text in the real database, and the
 * Templates screen falls back to this definition when a template has never
 * been synced. The preview served an empty library, so every card drew with
 * no words in it.
 *
 * The bodies, examples and buttons are copied from
 * `server/src/messaging/templates/library.ts`. A preview that paraphrases
 * them teaches the wrong wording, and the wording is the thing Meta approves.
 */
const WA_TEMPLATE_LIBRARY = [
  {
    name: 'lead_welcome_en', language: 'en', category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'DOCUMENT' },
      {
        type: 'BODY',
        text: 'Hello {{1}}, thank you for your interest in {{2}}. My name is {{3}} from {{4}} and I will be '
          + 'looking after your enquiry personally. I have attached the project brochure above. '
          + 'How would you like to continue?',
        example: { body_text: [['Sara', 'Emaar Beachfront', 'Layla Hassan', 'Emigeo Homes']] },
      },
      { type: 'FOOTER', text: 'Emigeo Homes — Dubai' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Pricing' },
          { type: 'QUICK_REPLY', text: 'Location' },
          { type: 'QUICK_REPLY', text: 'Call me' },
        ],
      },
    ],
    validation: { valid: true, issues: [] },
  },
  {
    name: 'lead_welcome_ar', language: 'ar', category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'DOCUMENT' },
      {
        type: 'BODY',
        text: 'مرحباً {{1}}، شكراً لاهتمامك بمشروع {{2}}. اسمي {{3}} من {{4}} وسأتابع طلبك شخصياً. '
          + 'لقد أرفقت كتيب المشروع أعلاه. كيف تحب أن نكمل؟',
        example: { body_text: [['سارة', 'إعمار بيتشفرونت', 'ليلى حسن', 'Emigeo Homes']] },
      },
      { type: 'FOOTER', text: 'Emigeo Homes — دبي' },
    ],
    validation: { valid: true, issues: [] },
  },
  {
    name: 'followup_2h_en', language: 'en', category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, this is {{2}} following up on your enquiry about {{3}}. I have availability today '
          + 'to walk you through the floor plans and payment options. Shall I call you?',
        example: { body_text: [['Sara', 'Layla Hassan', 'Emaar Beachfront']] },
      },
      { type: 'FOOTER', text: 'Emigeo Homes — Dubai' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Call me' },
          { type: 'QUICK_REPLY', text: 'Send pricing' },
        ],
      },
    ],
    validation: { valid: true, issues: [] },
  },
  {
    name: 'followup_2h_ar', language: 'ar', category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text: 'مرحباً {{1}}، معك {{2}} للمتابعة بخصوص استفسارك عن {{3}}. لدي وقت متاح اليوم '
          + 'لأشرح لك المخططات وخطط السداد. هل أتصل بك؟',
        example: { body_text: [['سارة', 'ليلى حسن', 'إعمار بيتشفرونت']] },
      },
      { type: 'FOOTER', text: 'Emigeo Homes — دبي' },
    ],
    validation: { valid: true, issues: [] },
  },
  {
    name: 'followup_24h_en', language: 'en', category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'IMAGE' },
      {
        type: 'BODY',
        text: 'Hi {{1}}, units at {{2}} start from AED {{3}} with a developer payment plan. I can hold a '
          + 'unit for you while you review the details. Would you like the full price list?',
        example: { body_text: [['Sara', 'Emaar Beachfront', '1,850,000']] },
      },
      { type: 'FOOTER', text: 'Emigeo Homes — Dubai' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Send price list' },
          { type: 'QUICK_REPLY', text: 'Book a viewing' },
        ],
      },
    ],
    validation: { valid: true, issues: [] },
  },
  {
    name: 'followup_24h_ar', language: 'ar', category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'IMAGE' },
      {
        type: 'BODY',
        text: 'مرحباً {{1}}، تبدأ أسعار الوحدات في {{2}} من {{3}} درهم مع خطة سداد من المطور. '
          + 'يمكنني حجز وحدة لك ريثما تطّلع على التفاصيل. هل ترغب بقائمة الأسعار الكاملة؟',
        example: { body_text: [['سارة', 'إعمار بيتشفرونت', '1,850,000']] },
      },
      { type: 'FOOTER', text: 'Emigeo Homes — دبي' },
    ],
    validation: { valid: true, issues: [] },
  },
  {
    name: 'followup_3d_en', language: 'en', category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, I do not want to keep messaging if the timing is not right. '
          + 'Are you still considering {{2}}, or should I close your file for now?',
        example: { body_text: [['Sara', 'Emaar Beachfront']] },
      },
      { type: 'FOOTER', text: 'Emigeo Homes — Dubai' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Still interested' },
          { type: 'QUICK_REPLY', text: 'Not now' },
          { type: 'QUICK_REPLY', text: 'Stop messages' },
        ],
      },
    ],
    validation: { valid: true, issues: [] },
  },
  {
    name: 'followup_3d_ar', language: 'ar', category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text: 'مرحباً {{1}}، لا أرغب بإزعاجك إذا لم يكن الوقت مناسباً. '
          + 'هل ما زلت مهتماً بمشروع {{2}}، أم أغلق ملفك حالياً؟',
        example: { body_text: [['سارة', 'إعمار بيتشفرونت']] },
      },
      { type: 'FOOTER', text: 'Emigeo Homes — دبي' },
    ],
    validation: { valid: true, issues: [] },
  },
  {
    name: 'appointment_confirm_en', language: 'en', category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, your viewing for {{2}} is confirmed on {{3}} at {{4}}. '
          + 'Your agent {{5}} will meet you there. Reply here if anything changes.',
        example: { body_text: [['Sara', 'Emaar Beachfront', 'Tuesday 14 April', '4:00 PM', 'Layla Hassan']] },
      },
      { type: 'FOOTER', text: 'Emigeo Homes — Dubai' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirm' },
          { type: 'QUICK_REPLY', text: 'Reschedule' },
        ],
      },
    ],
    validation: { valid: true, issues: [] },
  },
  {
    name: 'appointment_reminder_en', language: 'en', category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Reminder for {{1}}: your {{2}} viewing is tomorrow at {{3}}. Your agent {{4}} is expecting you.',
        example: { body_text: [['Sara', 'Emaar Beachfront', '4:00 PM', 'Layla Hassan']] },
      },
      { type: 'FOOTER', text: 'Emigeo Homes — Dubai' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'See you there' },
          { type: 'QUICK_REPLY', text: 'Reschedule' },
        ],
      },
    ],
    validation: { valid: true, issues: [] },
  },
  {
    name: 'agent_new_lead_alert_en', language: 'en', category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'New lead for {{1}}: {{2}} asking about {{3}} from {{4}}. Open the CRM and respond within 5 minutes.',
        example: { body_text: [['Layla Hassan', 'Sara A.', 'Emaar Beachfront', 'Meta Lead Ads']] },
      },
      { type: 'FOOTER', text: 'Emigeo Homes — Dubai' },
    ],
    validation: { valid: true, issues: [] },
  },
  {
    name: 'new_launch_alert_en', language: 'en', category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'IMAGE' },
      {
        type: 'BODY',
        text: 'Hi {{1}}, a new launch by {{2}} in {{3}} opens for registration this week, starting from '
          + 'AED {{4}}. Early registrations get first pick of units. Would you like the details?',
        example: { body_text: [['Sara', 'Emaar', 'Dubai Creek Harbour', '1,600,000']] },
      },
      { type: 'FOOTER', text: 'Emigeo Homes — Dubai' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Send details' },
          { type: 'QUICK_REPLY', text: 'Not interested' },
          { type: 'QUICK_REPLY', text: 'Stop messages' },
        ],
      },
    ],
    validation: { valid: true, issues: [] },
  },
];

/* ── desks, the messaging report and the brochures on the manage screen ───
 *
 * Added with those three screens. The desks are the ones in
 * `design/web/desks.html`, mapped onto the preview's five people, and the
 * loads are chosen so that one agent is over the limit — a screen where
 * nothing is wrong demonstrates nothing.
 */

type PreviewDesk = { id: string; name: string; maxOpenLeads: number | null; memberIds: string[] };

const DESKS: PreviewDesk[] = [
  { id: 'dk-1', name: 'Dubai off-plan', maxOpenLeads: 60, memberIds: ['u-layla', 'u-priya'] },
  { id: 'dk-2', name: 'Arabic desk', maxOpenLeads: 50, memberIds: ['u-omar', 'u-layla'] },
  { id: 'dk-3', name: 'Abu Dhabi', maxOpenLeads: 40, memberIds: ['u-yousef'] },
];

/** Open leads per person. Omar is seven over the Arabic desk's fifty. */
const DESK_LOAD: Record<string, number> = {
  'u-layla': 22, 'u-omar': 57, 'u-priya': 18, 'u-yousef': 14,
};

function deskMember(userId: string) {
  const person = USERS.find((one) => one.id === userId);
  return {
    userId,
    name: person?.name ?? 'Somebody',
    photoUrl: null as string | null,
    openLeads: DESK_LOAD[userId] ?? 10,
    markedToday: (userId === 'u-priya' ? 'outside' : 'office') as 'office' | 'outside' | null,
  };
}

function previewDesks() {
  const people = USERS.filter((one) => one.role === 'agent' || one.role === 'manager');
  return {
    items: DESKS.map((desk) => ({
      id: desk.id,
      name: desk.name,
      maxOpenLeads: desk.maxOpenLeads,
      members: desk.memberIds.map(deskMember),
    })),
    agents: people.map((person) => ({
      ...deskMember(person.id),
      languages: person.languages.map((code) => (code === 'ar' ? 'Arabic' : 'English')),
      deskIds: DESKS.filter((desk) => desk.memberIds.includes(person.id)).map((desk) => desk.id),
    })),
  };
}

/** userId, taps, replied, links opened, no update. */
const TAP_ROWS: Array<[string, number, number, number, number]> = [
  ['u-layla', 26, 13, 6, 0],
  ['u-omar', 10, 4, 3, 2],
  ['u-priya', 21, 9, 5, 0],
  ['u-yousef', 15, 6, 3, 1],
];

function previewTapReport(asked: string | null) {
  const period = asked === 'week' || asked === 'month' ? asked : 'today';
  const times = period === 'month' ? 19 : period === 'week' ? 5 : 1;
  /* "No update" does not grow with the window the way taps do: an agent
     answers the old ones. */
  const open = times > 1 ? Math.ceil(times / 3) : 1;

  const agents = TAP_ROWS.map(([userId, taps, replied, links, noUpdate]) => ({
    userId,
    name: USERS.find((one) => one.id === userId)?.name ?? 'Somebody',
    taps: taps * times,
    confirmed: taps * times - noUpdate * open,
    replied: replied * times,
    linksOpened: links * times,
    noUpdate: noUpdate * open,
  })).sort((a, b) => b.noUpdate - a.noUpdate || b.taps - a.taps);

  const total = agents.reduce((sum, one) => sum + one.taps, 0);
  const confirmed = agents.reduce((sum, one) => sum + one.confirmed, 0);
  const replied = agents.reduce((sum, one) => sum + one.replied, 0);
  const rest = confirmed - replied;

  const links = { made: 41 * times, opened: 17 * times, opens: 29 * times };

  return {
    period,
    days: period === 'month' ? 30 : period === 'week' ? 7 : 1,
    taps: {
      total,
      whatsapp: Math.round(total * 0.79),
      telegram: total - Math.round(total * 0.79),
      previous: Math.round(total * 0.88),
    },
    confirmed,
    noUpdate: total - confirmed,
    replied,
    answers: {
      sent: Math.round(rest * 0.54),
      replied,
      no_reply: Math.round(rest * 0.24),
      changed_mind: Math.round(rest * 0.13),
      wrong_number: Math.round(rest * 0.06),
      not_sent: rest - Math.round(rest * 0.54) - Math.round(rest * 0.24)
        - Math.round(rest * 0.13) - Math.round(rest * 0.06),
    },
    links,
    agents,
    opened: [
      ['Marco Bellini', 'Brochure · Emaar Beachfront', 'brochure', 2, 'Layla Hassan'],
      ['Elena Kuznetsova', 'Payment plan · Damac Lagoons', 'payment_plan', 3, 'Priya Nair'],
      ['Aisha Noor', 'Location · Emaar Beachfront', 'location', 1, 'Layla Hassan'],
      ['Ivan Petrov', 'Video · Damac Lagoons', 'video', 1, 'Omar Farouk'],
      ['Daniel Rossi', 'Location · Shams Abu Dhabi', 'location', 1, 'Yousef Karim'],
    ].map((row, index) => ({
      linkId: `lk-${index + 1}`,
      leadId: LEADS[index % LEADS.length]?.id ?? null,
      client: String(row[0]),
      label: String(row[1]),
      kind: String(row[2]),
      opens: Number(row[3]),
      lastOpenedAt: ago(37 + index * 26),
      agentName: String(row[4]),
    })),
  };
}

/** Two of the four projects have a brochure, so both states are on screen. */
const PROJECT_BROCHURES: Record<string, { id: string; filename: string; byteSize: number }> = {
  'p-1': { id: 'doc-1', filename: 'Emaar-Beachfront.pdf', byteSize: 12 * 1_048_576 },
  'p-2': { id: 'doc-2', filename: 'Damac-Lagoons.pdf', byteSize: 9 * 1_048_576 },
};
