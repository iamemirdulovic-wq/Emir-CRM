/**
 * The dataset behind the no-backend preview.
 *
 * It mirrors what `npm run demo` produces by driving the real pipeline, so the
 * preview shows the system's actual behaviour — sticky assignment by project
 * coverage, hot-lead scoring, a closed WhatsApp window forcing template-only
 * replies — rather than invented screens. Every figure here is example data.
 */

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

export type PreviewUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: number;
  availability: string;
  routing_weight: number;
  languages: string[];
  projects_covered: string[];
  manager_id: string | null;
  last_login_at: string | null;
};

export const USERS: PreviewUser[] = [
  { id: 'u-owner', name: 'Emir Dulovic', email: 'owner@emircrm.ae', role: 'owner', is_active: 1, availability: 'available', routing_weight: 0, languages: ['en'], projects_covered: [], manager_id: null, last_login_at: ago(3) },
  { id: 'u-layla', name: 'Layla Hassan', email: 'layla@emircrm.ae', role: 'agent', is_active: 1, availability: 'available', routing_weight: 15, languages: ['en', 'ar'], projects_covered: ['Emaar Beachfront'], manager_id: 'u-owner', last_login_at: ago(41) },
  { id: 'u-omar', name: 'Omar Farouk', email: 'omar@emircrm.ae', role: 'agent', is_active: 1, availability: 'available', routing_weight: 10, languages: ['ar'], projects_covered: ['Damac Lagoons'], manager_id: 'u-owner', last_login_at: ago(128) },
  { id: 'u-priya', name: 'Priya Nair', email: 'priya@emircrm.ae', role: 'agent', is_active: 1, availability: 'busy', routing_weight: 10, languages: ['en'], projects_covered: [], manager_id: 'u-owner', last_login_at: ago(19) },
  { id: 'u-yousef', name: 'Yousef Karim', email: 'yousef@emircrm.ae', role: 'manager', is_active: 1, availability: 'available', routing_weight: 0, languages: ['en', 'ar'], projects_covered: [], manager_id: 'u-owner', last_login_at: ago(7) },
];

export type PreviewProject = {
  id: string;
  slug: string;
  name: string;
  developer: string;
  emirate: string;
  area: string | null;
  starting_price_aed: number | null;
  payment_plan: string | null;
  handover_date: string | null;
  golden_visa_eligible: number;
  brochure_url: string | null;
  location_lat: string | null;
  location_lng: string | null;
  is_active: number;
  verified_at: string | null;
};

export const PROJECTS: PreviewProject[] = [
  { id: 'p-1', slug: 'emaar-beachfront', name: 'Emaar Beachfront', developer: 'Emaar', emirate: 'dubai', area: 'Dubai Harbour', starting_price_aed: 1850000, payment_plan: '80/20 until handover', handover_date: 'Q4 2027', golden_visa_eligible: 1, brochure_url: 'https://cdn.example.ae/emaar-beachfront.pdf', location_lat: '25.0940000', location_lng: '55.1440000', is_active: 1, verified_at: ago(4320) },
  { id: 'p-2', slug: 'damac-lagoons', name: 'Damac Lagoons', developer: 'Damac', emirate: 'dubai', area: 'Dubailand', starting_price_aed: 1450000, payment_plan: '75/25 with 1% monthly', handover_date: 'Q2 2028', golden_visa_eligible: 1, brochure_url: 'https://cdn.example.ae/damac-lagoons.pdf', location_lat: '25.0230000', location_lng: '55.2600000', is_active: 1, verified_at: ago(2880) },
  { id: 'p-3', slug: 'shams-abu-dhabi', name: 'Shams Abu Dhabi', developer: 'Aldar', emirate: 'abu_dhabi', area: 'Al Reem Island', starting_price_aed: 1200000, payment_plan: '60/40 on handover', handover_date: 'Q1 2027', golden_visa_eligible: 0, brochure_url: 'https://cdn.example.ae/shams.pdf', location_lat: '24.4966000', location_lng: '54.4088000', is_active: 1, verified_at: ago(1440) },
  { id: 'p-4', slug: 'sobha-hartland-ii', name: 'Sobha Hartland II', developer: 'Sobha', emirate: 'dubai', area: 'Mohammed Bin Rashid City', starting_price_aed: null, payment_plan: null, handover_date: null, golden_visa_eligible: 0, brochure_url: null, location_lat: null, location_lng: null, is_active: 1, verified_at: null },
];

export type Lead = {
  id: string;
  contactId: string;
  conversationId: string;
  name: string;
  phone: string;
  email: string | null;
  language: string;
  project: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  unitType: string | null;
  timeline: string;
  purpose: string;
  source: string;
  campaign: string | null;
  stage: string;
  subStatus: string | null;
  status: 'open' | 'won' | 'lost';
  lostReason?: string;
  owner: string | null;
  score: number;
  slaBreached: number;
  dnc: number;
  createdMinutesAgo: number;
  tags: string[];
  windowOpen: boolean;
  unread: number;
};

export const LEADS: Lead[] = [
  {
    id: 'o-1', contactId: 'c-1', conversationId: 'cv-1',
    name: 'Sara Al Mansoori', phone: '+971501234567', email: 'sara.almansoori@example.com', language: 'en',
    project: 'Emaar Beachfront', budgetMin: 1000000, budgetMax: 2000000, unitType: '2 Bedroom',
    timeline: '1_3_months', purpose: 'investment', source: 'meta_lead_ads', campaign: 'Q1-2026-Dubai-OffPlan-Leads',
    stage: 'engaged_qualified', subStatus: 'engaged', status: 'open', owner: 'u-layla', score: 83,
    slaBreached: 0, dnc: 0, createdMinutesAgo: 47,
    tags: ['src:meta_lead_ads', 'lang:en', 'proj:emaar_beachfront', 'intent:pricing'],
    windowOpen: true, unread: 1,
  },
  {
    id: 'o-2', contactId: 'c-2', conversationId: 'cv-2',
    name: 'Omar Haddad', phone: '+971559876543', email: 'omar.haddad@example.com', language: 'ar',
    project: 'Damac Lagoons', budgetMin: 2000000, budgetMax: 3000000, unitType: '4 Bedroom Villa',
    timeline: 'immediate', purpose: 'end_use', source: 'meta_ctwa', campaign: 'CTWA-Lagoons-Arabic',
    stage: 'appointment_scheduled', subStatus: 'booked', status: 'open', owner: 'u-omar', score: 87,
    slaBreached: 0, dnc: 0, createdMinutesAgo: 190,
    tags: ['src:meta_ctwa', 'lang:ar', 'proj:damac_lagoons', 'intent:hot'],
    windowOpen: true, unread: 0,
  },
  {
    id: 'o-3', contactId: 'c-3', conversationId: 'cv-3',
    name: 'David Chen', phone: '+971544455566', email: 'david.chen@example.com', language: 'en',
    project: 'Emaar Beachfront', budgetMin: 5000000, budgetMax: null, unitType: 'Penthouse',
    timeline: 'immediate', purpose: 'investment', source: 'meta_lead_ads', campaign: 'Q1-2026-Dubai-OffPlan-Leads',
    stage: 'deal_sent', subStatus: 'eoi_sent', status: 'open', owner: 'u-layla', score: 95,
    slaBreached: 0, dnc: 0, createdMinutesAgo: 1320,
    tags: ['src:meta_lead_ads', 'lang:en', 'proj:emaar_beachfront', 'intent:hot', 'intent:call_me'],
    windowOpen: false, unread: 0,
  },
  {
    id: 'o-4', contactId: 'c-4', conversationId: 'cv-4',
    name: 'Fatima Noor', phone: '+971551112233', email: 'fatima.noor@example.com', language: 'en',
    project: 'Shams Abu Dhabi', budgetMin: null, budgetMax: 3000000, unitType: null,
    timeline: '3_6_months', purpose: 'investment', source: 'google_ads', campaign: 'AUH-Reem-Search',
    stage: 'new_lead', subStatus: 'raw', status: 'open', owner: 'u-priya', score: 53,
    slaBreached: 0, dnc: 0, createdMinutesAgo: 6,
    tags: ['src:google_ads', 'lang:en', 'proj:shams_abu_dhabi'],
    windowOpen: false, unread: 0,
  },
  {
    id: 'o-5', contactId: 'c-5', conversationId: 'cv-5',
    name: 'Ahmed Khalil', phone: '+971509876543', email: 'ahmed.khalil@example.com', language: 'en',
    project: 'Emaar Beachfront', budgetMin: 3500000, budgetMax: 3500000, unitType: '3 Bedroom',
    timeline: '6_12_months', purpose: 'end_use', source: 'website', campaign: 'creek-harbour-2026',
    stage: 'attempted_contact', subStatus: 'attempt_2', status: 'open', owner: 'u-layla', score: 68,
    slaBreached: 1, dnc: 0, createdMinutesAgo: 400,
    tags: ['src:website', 'lang:en', 'proj:emaar_beachfront', 'ops:sla-breach', 'intent:brochure'],
    windowOpen: false, unread: 0,
  },
  {
    id: 'o-6', contactId: 'c-6', conversationId: 'cv-6',
    name: 'Rania Aziz', phone: '+971502223344', email: 'rania.aziz@example.com', language: 'ar',
    project: 'Damac Lagoons', budgetMin: 800000, budgetMax: 1200000, unitType: '1 Bedroom',
    timeline: '12_plus', purpose: 'investment', source: 'website', campaign: null,
    stage: 'lost', subStatus: null, status: 'lost', lostReason: 'budget_mismatch', owner: 'u-omar', score: 31,
    slaBreached: 0, dnc: 0, createdMinutesAgo: 4300,
    tags: ['src:website', 'lang:ar', 'proj:damac_lagoons', 'ops:nurture'],
    windowOpen: false, unread: 0,
  },
  {
    id: 'o-7', contactId: 'c-7', conversationId: 'cv-7',
    name: 'Mariam Al Suwaidi', phone: '+971507778899', email: null, language: 'ar',
    project: 'Shams Abu Dhabi', budgetMin: 1200000, budgetMax: 1800000, unitType: '2 Bedroom',
    timeline: '1_3_months', purpose: 'end_use', source: 'whatsapp_direct', campaign: null,
    stage: 'engaged_qualified', subStatus: 'qualified', status: 'open', owner: 'u-priya', score: 74,
    slaBreached: 0, dnc: 0, createdMinutesAgo: 95,
    tags: ['src:whatsapp_direct', 'lang:ar', 'proj:shams_abu_dhabi', 'intent:hot'],
    windowOpen: true, unread: 2,
  },
  {
    id: 'o-8', contactId: 'c-8', conversationId: 'cv-8',
    name: 'James Whitfield', phone: '+971505556677', email: 'j.whitfield@example.com', language: 'en',
    project: 'Emaar Beachfront', budgetMin: 4000000, budgetMax: 6000000, unitType: '3 Bedroom',
    timeline: 'immediate', purpose: 'investment', source: 'meta_lead_ads', campaign: 'Q1-2026-Dubai-OffPlan-Leads',
    stage: 'won', subStatus: 'reserved', status: 'won', owner: 'u-layla', score: 91,
    slaBreached: 0, dnc: 0, createdMinutesAgo: 10080,
    tags: ['src:meta_lead_ads', 'lang:en', 'proj:emaar_beachfront'],
    windowOpen: false, unread: 0,
  },
  {
    id: 'o-9', contactId: 'c-9', conversationId: 'cv-9',
    name: 'Nadia Rahman', phone: '+971503334455', email: 'nadia.r@example.com', language: 'en',
    project: null, budgetMin: null, budgetMax: null, unitType: null,
    timeline: 'unknown', purpose: 'unknown', source: 'csv_import', campaign: null,
    stage: 'new_lead', subStatus: 'raw', status: 'open', owner: null, score: 22,
    slaBreached: 0, dnc: 1, createdMinutesAgo: 2800,
    tags: ['src:csv_import', 'ops:possible_duplicate'],
    windowOpen: false, unread: 0,
  },
];

export type Thread = { id: string; contactId: string; messages: Array<Record<string, unknown>>; events: Array<Record<string, unknown>> };

const msg = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: `m-${Math.random().toString(36).slice(2, 10)}`,
  channel: 'whatsapp',
  direction: 'inbound',
  provider: 'whatsapp_cloud',
  user_id: null,
  user_name: null,
  is_automated: 0,
  template_name: null,
  template_language: null,
  subject: null,
  body: null,
  media: null,
  status: 'received',
  error_code: null,
  error_message: null,
  sent_at: null,
  delivered_at: null,
  read_at: null,
  created_at: ago(30),
  ...over,
});

export const THREADS: Record<string, Thread> = {
  'cv-1': {
    id: 'cv-1',
    contactId: 'c-1',
    messages: [
      msg({ direction: 'outbound', is_automated: 1, template_name: 'lead_welcome_en', status: 'read', created_at: ago(46), body: 'Hello Sara, thank you for your interest in Emaar Beachfront. My name is Layla Hassan from Emir Real Estate and I will be looking after your enquiry personally.\n\nI have attached the project brochure above. How would you like to continue?' }),
      msg({ created_at: ago(38), body: 'What is the price for a 2 bedroom?' }),
      msg({ direction: 'outbound', is_automated: 1, status: 'delivered', created_at: ago(38), body: 'Emaar Beachfront — Emaar\nPrices start from AED 1,850,000.\nPayment plan: 80/20 until handover\nHandover: Q4 2027\nEligible for the Golden Visa.' }),
      msg({ created_at: ago(22), body: 'Can I see the floor plans for the 2 bed?' }),
      msg({ direction: 'outbound', is_automated: 0, user_id: 'u-layla', user_name: 'Layla Hassan', status: 'read', created_at: ago(20), body: 'Of course Sara — sending them now. Would Thursday afternoon suit you for a viewing at the sales centre?' }),
      msg({ created_at: ago(4), body: 'Thursday works. What time?' }),
    ],
    events: [
      { id: 'e-1', type: 'stage.changed', title: 'Stage moved from attempted_contact to engaged_qualified', body: null, created_at: ago(38) },
      { id: 'e-2', type: 'intent.resolved', title: 'Intent: PRICING', body: 'Matched "price"', created_at: ago(38) },
    ],
  },
  'cv-3': {
    id: 'cv-3',
    contactId: 'c-3',
    messages: [
      msg({ direction: 'outbound', is_automated: 1, template_name: 'lead_welcome_en', status: 'read', created_at: ago(1319), body: 'Hello David, thank you for your interest in Emaar Beachfront. My name is Layla Hassan from Emir Real Estate and I will be looking after your enquiry personally.' }),
      msg({ created_at: ago(1300), body: 'Call me please' }),
      msg({ direction: 'outbound', is_automated: 1, status: 'read', created_at: ago(1300), body: 'Of course David, your advisor will call you within a few minutes.' }),
      msg({ direction: 'outbound', is_automated: 0, user_id: 'u-layla', user_name: 'Layla Hassan', channel: 'note', status: 'sent', created_at: ago(1280), body: 'Spoke for 20 minutes. Cash buyer, wants a penthouse with a full sea view. Sending the EOI today.' }),
      msg({ direction: 'outbound', is_automated: 0, user_id: 'u-layla', user_name: 'Layla Hassan', channel: 'email', subject: 'Emaar Beachfront — EOI and unit availability', status: 'delivered', created_at: ago(1270), body: 'Hi David,\n\nAs discussed, the EOI form is attached along with the penthouse availability for Tower 2.\n\nLayla' }),
      msg({ direction: 'outbound', is_automated: 1, template_name: 'followup_24h_en', status: 'failed', error_message: 'Message not sent due to marketing limits', created_at: ago(60), body: 'Hi David, units at Emaar Beachfront start from AED 1,850,000 with a developer payment plan.' }),
    ],
    events: [
      { id: 'e-3', type: 'stage.changed', title: 'Stage moved from engaged_qualified to deal_sent', body: null, created_at: ago(1265) },
      { id: 'e-4', type: 'sla.breached', title: 'WhatsApp send failed — falling back to email', body: 'Meta marketing limits (131049)', created_at: ago(60) },
    ],
  },
  'cv-7': {
    id: 'cv-7',
    contactId: 'c-7',
    messages: [
      msg({ direction: 'outbound', is_automated: 1, template_name: 'lead_welcome_ar', status: 'read', created_at: ago(94), body: 'مرحباً مريم، شكراً لاهتمامك بمشروع شمس أبوظبي. اسمي بريا نair من إمير العقارية وسأتابع طلبك شخصياً.' }),
      msg({ created_at: ago(60), body: 'كم السعر؟' }),
      msg({ direction: 'outbound', is_automated: 1, status: 'delivered', created_at: ago(60), body: 'شمس أبوظبي — الدار\nتبدأ الأسعار من 1,200,000 درهم.\nخطة السداد: 60/40 عند التسليم\nالتسليم: الربع الأول 2027' }),
      msg({ created_at: ago(12), body: 'هل يوجد وحدات بإطلالة على البحر؟' }),
      msg({ created_at: ago(11), body: 'وهل يمكن الحجز هذا الأسبوع؟' }),
    ],
    events: [{ id: 'e-5', type: 'intent.resolved', title: 'Intent: PRICING', body: 'Matched "السعر"', created_at: ago(60) }],
  },
};

/** Threads without hand-written messages still get a plausible one. */
export function fallbackThread(lead: Lead): Thread {
  return {
    id: lead.conversationId,
    contactId: lead.contactId,
    messages: [
      msg({
        direction: 'outbound',
        is_automated: 1,
        template_name: `lead_welcome_${lead.language === 'ar' ? 'ar' : 'en'}`,
        status: 'delivered',
        created_at: ago(lead.createdMinutesAgo - 1),
        body:
          lead.language === 'ar'
            ? `مرحباً ${lead.name.split(' ')[0]}، شكراً لاهتمامك بمشروع ${lead.project ?? 'مشاريعنا'}.`
            : `Hello ${lead.name.split(' ')[0]}, thank you for your interest in ${lead.project ?? 'our projects'}.`,
      }),
    ],
    events: [],
  };
}

export type PreviewTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejected_reason: string | null;
  last_synced_at: string | null;
};

export const TEMPLATES: PreviewTemplate[] = [
  { id: 't-1', name: 'lead_welcome_en', language: 'en', category: 'MARKETING', status: 'APPROVED', rejected_reason: null, last_synced_at: ago(55) },
  { id: 't-2', name: 'lead_welcome_ar', language: 'ar', category: 'MARKETING', status: 'APPROVED', rejected_reason: null, last_synced_at: ago(55) },
  { id: 't-3', name: 'followup_2h_en', language: 'en', category: 'MARKETING', status: 'APPROVED', rejected_reason: null, last_synced_at: ago(55) },
  { id: 't-4', name: 'followup_2h_ar', language: 'ar', category: 'MARKETING', status: 'APPROVED', rejected_reason: null, last_synced_at: ago(55) },
  { id: 't-5', name: 'followup_24h_en', language: 'en', category: 'MARKETING', status: 'PAUSED', rejected_reason: 'Quality rating dropped to Red', last_synced_at: ago(55) },
  { id: 't-6', name: 'followup_24h_ar', language: 'ar', category: 'MARKETING', status: 'APPROVED', rejected_reason: null, last_synced_at: ago(55) },
  { id: 't-7', name: 'followup_3d_en', language: 'en', category: 'MARKETING', status: 'APPROVED', rejected_reason: null, last_synced_at: ago(55) },
  { id: 't-8', name: 'followup_3d_ar', language: 'ar', category: 'MARKETING', status: 'APPROVED', rejected_reason: null, last_synced_at: ago(55) },
  { id: 't-9', name: 'appointment_confirm_en', language: 'en', category: 'UTILITY', status: 'APPROVED', rejected_reason: null, last_synced_at: ago(55) },
  { id: 't-10', name: 'appointment_reminder_en', language: 'en', category: 'UTILITY', status: 'APPROVED', rejected_reason: null, last_synced_at: ago(55) },
  { id: 't-11', name: 'agent_new_lead_alert_en', language: 'en', category: 'UTILITY', status: 'APPROVED', rejected_reason: null, last_synced_at: ago(55) },
  { id: 't-12', name: 'new_launch_alert_en', language: 'en', category: 'MARKETING', status: 'PENDING', rejected_reason: null, last_synced_at: ago(55) },
];

export const UNMAPPED_QUESTIONS = [
  { field: 'do_you_own_property_in_the_uae?', count: 34, sample: 'No' },
  { field: 'preferred_floor', count: 19, sample: 'High floor' },
  { field: 'how_did_you_hear_about_us?', count: 11, sample: 'Instagram' },
];

export const STAGES = [
  { key: 'new_lead', name: 'New Lead', position: 1, isWon: false, isLost: false, subStatuses: ['raw', 'invalid', 'duplicate'] },
  { key: 'attempted_contact', name: 'Attempted Contact', position: 2, isWon: false, isLost: false, subStatuses: ['attempt_1', 'attempt_2', 'attempt_3', 'attempt_4', 'attempt_5', 'attempt_6', 'no_answer', 'wrong_number'] },
  { key: 'engaged_qualified', name: 'Engaged / Qualified', position: 3, isWon: false, isLost: false, subStatuses: ['engaged', 'qualified', 'nurture'] },
  { key: 'appointment_scheduled', name: 'Appointment Scheduled', position: 4, isWon: false, isLost: false, subStatuses: ['booked', 'confirmed', 'showed', 'no_show'] },
  { key: 'deal_sent', name: 'Deal Sent', position: 5, isWon: false, isLost: false, subStatuses: ['eoi_sent', 'eoi_signed', 'awaiting_payment'] },
  { key: 'won', name: 'Won', position: 6, isWon: true, isLost: false, subStatuses: ['reserved', 'spa_signed', 'commission_received'] },
  { key: 'lost', name: 'Lost', position: 7, isWon: false, isLost: true, subStatuses: [] },
];

export const LOST_REASONS = ['not_interested', 'budget_mismatch', 'bought_elsewhere', 'unresponsive', 'invalid'];

export { ago };

/* ── Tasks, automations and the dashboard ─────────────────────────────── */

export type PreviewTask = {
  id: string;
  type: 'call' | 'whatsapp' | 'email' | 'meeting' | 'other';
  title: string;
  notes: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  dueMinutesFromNow: number;
  completed: boolean;
  leadId: string | null;
};

export const TASKS: PreviewTask[] = [
  { id: 't-1', type: 'call', title: 'Call back — asked for the payment plan', notes: 'Prefers a call after 6 PM.', priority: 'urgent', dueMinutesFromNow: -95, completed: false, leadId: 'o-1' },
  { id: 't-2', type: 'call', title: 'Follow-up call (Workflow B, +2h)', notes: null, priority: 'normal', dueMinutesFromNow: -40, completed: false, leadId: 'o-3' },
  { id: 't-3', type: 'whatsapp', title: 'Send the Saadiyat brochure', notes: null, priority: 'normal', dueMinutesFromNow: 55, completed: false, leadId: 'o-4' },
  { id: 't-4', type: 'meeting', title: 'Site visit — confirm the time', notes: 'Sales centre, Dubai Hills.', priority: 'high', dueMinutesFromNow: 220, completed: false, leadId: 'o-2' },
  { id: 't-5', type: 'email', title: 'Email the floor plans', notes: null, priority: 'low', dueMinutesFromNow: 1450, completed: false, leadId: 'o-5' },
  { id: 't-6', type: 'call', title: 'Qualification call', notes: null, priority: 'normal', dueMinutesFromNow: -1500, completed: true, leadId: 'o-6' },
];

export const AUTOMATIONS = [
  {
    key: 'workflow_a',
    name: 'Workflow A — Instant capture',
    description: 'Assign, send the welcome template and push the agent, inside 30 seconds.',
    isActive: true,
    runs: { running: 3, completed: 184, cancelled: 0, failed: 0 },
    lastRunMinutesAgo: 4,
  },
  {
    key: 'workflow_b',
    name: 'Workflow B — No-response follow-up',
    description: '+2h, +24h, +72h templates and call tasks, then Lost at +96h. Cancels itself when the lead replies.',
    isActive: true,
    runs: { running: 11, completed: 92, cancelled: 41, failed: 1 },
    lastRunMinutesAgo: 26,
  },
  {
    key: 'workflow_c',
    name: 'Workflow C — Inbound WhatsApp routing',
    description: 'Reads intent, answers pricing from verified projects, sends the location or brochure, flags CALL_ME.',
    isActive: true,
    runs: { running: 0, completed: 311, cancelled: 2, failed: 0 },
    lastRunMinutesAgo: 1,
  },
  {
    key: 'capi_feedback',
    name: 'Ad platform feedback',
    description: 'Reports lead quality back to Meta and Google so the ads optimise for real buyers.',
    isActive: false,
    runs: { running: 0, completed: 0, cancelled: 0, failed: 0 },
    lastRunMinutesAgo: null,
  },
];

/** Leads per day for the dashboard's area chart, oldest first. */
export function previewSeries(days: number): { label: string; value: number; previous: number }[] {
  const out: { label: string; value: number; previous: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now - i * 86_400_000);
    // A calm, weekday-heavy shape. Deterministic, so the preview never flickers.
    const weekday = date.getUTCDay();
    const base = weekday === 5 || weekday === 6 ? 14 : 26;
    const wave = Math.round(Math.sin(i / 2.7) * 5);
    const drift = Math.round((days - i) / 6);
    const value = Math.max(4, base + wave + drift);
    out.push({
      label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      value,
      previous: Math.max(3, Math.round(value * 0.78)),
    });
  }
  return out;
}

/** The arrivals heatmap: busiest on weekday evenings, as UAE property leads are. */
export function previewArrivals(): {
  hours: string[];
  rows: { label: string; values: number[] }[];
  busiest: string;
} {
  const hours = ['8a', '10a', '12p', '2p', '4p', '6p', '8p', '10p', '12a', '2a', '4a', '6a'];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    hours,
    rows: days.map((label, r) => ({
      label,
      values: hours.map((_, c) => {
        const evening = c >= 5 && c <= 7 ? 16 : 0;
        const night = c >= 9 ? -6 : 0;
        const weekend = r >= 5 ? 5 : 0;
        return Math.max(0, Math.round(8 + evening + night + weekend + Math.sin(c / 1.7) * 4 - r));
      }),
    })),
    busiest: 'Busiest: Sun, 6–8 PM',
  };
}

/* ── Lists, campaigns, imports and teams ──────────────────────────────── */

export type PreviewList = {
  id: string;
  name: string;
  description: string | null;
  kind: 'static' | 'smart';
  filters: Record<string, unknown> | null;
  recycle_after_days: number | null;
  recycle_action: 'reassign' | 'pool' | null;
  owner_name: string | null;
  member_count: number;
  summary: string;
};

export const LISTS: PreviewList[] = [
  {
    id: 'ls-1',
    name: 'Imported — never called',
    description: 'Everything from the Expo 2026 list that nobody has phoned yet.',
    kind: 'smart',
    filters: { stages: ['new_lead'], excludeDnc: true },
    recycle_after_days: 3,
    recycle_action: 'pool',
    owner_name: null,
    member_count: 0,
    summary: 'stage new lead, excluding do-not-contact',
  },
  {
    id: 'ls-2',
    name: 'Hot — Abu Dhabi',
    description: 'Scoring 70 or more, Saadiyat and Yas.',
    kind: 'smart',
    filters: { minScore: 70, emirates: ['abu_dhabi'] },
    recycle_after_days: null,
    recycle_action: null,
    owner_name: 'Layla Hassan',
    member_count: 0,
    summary: 'scoring 70+, excluding do-not-contact',
  },
  {
    id: 'ls-3',
    name: 'Golden Visa shortlist',
    description: 'Hand-picked for the AED 2M+ campaign.',
    kind: 'static',
    filters: null,
    recycle_after_days: null,
    recycle_action: null,
    owner_name: 'Emir Dulovic',
    member_count: 4,
    summary: '4 contacts',
  },
];

export type PreviewCampaign = {
  id: string;
  name: string;
  kind: 'call' | 'whatsapp';
  status: 'draft' | 'running' | 'paused' | 'completed' | 'cancelled';
  total_members: number;
  skipped_no_consent: number;
  template_name: string | null;
  paused_reason: string | null;
  list_name: string | null;
  done_count: number;
  startedMinutesAgo: number;
};

export const CAMPAIGNS: PreviewCampaign[] = [
  {
    id: 'cp-1',
    name: 'Reactivation calls',
    kind: 'call',
    status: 'running',
    total_members: 6,
    skipped_no_consent: 0,
    template_name: null,
    paused_reason: null,
    list_name: 'Imported — never called',
    done_count: 2,
    startedMinutesAgo: 95,
  },
  {
    id: 'cp-2',
    name: 'New launch — Saadiyat Grove',
    kind: 'whatsapp',
    status: 'paused',
    total_members: 128,
    skipped_no_consent: 412,
    template_name: 'new_launch_alert',
    paused_reason:
      'WhatsApp quality rating is YELLOW. Sending stopped to protect the number.',
    list_name: 'Hot — Abu Dhabi',
    done_count: 44,
    startedMinutesAgo: 320,
  },
];

export const IMPORTS = [
  {
    id: 'im-1',
    filename: 'expo-2026-leads.csv',
    file_kind: 'csv',
    status: 'completed' as const,
    total_rows: 252,
    processed_rows: 252,
    created_count: 250,
    updated_count: 0,
    skipped_count: 2,
    failed_count: 0,
    created_by: 'Emir Dulovic',
    createdMinutesAgo: 140,
  },
  {
    id: 'im-2',
    filename: 'portal-export.xlsx',
    file_kind: 'xlsx',
    status: 'completed' as const,
    total_rows: 1840,
    processed_rows: 1840,
    created_count: 1502,
    updated_count: 301,
    skipped_count: 31,
    failed_count: 6,
    created_by: 'Emir Dulovic',
    createdMinutesAgo: 2880,
  },
];

export const TEAMS = [
  {
    id: 'tm-1',
    name: 'Arabic desk',
    description: 'Arabic-speaking buyers, all emirates.',
    manager_name: 'Emir Dulovic',
    members: [
      { userId: 'u-omar', name: 'Omar Farouk', openLeads: 38 },
      { userId: 'u-layla', name: 'Layla Hassan', openLeads: 41 },
    ],
  },
  {
    id: 'tm-2',
    name: 'Abu Dhabi team',
    description: 'Saadiyat, Yas and Al Reem.',
    manager_name: 'Emir Dulovic',
    members: [{ userId: 'u-priya', name: 'Priya Nair', openLeads: 26 }],
  },
];

/** The lead the dialler is showing, and the queue behind it. */
export const DIALLER_QUEUE = LEADS.slice(0, 6).map((lead, index) => ({
  memberId: `cm-${index + 1}`,
  leadId: lead.id,
  done: index < 2,
  outcome: index === 0 ? ('interested' as const) : index === 1 ? ('no_answer' as const) : null,
}));
