export type Role = 'owner' | 'admin' | 'manager' | 'agent' | 'automation';

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  locale: string;
  availability: 'available' | 'busy' | 'off';
  mustChangePassword: boolean;
  permissions: string[];
};

export type StageKey =
  | 'new_lead'
  | 'attempted_contact'
  | 'engaged_qualified'
  | 'appointment_scheduled'
  | 'deal_sent'
  | 'won'
  | 'lost';

export type StageDefinition = {
  key: StageKey;
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  subStatuses: string[];
};

export type PipelineDefinition = {
  pipelineKey: string;
  stages: StageDefinition[];
  lostReasons: string[];
};

export type Card = {
  id: string;
  title: string | null;
  stage_key: StageKey;
  sub_status: string | null;
  status: 'open' | 'won' | 'lost';
  owner_user_id: string | null;
  owner_name: string | null;
  project_name: string | null;
  budget_min_aed: number | null;
  budget_max_aed: number | null;
  budget_band: string | null;
  unit_type: string | null;
  emirate: string | null;
  timeline: string | null;
  lead_score: number;
  source: string;
  campaign_name: string | null;
  created_at: string;
  stage_changed_at: string;
  sla_breached: number;
  contact_id: string;
  full_name: string | null;
  phone_e164: string | null;
  wa_id: string | null;
  email: string | null;
  language: string | null;
  last_inbound_at: string | null;
  dnc: number;
};

export type BoardColumn = {
  stageKey: StageKey;
  stageName: string;
  position: number;
  total: number;
  cards: Card[];
};

export type Conversation = {
  id: string;
  contact_id: string;
  assigned_user_id: string | null;
  assignee_name: string | null;
  status: string;
  unread_count: number;
  last_message_at: string | null;
  last_inbound_at: string | null;
  wa_window_expires_at: string | null;
  full_name: string | null;
  phone_e164: string | null;
  email: string | null;
  language: string | null;
  lead_score: number;
  dnc: number;
  last_body: string | null;
  last_channel: string | null;
  last_direction: string | null;
  stage_key: StageKey | null;
};

export type Message = {
  id: string;
  channel: 'whatsapp' | 'email' | 'sms' | 'note' | 'system';
  direction: 'inbound' | 'outbound';
  provider: string | null;
  user_id: string | null;
  user_name: string | null;
  is_automated: number;
  template_name: string | null;
  subject: string | null;
  body: string | null;
  media: unknown;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
};

export type ThreadResponse = {
  conversation: Conversation & {
    whatsappWindowOpen: boolean;
    whatsappWindowExpiresAt: string | null;
    composerMode: 'free_form' | 'template_only';
    replyLock: { userId: string; expiresAt: string } | null;
  };
  messages: Message[];
  events: Array<{ id: string; type: string; title: string; body: string | null; created_at: string }>;
};

export type Contact360 = {
  contact: Record<string, unknown> & {
    id: string;
    full_name: string | null;
    phone_e164: string | null;
    email: string | null;
    language: string;
    lead_score: number;
    dnc: number;
    ai_summary: string | null;
    owner_name: string | null;
    notes: string | null;
  };
  opportunities: Array<Record<string, unknown> & { id: string; stage_key: StageKey; status: string }>;
  activities: Array<{ id: string; type: string; title: string; body: string | null; created_at: string; user_name: string | null }>;
  tasks: Array<{ id: string; type: string; title: string; due_at: string; completed_at: string | null; priority: string }>;
  tags: string[];
  consents: Array<{ channel: string; granted: number; source: string; consent_text: string | null; created_at: string }>;
  conversation: { id: string; wa_window_expires_at: string | null } | null;
  aiSuggestions: Array<{ id: string; field: string; value: string; status: string }>;
};

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: number;
  availability: 'available' | 'busy' | 'off';
  routing_weight: number;
  languages: string[] | null;
  projects_covered: string[] | null;
  manager_id: string | null;
  last_login_at: string | null;
};

export type ProjectRow = {
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

export type TemplateRow = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejected_reason: string | null;
  last_synced_at: string | null;
};

/* ── Dashboard ────────────────────────────────────────────────────────── */

export type Kpi = {
  value: number;
  previous: number;
  /** Eight daily points for the sparkline, oldest first. */
  spark: number[];
};

export type DashboardResponse = {
  range: { days: number; from: string; to: string };
  kpis: {
    newLeads: Kpi;
    whatsappRepliedPct: Kpi;
    appointments: Kpi;
    reservations: Kpi & { pipelineValueAed: number };
  };
  series: { label: string; value: number; previous: number }[];
  sources: { label: string; value: number; colour: string }[];
  totalLeads: number;
  funnel: { label: string; value: number }[];
  speedToLead: {
    medianSeconds: number | null;
    targetSeconds: number;
    maxSeconds: number;
    slaBreaches: number;
  };
  arrivals: {
    hours: string[];
    rows: { label: string; values: number[] }[];
    busiest: string | null;
  };
  leaderboard: {
    userId: string;
    name: string;
    initials: string;
    medianFirstReplySeconds: number | null;
    qualified: number;
    deals: number;
  }[];
};

/* ── Tasks ────────────────────────────────────────────────────────────── */

export type TaskScope = 'mine' | 'team' | 'all';
export type TaskFilter = 'open' | 'overdue' | 'today' | 'done';

export type TaskRow = {
  id: string;
  type: 'call' | 'whatsapp' | 'email' | 'meeting' | 'other';
  title: string;
  notes: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  due_at: string;
  completed_at: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  full_name: string | null;
  phone_e164: string | null;
  lead_score: number | null;
  stage_key: StageKey | null;
  project_name: string | null;
  assigned_user_id: string | null;
  assignee_name: string | null;
};

export type TasksResponse = {
  items: TaskRow[];
  counts: { overdue: number; today: number; open: number; done: number };
};

/* ── Automations ──────────────────────────────────────────────────────── */

export type AutomationRow = {
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  runs: { running: number; completed: number; cancelled: number; failed: number };
  lastRunAt: string | null;
};
