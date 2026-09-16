-- 0002: immutable ingestion log, conversations, messages, templates, jobs, workflows.

-- Every webhook payload is stored verbatim before any processing. The unique
-- key on (source, external_id) is what makes replays idempotent.
CREATE TABLE inbound_events (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  source          VARCHAR(48)  NOT NULL,
  external_id     VARCHAR(191) NOT NULL,
  signature_valid TINYINT(1)   NOT NULL DEFAULT 0,
  raw_payload     JSON         NOT NULL,
  headers         JSON         NULL,
  received_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at    DATETIME(3)  NULL,
  status          ENUM('received','processing','processed','duplicate','failed','ignored') NOT NULL DEFAULT 'received',
  error           TEXT         NULL,
  contact_id      CHAR(36)     NULL,
  opportunity_id  CHAR(36)     NULL,
  UNIQUE KEY uq_inbound_source_external (source, external_id),
  KEY idx_inbound_status (status, received_at),
  KEY idx_inbound_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One thread per contact, mixing every channel.
CREATE TABLE conversations (
  id                CHAR(36)    NOT NULL PRIMARY KEY,
  contact_id        CHAR(36)    NOT NULL,
  assigned_user_id  CHAR(36)    NULL,
  status            ENUM('open','snoozed','closed') NOT NULL DEFAULT 'open',
  last_message_at   DATETIME(3) NULL,
  last_inbound_at   DATETIME(3) NULL,
  last_outbound_at  DATETIME(3) NULL,
  /* WhatsApp 24-hour customer service window opens on every inbound message. */
  wa_window_expires_at DATETIME(3) NULL,
  unread_count      INT UNSIGNED NOT NULL DEFAULT 0,
  /* Collision guard: "X is replying…" soft lock. */
  reply_lock_user_id CHAR(36)   NULL,
  reply_lock_expires_at DATETIME(3) NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_conversation_contact (contact_id),
  KEY idx_conversation_assigned (assigned_user_id, status),
  KEY idx_conversation_last_message (last_message_at),
  CONSTRAINT fk_conversation_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_user FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE messages (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  conversation_id CHAR(36)     NOT NULL,
  contact_id      CHAR(36)     NOT NULL,
  channel         ENUM('whatsapp','email','sms','note','system') NOT NULL,
  direction       ENUM('inbound','outbound') NOT NULL,
  provider        VARCHAR(32)  NULL,
  provider_message_id VARCHAR(191) NULL,
  user_id         CHAR(36)     NULL,
  is_automated    TINYINT(1)   NOT NULL DEFAULT 0,
  template_name   VARCHAR(120) NULL,
  template_language VARCHAR(16) NULL,
  subject         VARCHAR(512) NULL,
  body            MEDIUMTEXT   NULL,
  media           JSON         NULL,
  payload         JSON         NULL,
  status          ENUM('queued','sent','delivered','read','failed','received') NOT NULL DEFAULT 'queued',
  error_code      VARCHAR(64)  NULL,
  error_message   VARCHAR(512) NULL,
  sent_at         DATETIME(3)  NULL,
  delivered_at    DATETIME(3)  NULL,
  read_at         DATETIME(3)  NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_message_provider (provider, provider_message_id),
  KEY idx_message_conversation (conversation_id, created_at),
  KEY idx_message_contact (contact_id, created_at),
  KEY idx_message_automated (contact_id, is_automated, created_at),
  CONSTRAINT fk_message_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_message_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_message_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wa_templates (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  language      VARCHAR(16)  NOT NULL,
  category      ENUM('MARKETING','UTILITY','AUTHENTICATION') NOT NULL,
  status        ENUM('DRAFT','PENDING','APPROVED','REJECTED','PAUSED','DISABLED') NOT NULL DEFAULT 'DRAFT',
  provider_template_id VARCHAR(64) NULL,
  components    JSON         NOT NULL,
  quality_score VARCHAR(32)  NULL,
  rejected_reason VARCHAR(255) NULL,
  last_synced_at DATETIME(3) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_template_name_lang (name, language),
  KEY idx_template_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE activities (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  contact_id     CHAR(36)     NULL,
  opportunity_id CHAR(36)     NULL,
  user_id        CHAR(36)     NULL,
  type           VARCHAR(48)  NOT NULL,
  title          VARCHAR(255) NOT NULL,
  body           TEXT         NULL,
  meta           JSON         NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_activity_contact (contact_id, created_at),
  KEY idx_activity_opportunity (opportunity_id, created_at),
  KEY idx_activity_user (user_id, created_at),
  KEY idx_activity_type (type, created_at),
  CONSTRAINT fk_activity_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_activity_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tasks (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  contact_id     CHAR(36)     NULL,
  opportunity_id CHAR(36)     NULL,
  assigned_user_id CHAR(36)   NULL,
  created_by_user_id CHAR(36) NULL,
  type           ENUM('call','whatsapp','email','meeting','other') NOT NULL DEFAULT 'call',
  title          VARCHAR(255) NOT NULL,
  notes          TEXT         NULL,
  priority       ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  due_at         DATETIME(3)  NOT NULL,
  completed_at   DATETIME(3)  NULL,
  completed_by_user_id CHAR(36) NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_task_assignee_due (assigned_user_id, completed_at, due_at),
  KEY idx_task_contact (contact_id),
  KEY idx_task_opportunity (opportunity_id),
  CONSTRAINT fk_task_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_task_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT fk_task_assignee FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tags use the namespace:value format (src:, proj:, lang:, intent:).
CREATE TABLE tags (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  namespace  VARCHAR(32)  NOT NULL,
  value      VARCHAR(120) NOT NULL,
  label      VARCHAR(160) NULL,
  color      VARCHAR(16)  NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tag (namespace, value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE contact_tags (
  contact_id CHAR(36)    NOT NULL,
  tag_id     CHAR(36)    NOT NULL,
  added_by_user_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (contact_id, tag_id),
  KEY idx_contact_tags_tag (tag_id),
  CONSTRAINT fk_contact_tags_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_contact_tags_tag FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- UAE PDPL: store the exact consent text that was shown to the lead.
CREATE TABLE consents (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  contact_id   CHAR(36)     NOT NULL,
  channel      ENUM('whatsapp','email','sms','calls','all') NOT NULL,
  granted      TINYINT(1)   NOT NULL,
  source       VARCHAR(48)  NOT NULL,
  consent_text TEXT         NULL,
  evidence     JSON         NULL,
  ip           VARCHAR(64)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_consent_contact_channel (contact_id, channel, created_at),
  CONSTRAINT fk_consent_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Do-not-contact entries keyed by identifier, so a STOP survives contact merges
-- and applies before a contact record even exists.
CREATE TABLE suppressions (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  kind       ENUM('phone','email','wa_id') NOT NULL,
  value      VARCHAR(255) NOT NULL,
  reason     VARCHAR(160) NOT NULL DEFAULT 'user_opt_out',
  created_by_user_id CHAR(36) NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_suppression (kind, value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The verified off-plan library. Prices and plans may only come from here.
CREATE TABLE projects (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  slug           VARCHAR(120) NOT NULL,
  name           VARCHAR(160) NOT NULL,
  developer      VARCHAR(160) NOT NULL,
  emirate        ENUM('dubai','abu_dhabi','sharjah','ras_al_khaimah','ajman','fujairah','umm_al_quwain','other') NOT NULL,
  area           VARCHAR(160) NULL,
  unit_types     JSON         NULL,
  starting_price_aed BIGINT UNSIGNED NULL,
  price_per_sqft_aed INT UNSIGNED NULL,
  payment_plan   VARCHAR(255) NULL,
  handover_date  VARCHAR(48)  NULL,
  golden_visa_eligible TINYINT(1) NOT NULL DEFAULT 0,
  brochure_url   VARCHAR(1024) NULL,
  image_url      VARCHAR(1024) NULL,
  location_lat   DECIMAL(10,7) NULL,
  location_lng   DECIMAL(10,7) NULL,
  location_label VARCHAR(255) NULL,
  description    TEXT         NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  verified_at    DATETIME(3)  NULL,
  verified_by_user_id CHAR(36) NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_project_slug (slug),
  KEY idx_project_active (is_active, emirate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Custom lead-form questions are mapped here, never hard-coded.
CREATE TABLE form_field_map (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  source         VARCHAR(48)  NOT NULL,
  form_id        VARCHAR(64)  NULL,
  external_field VARCHAR(255) NOT NULL,
  crm_field      VARCHAR(80)  NOT NULL,
  transform      VARCHAR(48)  NULL,
  value_map      JSON         NULL,
  notes          VARCHAR(255) NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_form_field (source, form_id, external_field),
  KEY idx_form_field_form (source, form_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workflows (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  `key`       VARCHAR(48)  NOT NULL,
  name        VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  definition  JSON         NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_workflow_key (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workflow_runs (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  workflow_key   VARCHAR(48)  NOT NULL,
  contact_id     CHAR(36)     NULL,
  opportunity_id CHAR(36)     NULL,
  status         ENUM('running','completed','cancelled','failed') NOT NULL DEFAULT 'running',
  current_step   VARCHAR(64)  NULL,
  context        JSON         NULL,
  cancel_reason  VARCHAR(160) NULL,
  started_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at    DATETIME(3)  NULL,
  KEY idx_run_workflow_contact (workflow_key, contact_id, status),
  KEY idx_run_status (status, started_at),
  KEY idx_run_opportunity (opportunity_id),
  CONSTRAINT fk_run_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_run_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Background work. Polled by the worker; `dedupe_key` keeps replays harmless.
CREATE TABLE jobs (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  type          VARCHAR(64)  NOT NULL,
  payload       JSON         NOT NULL,
  status        ENUM('pending','running','done','failed','cancelled') NOT NULL DEFAULT 'pending',
  priority      TINYINT      NOT NULL DEFAULT 5,
  run_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  attempts      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts  SMALLINT UNSIGNED NOT NULL DEFAULT 5,
  dedupe_key    VARCHAR(191) NULL,
  workflow_run_id CHAR(36)   NULL,
  contact_id    CHAR(36)     NULL,
  locked_by     VARCHAR(64)  NULL,
  locked_at     DATETIME(3)  NULL,
  last_error    TEXT         NULL,
  result        JSON         NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  finished_at   DATETIME(3)  NULL,
  UNIQUE KEY uq_job_dedupe (dedupe_key),
  KEY idx_job_claim (status, run_at, priority),
  KEY idx_job_workflow_run (workflow_run_id),
  KEY idx_job_contact (contact_id, type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
