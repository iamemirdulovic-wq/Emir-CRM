-- 0001_init: foundation — users, sessions, audit, contacts, pipeline, opportunities.

CREATE TABLE users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(160) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  role          ENUM('owner','admin','manager','agent','automation') NOT NULL DEFAULT 'agent',
  password_hash VARCHAR(255) NOT NULL,
  password_algo ENUM('bcrypt','argon2') NOT NULL DEFAULT 'bcrypt',
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  -- Routing inputs for Workflow A.
  availability  ENUM('available','busy','off') NOT NULL DEFAULT 'available',
  routing_weight SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  shift_start   TIME         NULL,
  shift_end     TIME         NULL,
  languages     JSON         NULL,
  projects_covered JSON      NULL,
  manager_id    CHAR(36)     NULL,
  phone_e164    VARCHAR(32)  NULL,
  locale        VARCHAR(8)   NOT NULL DEFAULT 'en',
  last_login_at DATETIME(3)  NULL,
  failed_login_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until  DATETIME(3)  NULL,
  deactivated_at DATETIME(3) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role_active (role, is_active),
  KEY idx_users_manager (manager_id),
  CONSTRAINT fk_users_manager FOREIGN KEY (manager_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server-side sessions. We store only the SHA-256 of the cookie value.
CREATE TABLE sessions (
  id          CHAR(64)     NOT NULL PRIMARY KEY,
  user_id     CHAR(36)     NOT NULL,
  expires_at  DATETIME(3)  NOT NULL,
  remember_me TINYINT(1)   NOT NULL DEFAULT 0,
  ip          VARCHAR(64)  NULL,
  user_agent  VARCHAR(512) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE login_attempts (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email      VARCHAR(255) NOT NULL,
  ip         VARCHAR(64)  NULL,
  successful TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_login_attempts_email_time (email, created_at),
  KEY idx_login_attempts_ip_time (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_log (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  actor_user_id CHAR(36)    NULL,
  actor_role   VARCHAR(32)  NULL,
  actor_label  VARCHAR(160) NULL,
  action       VARCHAR(80)  NOT NULL,
  entity_type  VARCHAR(48)  NOT NULL,
  entity_id    VARCHAR(64)  NULL,
  before_json  JSON         NULL,
  after_json   JSON         NULL,
  ip           VARCHAR(64)  NULL,
  user_agent   VARCHAR(512) NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_entity (entity_type, entity_id, created_at),
  KEY idx_audit_actor (actor_user_id, created_at),
  KEY idx_audit_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The person. One row per human being.
CREATE TABLE contacts (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
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
  owner_user_id  CHAR(36)     NULL,
  lead_score     SMALLINT     NOT NULL DEFAULT 0,
  ai_summary     TEXT         NULL,
  ai_summary_at  DATETIME(3)  NULL,
  -- First-touch attribution is never overwritten.
  first_source   VARCHAR(48)  NULL,
  first_touch_at DATETIME(3)  NULL,
  last_source    VARCHAR(48)  NULL,
  dnc            TINYINT(1)   NOT NULL DEFAULT 0,
  dnc_reason     VARCHAR(160) NULL,
  dnc_at         DATETIME(3)  NULL,
  possible_duplicate_of CHAR(36) NULL,
  merged_into_id CHAR(36)     NULL,
  -- Messaging state used by the guards.
  last_inbound_at   DATETIME(3) NULL,
  last_outbound_at  DATETIME(3) NULL,
  last_human_outbound_at DATETIME(3) NULL,
  bot_paused_until  DATETIME(3) NULL,
  -- Agent-edited fields are protected from automated overwrite.
  locked_fields  JSON         NULL,
  notes          TEXT         NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_contacts_phone (phone_e164),
  UNIQUE KEY uq_contacts_wa_id (wa_id),
  KEY idx_contacts_email (email),
  KEY idx_contacts_owner (owner_user_id),
  KEY idx_contacts_created (created_at),
  KEY idx_contacts_score (lead_score),
  KEY idx_contacts_merged (merged_into_id),
  CONSTRAINT fk_contacts_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every known identifier that points at a contact.
CREATE TABLE contact_identities (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  contact_id CHAR(36)     NOT NULL,
  kind       ENUM('phone','wa_id','email','meta_lead_id','ctwa_clid','gclid','external_id','fbp','fbc') NOT NULL,
  value      VARCHAR(255) NOT NULL,
  source     VARCHAR(48)  NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_identity_kind_value (kind, value),
  KEY idx_identity_contact (contact_id),
  CONSTRAINT fk_identity_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pipelines (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  `key`      VARCHAR(48)  NOT NULL,
  name       VARCHAR(120) NOT NULL,
  is_default TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pipelines_key (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pipeline_stages (
  id          CHAR(36)    NOT NULL PRIMARY KEY,
  pipeline_id CHAR(36)    NOT NULL,
  `key`       VARCHAR(48) NOT NULL,
  name        VARCHAR(120) NOT NULL,
  position    SMALLINT    NOT NULL DEFAULT 0,
  is_won      TINYINT(1)  NOT NULL DEFAULT 0,
  is_lost     TINYINT(1)  NOT NULL DEFAULT 0,
  sub_statuses JSON       NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_stage_pipeline_key (pipeline_id, `key`),
  KEY idx_stage_position (pipeline_id, position),
  CONSTRAINT fk_stage_pipeline FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One inquiry in the pipeline.
CREATE TABLE opportunities (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  contact_id     CHAR(36)     NOT NULL,
  pipeline_id    CHAR(36)     NOT NULL,
  stage_id       CHAR(36)     NOT NULL,
  stage_key      VARCHAR(48)  NOT NULL,
  sub_status     VARCHAR(48)  NULL,
  owner_user_id  CHAR(36)     NULL,
  title          VARCHAR(200) NULL,
  status         ENUM('open','won','lost') NOT NULL DEFAULT 'open',
  lost_reason    ENUM('not_interested','budget_mismatch','bought_elsewhere','unresponsive','invalid') NULL,
  lost_note      VARCHAR(500) NULL,
  -- Real estate fields.
  project_id     CHAR(36)     NULL,
  project_name   VARCHAR(160) NULL,
  developer      VARCHAR(160) NULL,
  emirate        ENUM('dubai','abu_dhabi','sharjah','ras_al_khaimah','ajman','fujairah','umm_al_quwain','other') NULL,
  preferred_location VARCHAR(160) NULL,
  unit_type      VARCHAR(64)  NULL,
  budget_min_aed BIGINT UNSIGNED NULL,
  budget_max_aed BIGINT UNSIGNED NULL,
  budget_band    VARCHAR(120) NULL,
  purpose        ENUM('investment','end_use','unknown') NOT NULL DEFAULT 'unknown',
  payment_method ENUM('cash','mortgage','payment_plan','unknown') NOT NULL DEFAULT 'unknown',
  timeline       ENUM('immediate','1_3_months','3_6_months','6_12_months','12_plus','unknown') NOT NULL DEFAULT 'unknown',
  golden_visa_interest TINYINT(1) NOT NULL DEFAULT 0,
  deal_value_aed BIGINT UNSIGNED NULL,
  expected_commission_aed BIGINT UNSIGNED NULL,
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
  assigned_at    DATETIME(3)  NULL,
  first_touch_at DATETIME(3)  NULL,
  first_response_at DATETIME(3) NULL,
  sla_breached   TINYINT(1)   NOT NULL DEFAULT 0,
  stage_changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at      DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_opportunity_meta_lead (meta_lead_id),
  KEY idx_opp_contact (contact_id),
  KEY idx_opp_stage (pipeline_id, stage_key, status),
  KEY idx_opp_owner (owner_user_id, status),
  KEY idx_opp_created (created_at),
  KEY idx_opp_project (project_id),
  KEY idx_opp_campaign (campaign_id),
  KEY idx_opp_reinquiry (contact_id, project_name, created_at),
  CONSTRAINT fk_opp_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_opp_pipeline FOREIGN KEY (pipeline_id) REFERENCES pipelines (id),
  CONSTRAINT fk_opp_stage FOREIGN KEY (stage_id) REFERENCES pipeline_stages (id),
  CONSTRAINT fk_opp_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
