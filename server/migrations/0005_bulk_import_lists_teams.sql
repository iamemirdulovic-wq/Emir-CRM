-- 0005: bulk import, lists and campaigns, teams and assignment.
--
-- Eleven tables covering three related jobs:
--   * getting a large file of leads into the CRM without losing or duplicating
--     any of them, and being able to take it back out again within a day;
--   * grouping contacts into lists and working them as call or WhatsApp
--     campaigns;
--   * deciding who owns a lead — one agent, a team, a split, a rule, or a
--     shared pool that agents claim from.

-- ---------------------------------------------------------------------------
-- Teams and assignment
-- ---------------------------------------------------------------------------

-- "Arabic desk", "Abu Dhabi team". A team has one manager and many members.
CREATE TABLE teams (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  description     VARCHAR(500) NULL,
  manager_user_id CHAR(36)     NULL,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_team_name (name),
  KEY idx_team_manager (manager_user_id),
  CONSTRAINT fk_team_manager FOREIGN KEY (manager_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE team_members (
  team_id  CHAR(36)    NOT NULL,
  user_id  CHAR(36)    NOT NULL,
  added_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (team_id, user_id),
  KEY idx_team_member_user (user_id),
  CONSTRAINT fk_team_member_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
  CONSTRAINT fk_team_member_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- How a batch of leads is shared out. `config` holds the method's parameters:
-- the percentages for split_percent, the match conditions for by_rule, the
-- claim limits for pool.
CREATE TABLE assignment_rules (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  name           VARCHAR(120) NOT NULL,
  method         ENUM('agent','team_round_robin','split_even','split_percent','by_rule','pool') NOT NULL,
  target_user_id CHAR(36)     NULL,
  target_team_id CHAR(36)     NULL,
  config         JSON         NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_assignment_rule_name (name),
  KEY idx_assignment_rule_team (target_team_id),
  CONSTRAINT fk_assignment_rule_user FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_assignment_rule_team FOREIGN KEY (target_team_id) REFERENCES teams (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The shared pool. An agent claims a lead, works it, and it either stays theirs
-- or returns to the pool if untouched.
--
-- `open_key` carries the opportunity id while the claim is open and is set to
-- NULL on release. A unique index treats NULLs as distinct, so the column makes
-- "one open claim per lead" a constraint the database enforces rather than
-- something the application has to check first and hope nobody raced it.
CREATE TABLE lead_pool_claims (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  opportunity_id CHAR(36)     NOT NULL,
  contact_id     CHAR(36)     NOT NULL,
  user_id        CHAR(36)     NOT NULL,
  open_key       CHAR(36)     NULL,
  claimed_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  released_at    DATETIME(3)  NULL,
  release_reason VARCHAR(64)  NULL,
  UNIQUE KEY uq_pool_open_claim (open_key),
  KEY idx_pool_user_open (user_id, released_at),
  KEY idx_pool_opportunity (opportunity_id),
  CONSTRAINT fk_pool_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT fk_pool_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_pool_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Bulk import
-- ---------------------------------------------------------------------------

-- One uploaded file. Rows are processed by a background job in chunks, so
-- `processed_rows` against `total_rows` is the progress bar, and the user can
-- close the page.
CREATE TABLE imports (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  filename           VARCHAR(255) NOT NULL,
  file_path          VARCHAR(500) NULL,
  file_kind          ENUM('csv','xlsx','paste') NOT NULL,
  byte_size          BIGINT       NOT NULL DEFAULT 0,
  status             ENUM('uploaded','mapping','validating','ready','importing','completed','failed','undone')
                     NOT NULL DEFAULT 'uploaded',
  total_rows         INT          NOT NULL DEFAULT 0,
  processed_rows     INT          NOT NULL DEFAULT 0,
  created_count      INT          NOT NULL DEFAULT 0,
  updated_count      INT          NOT NULL DEFAULT 0,
  skipped_count      INT          NOT NULL DEFAULT 0,
  failed_count       INT          NOT NULL DEFAULT 0,
  headers            JSON         NULL,
  mapping            JSON         NULL,
  settings           JSON         NULL,
  assignment         JSON         NULL,
  error_message      TEXT         NULL,
  created_by_user_id CHAR(36)     NULL,
  started_at         DATETIME(3)  NULL,
  finished_at        DATETIME(3)  NULL,
  undo_deadline_at   DATETIME(3)  NULL,
  undone_at          DATETIME(3)  NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_import_status (status, created_at),
  KEY idx_import_creator (created_by_user_id),
  CONSTRAINT fk_import_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every row of the file, with what became of it. This is what makes the failed
-- rows downloadable and the 24-hour undo possible: the import knows exactly
-- which contacts it created.
CREATE TABLE import_rows (
  id             CHAR(36) NOT NULL PRIMARY KEY,
  import_id      CHAR(36) NOT NULL,
  line_number    INT      NOT NULL,
  -- Named line_number rather than row_number: the latter is a reserved word
  -- once window functions exist, on MariaDB as well as MySQL 8.
  raw            JSON     NOT NULL,
  normalized     JSON     NULL,
  status         ENUM('pending','created','updated','skipped','invalid','failed') NOT NULL DEFAULT 'pending',
  reason         VARCHAR(255) NULL,
  contact_id     CHAR(36) NULL,
  opportunity_id CHAR(36) NULL,
  UNIQUE KEY uq_import_row (import_id, line_number),
  KEY idx_import_row_status (import_id, status),
  KEY idx_import_row_contact (contact_id),
  CONSTRAINT fk_import_row_import FOREIGN KEY (import_id) REFERENCES imports (id) ON DELETE CASCADE,
  CONSTRAINT fk_import_row_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE SET NULL,
  CONSTRAINT fk_import_row_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A saved column mapping, so the next file from the same source is one click.
CREATE TABLE import_mappings (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  name               VARCHAR(120) NOT NULL,
  mapping            JSON         NOT NULL,
  created_by_user_id CHAR(36)     NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_import_mapping_name (name),
  CONSTRAINT fk_import_mapping_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Lists and campaigns
-- ---------------------------------------------------------------------------

-- A static list holds explicit members; a smart list stores filters and is
-- evaluated when it is read, so it stays current on its own.
CREATE TABLE lists (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  name               VARCHAR(160) NOT NULL,
  description        VARCHAR(500) NULL,
  kind               ENUM('static','smart') NOT NULL DEFAULT 'static',
  filters            JSON         NULL,
  owner_user_id      CHAR(36)     NULL,
  recycle_after_days INT          NULL,
  recycle_action     ENUM('reassign','pool') NULL,
  created_by_user_id CHAR(36)     NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_list_name (name),
  KEY idx_list_owner (owner_user_id),
  CONSTRAINT fk_list_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_list_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE list_members (
  list_id          CHAR(36)    NOT NULL,
  contact_id       CHAR(36)    NOT NULL,
  opportunity_id   CHAR(36)    NULL,
  added_by_user_id CHAR(36)    NULL,
  added_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (list_id, contact_id),
  KEY idx_list_member_contact (contact_id),
  CONSTRAINT fk_list_member_list FOREIGN KEY (list_id) REFERENCES lists (id) ON DELETE CASCADE,
  CONSTRAINT fk_list_member_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_list_member_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A call campaign is worked by a person through the dialler; a WhatsApp
-- campaign is sent by a throttled background job under the bulk-send guard.
CREATE TABLE campaigns (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  name               VARCHAR(160) NOT NULL,
  kind               ENUM('call','whatsapp') NOT NULL,
  list_id            CHAR(36)     NULL,
  status             ENUM('draft','running','paused','completed','cancelled') NOT NULL DEFAULT 'draft',
  template_name      VARCHAR(160) NULL,
  template_language  VARCHAR(12)  NULL,
  throttle_per_minute INT         NOT NULL DEFAULT 20,
  paused_reason      VARCHAR(255) NULL,
  total_members      INT          NOT NULL DEFAULT 0,
  skipped_no_consent INT          NOT NULL DEFAULT 0,
  created_by_user_id CHAR(36)     NULL,
  started_at         DATETIME(3)  NULL,
  finished_at        DATETIME(3)  NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_campaign_status (status, kind),
  KEY idx_campaign_list (list_id),
  CONSTRAINT fk_campaign_list FOREIGN KEY (list_id) REFERENCES lists (id) ON DELETE SET NULL,
  CONSTRAINT fk_campaign_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE campaign_members (
  id               CHAR(36)    NOT NULL PRIMARY KEY,
  campaign_id      CHAR(36)    NOT NULL,
  contact_id       CHAR(36)    NOT NULL,
  opportunity_id   CHAR(36)    NULL,
  assigned_user_id CHAR(36)    NULL,
  sort_order       INT         NOT NULL DEFAULT 0,
  status           ENUM('pending','in_progress','sent','done','skipped','failed') NOT NULL DEFAULT 'pending',
  outcome          ENUM('answered','no_answer','busy','wrong_number','not_interested','interested') NULL,
  attempts         INT         NOT NULL DEFAULT 0,
  skip_reason      VARCHAR(160) NULL,
  notes            TEXT        NULL,
  last_attempt_at  DATETIME(3) NULL,
  completed_at     DATETIME(3) NULL,
  UNIQUE KEY uq_campaign_member (campaign_id, contact_id),
  KEY idx_campaign_member_work (campaign_id, status, sort_order),
  KEY idx_campaign_member_agent (campaign_id, assigned_user_id, status),
  CONSTRAINT fk_campaign_member_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT fk_campaign_member_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_campaign_member_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL,
  CONSTRAINT fk_campaign_member_agent FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Imported leads do not start Workflow A, so an old database of 40,000 rows
-- cannot fire 40,000 welcome messages. This records where each opportunity came
-- from, so that decision is auditable rather than implicit in a job payload.
ALTER TABLE opportunities
  ADD COLUMN import_id CHAR(36) NULL,
  ADD KEY idx_opportunity_import (import_id);

-- "Claim the oldest lead in the pool" is
--   WHERE owner_user_id IS NULL AND status = 'open' ORDER BY created_at LIMIT 1
--     FOR UPDATE SKIP LOCKED
-- Without this index that ORDER BY is a filesort, and a filesort reads and
-- locks every matching row before it can sort them — so the first agent to
-- press "Claim next lead" would lock the entire pool and everyone else would
-- be told it was empty. With the index the order comes for free and exactly
-- one row is locked.
ALTER TABLE opportunities
  ADD KEY idx_opportunity_pool (owner_user_id, status, created_at);
