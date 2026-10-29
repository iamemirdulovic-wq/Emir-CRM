-- 0002: immutable ingestion log, conversations, messages, templates, jobs, workflows.

-- Every webhook payload is stored verbatim before any processing. The unique
-- key on (source, external_id) is what makes replays idempotent.
CREATE TABLE inbound_events (
  id              varchar(36)     NOT NULL PRIMARY KEY,
  source          VARCHAR(48)  NOT NULL,
  external_id     VARCHAR(191) NOT NULL,
  signature_valid smallint   NOT NULL DEFAULT 0,
  raw_payload     jsonb         NOT NULL,
  headers         jsonb         NULL,
  received_at     timestamptz(3)  NOT NULL DEFAULT now(),
  processed_at    timestamptz(3)  NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','processed','duplicate','failed','ignored')),
  error           TEXT         NULL,
  contact_id      varchar(36)     NULL,
  opportunity_id  varchar(36)     NULL,
  CONSTRAINT uq_inbound_source_external UNIQUE (source, external_id)
);

-- One thread per contact, mixing every channel.
CREATE TABLE conversations (
  id                varchar(36)    NOT NULL PRIMARY KEY,
  contact_id        varchar(36)    NOT NULL,
  assigned_user_id  varchar(36)    NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','snoozed','closed')),
  last_message_at   timestamptz(3) NULL,
  last_inbound_at   timestamptz(3) NULL,
  last_outbound_at  timestamptz(3) NULL,
  /* WhatsApp 24-hour customer service window opens on every inbound message. */
  wa_window_expires_at timestamptz(3) NULL,
  unread_count      bigint NOT NULL DEFAULT 0,
  /* Collision guard: "X is replying…" soft lock. */
  reply_lock_user_id varchar(36)   NULL,
  reply_lock_expires_at timestamptz(3) NULL,
  created_at        timestamptz(3) NOT NULL DEFAULT now(),
  updated_at        timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT uq_conversation_contact UNIQUE (contact_id),
  CONSTRAINT fk_conversation_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_user FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE messages (
  id              varchar(36)     NOT NULL PRIMARY KEY,
  conversation_id varchar(36)     NOT NULL,
  contact_id      varchar(36)     NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','sms','note','system')),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  provider        VARCHAR(32)  NULL,
  provider_message_id VARCHAR(191) NULL,
  user_id         varchar(36)     NULL,
  is_automated    smallint   NOT NULL DEFAULT 0,
  template_name   VARCHAR(120) NULL,
  template_language VARCHAR(16) NULL,
  subject         VARCHAR(512) NULL,
  body            text   NULL,
  media           jsonb         NULL,
  payload         jsonb         NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','read','failed','received')),
  error_code      VARCHAR(64)  NULL,
  error_message   VARCHAR(512) NULL,
  sent_at         timestamptz(3)  NULL,
  delivered_at    timestamptz(3)  NULL,
  read_at         timestamptz(3)  NULL,
  created_at      timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_message_provider UNIQUE (provider, provider_message_id),
  CONSTRAINT fk_message_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_message_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_message_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE wa_templates (
  id            varchar(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  language      VARCHAR(16)  NOT NULL,
  category text NOT NULL CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED','PAUSED','DISABLED')),
  provider_template_id VARCHAR(64) NULL,
  components    jsonb         NOT NULL,
  quality_score VARCHAR(32)  NULL,
  rejected_reason VARCHAR(255) NULL,
  last_synced_at timestamptz(3) NULL,
  created_at    timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at    timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_template_name_lang UNIQUE (name, language)
);

CREATE TABLE activities (
  id             varchar(36)     NOT NULL PRIMARY KEY,
  contact_id     varchar(36)     NULL,
  opportunity_id varchar(36)     NULL,
  user_id        varchar(36)     NULL,
  type           VARCHAR(48)  NOT NULL,
  title          VARCHAR(255) NOT NULL,
  body           TEXT         NULL,
  meta           jsonb         NULL,
  created_at     timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_activity_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_activity_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE tasks (
  id             varchar(36)     NOT NULL PRIMARY KEY,
  contact_id     varchar(36)     NULL,
  opportunity_id varchar(36)     NULL,
  assigned_user_id varchar(36)   NULL,
  created_by_user_id varchar(36) NULL,
  type text NOT NULL DEFAULT 'call' CHECK (type IN ('call','whatsapp','email','meeting','other')),
  title          VARCHAR(255) NOT NULL,
  notes          TEXT         NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  due_at         timestamptz(3)  NOT NULL,
  completed_at   timestamptz(3)  NULL,
  completed_by_user_id varchar(36) NULL,
  created_at     timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_task_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_task_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT fk_task_assignee FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- Tags use the namespace:value format (src:, proj:, lang:, intent:).
CREATE TABLE tags (
  id         varchar(36)     NOT NULL PRIMARY KEY,
  namespace  VARCHAR(32)  NOT NULL,
  value      VARCHAR(120) NOT NULL,
  label      VARCHAR(160) NULL,
  color      VARCHAR(16)  NULL,
  created_at timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_tag UNIQUE (namespace, value)
);

CREATE TABLE contact_tags (
  contact_id varchar(36)    NOT NULL,
  tag_id     varchar(36)    NOT NULL,
  added_by_user_id varchar(36) NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, tag_id),
  CONSTRAINT fk_contact_tags_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_contact_tags_tag FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
);

-- UAE PDPL: store the exact consent text that was shown to the lead.
CREATE TABLE consents (
  id           varchar(36)     NOT NULL PRIMARY KEY,
  contact_id   varchar(36)     NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','sms','calls','all')),
  granted      smallint   NOT NULL,
  source       VARCHAR(48)  NOT NULL,
  consent_text TEXT         NULL,
  evidence     jsonb         NULL,
  ip           VARCHAR(64)  NULL,
  created_at   timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_consent_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
);

-- Do-not-contact entries keyed by identifier, so a STOP survives contact merges
-- and applies before a contact record even exists.
CREATE TABLE suppressions (
  id         varchar(36)     NOT NULL PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('phone','email','wa_id')),
  value      VARCHAR(255) NOT NULL,
  reason     VARCHAR(160) NOT NULL DEFAULT 'user_opt_out',
  created_by_user_id varchar(36) NULL,
  created_at timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_suppression UNIQUE (kind, value)
);

-- The verified off-plan library. Prices and plans may only come from here.
CREATE TABLE projects (
  id             varchar(36)     NOT NULL PRIMARY KEY,
  slug           VARCHAR(120) NOT NULL,
  name           VARCHAR(160) NOT NULL,
  developer      VARCHAR(160) NOT NULL,
  emirate text NOT NULL CHECK (emirate IN ('dubai','abu_dhabi','sharjah','ras_al_khaimah','ajman','fujairah','umm_al_quwain','other')),
  area           VARCHAR(160) NULL,
  unit_types     jsonb         NULL,
  starting_price_aed bigint NULL,
  price_per_sqft_aed bigint NULL,
  payment_plan   VARCHAR(255) NULL,
  handover_date  VARCHAR(48)  NULL,
  golden_visa_eligible smallint NOT NULL DEFAULT 0,
  brochure_url   VARCHAR(1024) NULL,
  image_url      VARCHAR(1024) NULL,
  location_lat   numeric(10,7) NULL,
  location_lng   numeric(10,7) NULL,
  location_label VARCHAR(255) NULL,
  description    TEXT         NULL,
  is_active      smallint   NOT NULL DEFAULT 1,
  verified_at    timestamptz(3)  NULL,
  verified_by_user_id varchar(36) NULL,
  created_at     timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at     timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_project_slug UNIQUE (slug)
);

-- Custom lead-form questions are mapped here, never hard-coded.
CREATE TABLE form_field_map (
  id             varchar(36)     NOT NULL PRIMARY KEY,
  source         VARCHAR(48)  NOT NULL,
  form_id        VARCHAR(64)  NULL,
  external_field VARCHAR(255) NOT NULL,
  crm_field      VARCHAR(80)  NOT NULL,
  transform      VARCHAR(48)  NULL,
  value_map      jsonb         NULL,
  notes          VARCHAR(255) NULL,
  created_at     timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at     timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_form_field UNIQUE (source, form_id, external_field)
);

CREATE TABLE workflows (
  id          varchar(36)     NOT NULL PRIMARY KEY,
  "key"       VARCHAR(48)  NOT NULL,
  name        VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  is_active   smallint   NOT NULL DEFAULT 1,
  definition  jsonb         NULL,
  created_at  timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at  timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_workflow_key UNIQUE ("key")
);

CREATE TABLE workflow_runs (
  id             varchar(36)     NOT NULL PRIMARY KEY,
  workflow_key   VARCHAR(48)  NOT NULL,
  contact_id     varchar(36)     NULL,
  opportunity_id varchar(36)     NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','cancelled','failed')),
  current_step   VARCHAR(64)  NULL,
  context        jsonb         NULL,
  cancel_reason  VARCHAR(160) NULL,
  started_at     timestamptz(3)  NOT NULL DEFAULT now(),
  finished_at    timestamptz(3)  NULL,
  CONSTRAINT fk_run_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_run_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE
);

-- Background work. Polled by the worker; "dedupe_key" keeps replays harmless.
CREATE TABLE jobs (
  id            varchar(36)     NOT NULL PRIMARY KEY,
  type          VARCHAR(64)  NOT NULL,
  payload       jsonb         NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','cancelled')),
  priority      smallint      NOT NULL DEFAULT 5,
  run_at        timestamptz(3)  NOT NULL DEFAULT now(),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5,
  dedupe_key    VARCHAR(191) NULL,
  workflow_run_id varchar(36)   NULL,
  contact_id    varchar(36)     NULL,
  locked_by     VARCHAR(64)  NULL,
  locked_at     timestamptz(3)  NULL,
  last_error    TEXT         NULL,
  result        jsonb         NULL,
  created_at    timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at    timestamptz(3)  NOT NULL DEFAULT now(),
  finished_at   timestamptz(3)  NULL,
  CONSTRAINT uq_job_dedupe UNIQUE (dedupe_key)
);


-- Indexes (MySQL declares these inside CREATE TABLE).
CREATE INDEX idx_inbound_status ON inbound_events (status, received_at);
CREATE INDEX idx_inbound_received ON inbound_events (received_at);
CREATE INDEX idx_conversation_assigned ON conversations (assigned_user_id, status);
CREATE INDEX idx_conversation_last_message ON conversations (last_message_at);
CREATE INDEX idx_message_conversation ON messages (conversation_id, created_at);
CREATE INDEX idx_message_contact ON messages (contact_id, created_at);
CREATE INDEX idx_message_automated ON messages (contact_id, is_automated, created_at);
CREATE INDEX idx_template_status ON wa_templates (status);
CREATE INDEX idx_activity_contact ON activities (contact_id, created_at);
CREATE INDEX idx_activity_opportunity ON activities (opportunity_id, created_at);
CREATE INDEX idx_activity_user ON activities (user_id, created_at);
CREATE INDEX idx_activity_type ON activities (type, created_at);
CREATE INDEX idx_task_assignee_due ON tasks (assigned_user_id, completed_at, due_at);
CREATE INDEX idx_task_contact ON tasks (contact_id);
CREATE INDEX idx_task_opportunity ON tasks (opportunity_id);
CREATE INDEX idx_contact_tags_tag ON contact_tags (tag_id);
CREATE INDEX idx_consent_contact_channel ON consents (contact_id, channel, created_at);
CREATE INDEX idx_project_active ON projects (is_active, emirate);
CREATE INDEX idx_form_field_form ON form_field_map (source, form_id);
CREATE INDEX idx_run_workflow_contact ON workflow_runs (workflow_key, contact_id, status);
CREATE INDEX idx_run_status ON workflow_runs (status, started_at);
CREATE INDEX idx_run_opportunity ON workflow_runs (opportunity_id);
CREATE INDEX idx_job_claim ON jobs (status, run_at, priority);
CREATE INDEX idx_job_workflow_run ON jobs (workflow_run_id);
CREATE INDEX idx_job_contact ON jobs (contact_id, type, status);

-- MySQL refreshes updated_at by itself; Postgres needs to be asked.
CREATE TRIGGER conversations_set_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER wa_templates_set_updated_at BEFORE UPDATE ON wa_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER form_field_map_set_updated_at BEFORE UPDATE ON form_field_map
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workflows_set_updated_at BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER jobs_set_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
