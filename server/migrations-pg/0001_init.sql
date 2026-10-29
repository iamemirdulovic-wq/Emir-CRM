-- 0001_init: foundation — users, sessions, audit, contacts, pipeline, opportunities.

CREATE TABLE users (
  id            varchar(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(160) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  role text NOT NULL DEFAULT 'agent' CHECK (role IN ('owner','admin','manager','agent','automation')),
  password_hash VARCHAR(255) NOT NULL,
  password_algo text NOT NULL DEFAULT 'bcrypt' CHECK (password_algo IN ('bcrypt','argon2')),
  must_change_password smallint NOT NULL DEFAULT 1,
  is_active     smallint   NOT NULL DEFAULT 1,
  -- Routing inputs for Workflow A.
  availability text NOT NULL DEFAULT 'available' CHECK (availability IN ('available','busy','off')),
  routing_weight integer NOT NULL DEFAULT 10,
  shift_start   TIME         NULL,
  shift_end     TIME         NULL,
  languages     jsonb         NULL,
  projects_covered jsonb      NULL,
  manager_id    varchar(36)     NULL,
  phone_e164    VARCHAR(32)  NULL,
  locale        VARCHAR(8)   NOT NULL DEFAULT 'en',
  last_login_at timestamptz(3)  NULL,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until  timestamptz(3)  NULL,
  deactivated_at timestamptz(3) NULL,
  created_at    timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at    timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT fk_users_manager FOREIGN KEY (manager_id) REFERENCES users (id) ON DELETE SET NULL
);

-- Server-side sessions. We store only the SHA-256 of the cookie value.
CREATE TABLE sessions (
  id          varchar(64)     NOT NULL PRIMARY KEY,
  user_id     varchar(36)     NOT NULL,
  expires_at  timestamptz(3)  NOT NULL,
  remember_me smallint   NOT NULL DEFAULT 0,
  ip          VARCHAR(64)  NULL,
  user_agent  VARCHAR(512) NULL,
  created_at  timestamptz(3)  NOT NULL DEFAULT now(),
  last_seen_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE login_attempts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      VARCHAR(255) NOT NULL,
  ip         VARCHAR(64)  NULL,
  successful smallint   NOT NULL DEFAULT 0,
  created_at timestamptz(3)  NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id           varchar(36)     NOT NULL PRIMARY KEY,
  actor_user_id varchar(36)    NULL,
  actor_role   VARCHAR(32)  NULL,
  actor_label  VARCHAR(160) NULL,
  action       VARCHAR(80)  NOT NULL,
  entity_type  VARCHAR(48)  NOT NULL,
  entity_id    VARCHAR(64)  NULL,
  before_json  jsonb         NULL,
  after_json   jsonb         NULL,
  ip           VARCHAR(64)  NULL,
  user_agent   VARCHAR(512) NULL,
  created_at   timestamptz(3)  NOT NULL DEFAULT now()
);

-- The person. One row per human being.
CREATE TABLE contacts (
  id             varchar(36)     NOT NULL PRIMARY KEY,
  full_name      VARCHAR(200) NULL,
  first_name     VARCHAR(100) NULL,
  last_name      VARCHAR(100) NULL,
  phone_e164     VARCHAR(32)  NULL,
  wa_id          VARCHAR(32)  NULL,
  email          VARCHAR(255) NULL,
  language       VARCHAR(8)   NOT NULL DEFAULT 'en',
  country        VARCHAR(8)   NULL,
  city           VARCHAR(120) NULL,
  -- Sticky owner: a returning lead stays with their existing agent.
  owner_user_id  varchar(36)     NULL,
  lead_score     SMALLINT     NOT NULL DEFAULT 0,
  ai_summary     TEXT         NULL,
  ai_summary_at  timestamptz(3)  NULL,
  -- First-touch attribution is never overwritten.
  first_source   VARCHAR(48)  NULL,
  first_touch_at timestamptz(3)  NULL,
  last_source    VARCHAR(48)  NULL,
  dnc            smallint   NOT NULL DEFAULT 0,
  dnc_reason     VARCHAR(160) NULL,
  dnc_at         timestamptz(3)  NULL,
  possible_duplicate_of varchar(36) NULL,
  merged_into_id varchar(36)     NULL,
  -- Messaging state used by the guards.
  last_inbound_at   timestamptz(3) NULL,
  last_outbound_at  timestamptz(3) NULL,
  last_human_outbound_at timestamptz(3) NULL,
  bot_paused_until  timestamptz(3) NULL,
  -- Agent-edited fields are protected from automated overwrite.
  locked_fields  jsonb         NULL,
  notes          TEXT         NULL,
  created_at     timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at     timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_contacts_phone UNIQUE (phone_e164),
  CONSTRAINT uq_contacts_wa_id UNIQUE (wa_id),
  CONSTRAINT fk_contacts_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- Every known identifier that points at a contact.
CREATE TABLE contact_identities (
  id         varchar(36)     NOT NULL PRIMARY KEY,
  contact_id varchar(36)     NOT NULL,
  kind text NOT NULL CHECK (kind IN ('phone','wa_id','email','meta_lead_id','ctwa_clid','gclid','external_id','fbp','fbc')),
  value      VARCHAR(255) NOT NULL,
  source     VARCHAR(48)  NULL,
  created_at timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_identity_kind_value UNIQUE (kind, value),
  CONSTRAINT fk_identity_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
);

CREATE TABLE pipelines (
  id         varchar(36)     NOT NULL PRIMARY KEY,
  "key"      VARCHAR(48)  NOT NULL,
  name       VARCHAR(120) NOT NULL,
  is_default smallint   NOT NULL DEFAULT 0,
  created_at timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_pipelines_key UNIQUE ("key")
);

CREATE TABLE pipeline_stages (
  id          varchar(36)    NOT NULL PRIMARY KEY,
  pipeline_id varchar(36)    NOT NULL,
  "key"       VARCHAR(48) NOT NULL,
  name        VARCHAR(120) NOT NULL,
  position    SMALLINT    NOT NULL DEFAULT 0,
  is_won      smallint  NOT NULL DEFAULT 0,
  is_lost     smallint  NOT NULL DEFAULT 0,
  sub_statuses jsonb       NULL,
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT uq_stage_pipeline_key UNIQUE (pipeline_id, "key"),
  CONSTRAINT fk_stage_pipeline FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
);

-- One inquiry in the pipeline.
CREATE TABLE opportunities (
  id             varchar(36)     NOT NULL PRIMARY KEY,
  contact_id     varchar(36)     NOT NULL,
  pipeline_id    varchar(36)     NOT NULL,
  stage_id       varchar(36)     NOT NULL,
  stage_key      VARCHAR(48)  NOT NULL,
  sub_status     VARCHAR(48)  NULL,
  owner_user_id  varchar(36)     NULL,
  title          VARCHAR(200) NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  lost_reason text NULL CHECK (lost_reason IN ('not_interested','budget_mismatch','bought_elsewhere','unresponsive','invalid')),
  lost_note      VARCHAR(500) NULL,
  -- Real estate fields.
  project_id     varchar(36)     NULL,
  project_name   VARCHAR(160) NULL,
  developer      VARCHAR(160) NULL,
  emirate text NULL CHECK (emirate IN ('dubai','abu_dhabi','sharjah','ras_al_khaimah','ajman','fujairah','umm_al_quwain','other')),
  preferred_location VARCHAR(160) NULL,
  unit_type      VARCHAR(64)  NULL,
  budget_min_aed bigint NULL,
  budget_max_aed bigint NULL,
  budget_band    VARCHAR(120) NULL,
  purpose text NOT NULL DEFAULT 'unknown' CHECK (purpose IN ('investment','end_use','unknown')),
  payment_method text NOT NULL DEFAULT 'unknown' CHECK (payment_method IN ('cash','mortgage','payment_plan','unknown')),
  timeline text NOT NULL DEFAULT 'unknown' CHECK (timeline IN ('immediate','1_3_months','3_6_months','6_12_months','12_plus','unknown')),
  golden_visa_interest smallint NOT NULL DEFAULT 0,
  deal_value_aed bigint NULL,
  expected_commission_aed bigint NULL,
  lead_score     SMALLINT     NOT NULL DEFAULT 0,
  -- First-touch attribution.
  source         VARCHAR(48)  NOT NULL DEFAULT 'manual',
  campaign_id    VARCHAR(64)  NULL,
  campaign_name  VARCHAR(255) NULL,
  adset_id       VARCHAR(64)  NULL,
  adset_name     VARCHAR(255) NULL,
  ad_id          VARCHAR(64)  NULL,
  ad_name        VARCHAR(255) NULL,
  form_id        VARCHAR(64)  NULL,
  form_name      VARCHAR(255) NULL,
  meta_lead_id   VARCHAR(64)  NULL,
  ctwa_clid      VARCHAR(255) NULL,
  gclid          VARCHAR(255) NULL,
  utm_source     VARCHAR(160) NULL,
  utm_medium     VARCHAR(160) NULL,
  utm_campaign   VARCHAR(160) NULL,
  utm_term       VARCHAR(160) NULL,
  utm_content    VARCHAR(160) NULL,
  landing_page   VARCHAR(1024) NULL,
  referrer       VARCHAR(1024) NULL,
  fbp            VARCHAR(255) NULL,
  fbc            VARCHAR(255) NULL,
  client_ip      VARCHAR(64)  NULL,
  client_user_agent VARCHAR(512) NULL,
  -- Speed-to-lead measurement.
  assigned_at    timestamptz(3)  NULL,
  first_touch_at timestamptz(3)  NULL,
  first_response_at timestamptz(3) NULL,
  sla_breached   smallint   NOT NULL DEFAULT 0,
  stage_changed_at timestamptz(3) NOT NULL DEFAULT now(),
  closed_at      timestamptz(3)  NULL,
  created_at     timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at     timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_opportunity_meta_lead UNIQUE (meta_lead_id),
  CONSTRAINT fk_opp_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_opp_pipeline FOREIGN KEY (pipeline_id) REFERENCES pipelines (id),
  CONSTRAINT fk_opp_stage FOREIGN KEY (stage_id) REFERENCES pipeline_stages (id),
  CONSTRAINT fk_opp_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL
);


-- Indexes (MySQL declares these inside CREATE TABLE).
CREATE INDEX idx_users_role_active ON users (role, is_active);
CREATE INDEX idx_users_manager ON users (manager_id);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);
CREATE INDEX idx_login_attempts_email_time ON login_attempts (email, created_at);
CREATE INDEX idx_login_attempts_ip_time ON login_attempts (ip, created_at);
CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id, created_at);
CREATE INDEX idx_audit_actor ON audit_log (actor_user_id, created_at);
CREATE INDEX idx_audit_action ON audit_log (action, created_at);
CREATE INDEX idx_contacts_email ON contacts (email);
CREATE INDEX idx_contacts_owner ON contacts (owner_user_id);
CREATE INDEX idx_contacts_created ON contacts (created_at);
CREATE INDEX idx_contacts_score ON contacts (lead_score);
CREATE INDEX idx_contacts_merged ON contacts (merged_into_id);
CREATE INDEX idx_identity_contact ON contact_identities (contact_id);
CREATE INDEX idx_stage_position ON pipeline_stages (pipeline_id, position);
CREATE INDEX idx_opp_contact ON opportunities (contact_id);
CREATE INDEX idx_opp_stage ON opportunities (pipeline_id, stage_key, status);
CREATE INDEX idx_opp_owner ON opportunities (owner_user_id, status);
CREATE INDEX idx_opp_created ON opportunities (created_at);
CREATE INDEX idx_opp_project ON opportunities (project_id);
CREATE INDEX idx_opp_campaign ON opportunities (campaign_id);
CREATE INDEX idx_opp_reinquiry ON opportunities (contact_id, project_name, created_at);

-- MySQL refreshes updated_at by itself; Postgres needs to be asked.
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER contacts_set_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER opportunities_set_updated_at BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
