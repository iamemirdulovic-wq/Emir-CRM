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

/** A file on a task card: a floor plan, a portal screenshot, a photo of a cheque. */
export type TaskAttachment = {
  id: string;
  task_id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  created_at: string;
};

export type TaskCounts = { overdue: number; today: number; open: number; done: number };

export type TasksResponse = {
  items: TaskRow[];
  counts: TaskCounts;
  /** Flat, for every task in `items` — one query on the server, grouped here. */
  attachments: TaskAttachment[];
};

export type TaskCalendarResponse = {
  items: TaskRow[];
  attachments: TaskAttachment[];
};

/** What the create/edit form sends. `dueAt` is an ISO instant, not a local string. */
export type TaskDraft = {
  title: string;
  notes: string | null;
  type: TaskRow['type'];
  priority: TaskRow['priority'];
  dueAt: string;
  assignedUserId: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
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

/* ── Bulk import ──────────────────────────────────────────────────────── */

export type ImportField =
  | 'fullName' | 'firstName' | 'lastName' | 'phone' | 'altPhone' | 'email' | 'language'
  | 'projectName' | 'developer' | 'emirate' | 'preferredLocation' | 'unitType'
  | 'budgetMinAed' | 'budgetMaxAed' | 'budgetBand' | 'purpose' | 'paymentMethod' | 'timeline'
  | 'goldenVisaInterest' | 'source' | 'campaignName' | 'notes' | 'tags' | 'ownerEmail' | 'createdAt';

export type ColumnMapping = Record<string, ImportField | null>;

export type ConsentStatus = 'opted_in' | 'unknown' | 'none';
export type DuplicateStrategy = 'skip' | 'fill_empty' | 'create_anyway';

export type ImportSettings = {
  sourceLabel: string;
  source: string;
  tags: string[];
  projectName: string | null;
  pipelineKey: string;
  stageKey: string;
  consent: ConsentStatus;
  duplicateStrategy: DuplicateStrategy;
  phoneRegion: string;
};

export type UploadResponse = {
  id: string;
  filename: string;
  kind: 'csv' | 'xlsx' | 'paste';
  bytes?: number;
  headers: string[];
  preview: string[][];
  suggestedMapping: ColumnMapping;
  /**
   * True when the file had no header row and the columns were named by
   * position. The wizard says so, because "Column 7" only means anything
   * beside the values under it.
   */
  generatedHeaders?: boolean;
  defaults: ImportSettings;
};

export type ImportStatus =
  | 'uploaded' | 'mapping' | 'validating' | 'ready' | 'importing' | 'completed' | 'failed' | 'undone';

export type ImportRecord = {
  id: string;
  filename: string;
  file_kind: string;
  status: ImportStatus;
  total_rows: number;
  processed_rows: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  headers: unknown;
  mapping: unknown;
  settings: unknown;
  assignment: unknown;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  undo_deadline_at: string | null;
  undone_at: string | null;
  created_at: string;
};

export type ImportDetail = {
  import: ImportRecord;
  problems: { line_number: number; status: string; reason: string | null }[];
  undoWindowHours: number;
};

/* ── Assignment ───────────────────────────────────────────────────────── */

export type AssignmentMethod =
  | 'agent' | 'team_round_robin' | 'split_even' | 'split_percent' | 'by_rule' | 'pool';

export type AssignmentChoice = {
  method: AssignmentMethod;
  userId?: string | null;
  teamId?: string | null;
  shares?: { userId: string; percent: number }[];
  clauses?: {
    language?: string; project?: string; emirate?: string;
    budgetMinAed?: number; budgetMaxAed?: number; userId: string;
  }[];
};

export type AssignmentPreview = {
  leads: number;
  plan: { method: string; counts: { userId: string; name: string; before: number; after: number }[] };
  pooled: number;
  unmatched: number;
  warnings: { userId: string; name: string; after: number; average: number }[];
};

export type AssignmentCandidate = {
  userId: string;
  name: string;
  languages: string[];
  projectsCovered: string[];
  openLeads: number;
  isEligible: boolean;
};

/* ── Teams and the pool ───────────────────────────────────────────────── */

export type TeamRow = {
  id: string;
  name: string;
  description: string | null;
  manager_name: string | null;
  members: { userId: string; name: string; openLeads: number }[];
};

export type PoolStatus = {
  available: number;
  claimedByYou: number;
  maxOpenClaims: number;
  claimed: {
    opportunity_id: string;
    contact_id: string;
    claimed_at: string;
    full_name: string | null;
    phone_e164: string | null;
    lead_score: number;
    stage_key: StageKey | null;
    project_name: string | null;
  }[];
};

/* ── Lists ────────────────────────────────────────────────────────────── */

export type ListFilter = {
  search?: string;
  sources?: string[];
  stages?: StageKey[];
  tags?: string[];
  projects?: string[];
  languages?: string[];
  emirates?: string[];
  ownerUserIds?: string[];
  unassignedOnly?: boolean;
  budgetMinAed?: number;
  budgetMaxAed?: number;
  minScore?: number;
  notContactedForDays?: number;
  createdWithinDays?: number;
  hasWhatsAppConsent?: boolean;
  excludeDnc?: boolean;
};

export type ListRow = {
  id: string;
  name: string;
  description: string | null;
  kind: 'static' | 'smart';
  filters: unknown;
  recycle_after_days: number | null;
  recycle_action: 'reassign' | 'pool' | null;
  created_at: string;
  owner_name: string | null;
  member_count: number;
  summary: string;
};

export type ListMemberRow = {
  contact_id: string;
  opportunity_id: string | null;
  full_name: string | null;
  phone_e164: string | null;
  email: string | null;
  language: string | null;
  lead_score: number;
  dnc: number;
  owner_user_id: string | null;
  owner_name: string | null;
  stage_key: StageKey | null;
  project_name: string | null;
  budget_band: string | null;
  last_inbound_at: string | null;
};

/* ── Campaigns ────────────────────────────────────────────────────────── */

export type CampaignOutcome =
  | 'answered' | 'no_answer' | 'busy' | 'wrong_number' | 'not_interested' | 'interested';

export type CampaignRow = {
  id: string;
  name: string;
  kind: 'call' | 'whatsapp';
  status: 'draft' | 'running' | 'paused' | 'completed' | 'cancelled';
  total_members: number;
  skipped_no_consent: number;
  template_name: string | null;
  paused_reason: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  list_name: string | null;
  done_count: number;
};

export type DiallerCard = {
  memberId: string;
  contactId: string;
  opportunityId: string | null;
  fullName: string | null;
  phone: string | null;
  language: string | null;
  leadScore: number;
  projectName: string | null;
  budgetBand: string | null;
  budgetMinAed: number | null;
  budgetMaxAed: number | null;
  stageKey: StageKey | null;
  lastContactedAt: string | null;
  attempts: number;
  progress: { done: number; total: number };
};

export type CampaignStats = {
  total: number;
  done: number;
  pending: number;
  skipped: number;
  contactedPct: number;
  reachedPct: number;
  interested: number;
  appointments: number;
  byAgent: { userId: string | null; name: string | null; done: number; reached: number; interested: number }[];
  outcomes: { outcome: string; n: number }[];
};

export type CampaignDetail = {
  campaign: CampaignRow & Record<string, unknown>;
  stats: CampaignStats;
};

/* ── Project library ──────────────────────────────────────────────────── */

export type SaleStatus = 'selling_now' | 'coming_soon' | 'sold_out';
export type UnitStatus = 'available' | 'on_hold' | 'reserved' | 'sold';
export type Visibility = 'private' | 'team' | 'public';

export type LibraryCard = {
  /** The uploaded cover, used when no image_url was typed in. */
  cover_photo_id?: string | null;
  id: string;
  slug: string;
  name: string;
  developer: string;
  developer_id: string | null;
  emirate: string;
  community: string | null;
  property_type: string | null;
  sale_status: SaleStatus;
  starting_price_aed: number | null;
  handover_date: string | null;
  payment_plan: string | null;
  image_url: string | null;
  visibility: Visibility;
  starred: number;
  verified_at: string | null;
  archived_at: string | null;
  units_available: number;
  units_total: number;
};

export type LibraryStats = {
  mostLeads: { project_name: string; leads: number } | null;
  trending: { project_name: string; rise_pct: number } | null;
  bestConverting: { project_name: string; rate_pct: number; deals: number } | null;
  inventory: { available: number; value_aed: number; top: { name: string; available: number }[] };
};

export type UnitRow = {
  id: string;
  project_id: string;
  unit_no: string;
  unit_type: string | null;
  bedrooms: number | null;
  floor: string | null;
  internal_area_sqft: string | null;
  balcony_sqft: string | null;
  view_text: string | null;
  parking: number | null;
  price_aed: number | null;
  price_per_sqft_aed: number | null;
  status: UnitStatus;
};

export type PlanRow = { id: string; seq: number; milestone: string; percent: string; due_note: string | null };
export type PaymentPlan = { id: string; project_id: string; name: string; is_default: number; note: string | null; rows: PlanRow[] };

export type DeveloperRow = {
  id: string;
  slug: string;
  legal_name: string;
  short_name: string;
  orn: string | null;
  trn: string | null;
  head_office: string | null;
  escrow_bank: string | null;
  website: string | null;
  track_record: string | null;
  /** Absent for agents — the server strips it. */
  commission_pct?: string | null;
  payment_terms?: string | null;
  project_count: number;
  contact_count: number;
};

export type DeveloperContactRow = {
  id: string;
  developer_id: string;
  name: string;
  role: string | null;
  phone_e164: string | null;
  whatsapp_e164: string | null;
  email: string | null;
  is_primary: number;
};

/** What the Add/Edit project form sends. */
export type ProjectDraft = {
  name: string;
  developerId: string | null;
  developer: string | null;
  emirate: string;
  community: string | null;
  propertyType: string | null;
  saleStatus: SaleStatus;
  startingPriceAed: number | null;
  handoverDate: string | null;
  paymentPlan: string | null;
  reraNo: string | null;
  ownership: string | null;
  serviceChargeSqft: number | null;
  goldenVisaThresholdAed: number | null;
  constructionPct: number | null;
  description: string | null;
  brochureUrl: string | null;
  imageUrl: string | null;
  visibility: Visibility;
  goldenVisaEligible: boolean;
};

/** A Gemini model the connected key can actually use, as Google reports it. */
export type GeminiModel = {
  name: string;
  displayName: string;
  description: string;
  inputTokenLimit: number | null;
};

/** What each model did when the connection check asked it a question. */
export type Diagnosis = {
  ok: boolean;
  headline: string;
  models: { model: string; works: boolean; ms: number; why: string | null }[];
  current?: string | null;
};
