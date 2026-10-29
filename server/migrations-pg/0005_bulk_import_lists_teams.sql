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
  id              varchar(36)     NOT NULL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  description     VARCHAR(500) NULL,
  manager_user_id varchar(36)     NULL,
  is_active       smallint   NOT NULL DEFAULT 1,
  created_at      timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at      timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_team_name UNIQUE (name),
  CONSTRAINT fk_team_manager FOREIGN KEY (manager_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE team_members (
  team_id  varchar(36)    NOT NULL,
  user_id  varchar(36)    NOT NULL,
  added_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id),
  CONSTRAINT fk_team_member_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
  CONSTRAINT fk_team_member_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- How a batch of leads is shared out. "config" holds the method's parameters:
-- the percentages for split_percent, the match conditions for by_rule, the
-- claim limits for pool.
CREATE TABLE assignment_rules (
  id             varchar(36)     NOT NULL PRIMARY KEY,
  name           VARCHAR(120) NOT NULL,
  method text NOT NULL CHECK (method IN ('agent','team_round_robin','split_even','split_percent','by_rule','pool')),
  target_user_id varchar(36)     NULL,
  target_team_id varchar(36)     NULL,
  config         jsonb         NULL,
  is_active      smallint   NOT NULL DEFAULT 1,
  created_by_user_id varchar(36) NULL,
  created_at     timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at     timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_assignment_rule_name UNIQUE (name),
  CONSTRAINT fk_assignment_rule_user FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_assignment_rule_team FOREIGN KEY (target_team_id) REFERENCES teams (id) ON DELETE CASCADE
);

-- The shared pool. An agent claims a lead, works it, and it either stays theirs
-- or returns to the pool if untouched.
--
-- "open_key" carries the opportunity id while the claim is open and is set to
-- NULL on release. A unique index treats NULLs as distinct, so the column makes
-- "one open claim per lead" a constraint the database enforces rather than
-- something the application has to check first and hope nobody raced it.
CREATE TABLE lead_pool_claims (
  id             varchar(36)     NOT NULL PRIMARY KEY,
  opportunity_id varchar(36)     NOT NULL,
  contact_id     varchar(36)     NOT NULL,
  user_id        varchar(36)     NOT NULL,
  open_key       varchar(36)     NULL,
  claimed_at     timestamptz(3)  NOT NULL DEFAULT now(),
  released_at    timestamptz(3)  NULL,
  release_reason VARCHAR(64)  NULL,
  CONSTRAINT uq_pool_open_claim UNIQUE (open_key),
  CONSTRAINT fk_pool_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT fk_pool_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_pool_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Bulk import
-- ---------------------------------------------------------------------------

-- One uploaded file. Rows are processed by a background job in chunks, so
-- "processed_rows" against "total_rows" is the progress bar, and the user can
-- close the page.
CREATE TABLE imports (
  id                 varchar(36)     NOT NULL PRIMARY KEY,
  filename           VARCHAR(255) NOT NULL,
  file_path          VARCHAR(500) NULL,
  file_kind text NOT NULL CHECK (file_kind IN ('csv','xlsx','paste')),
  byte_size          BIGINT       NOT NULL DEFAULT 0,
  status text CHECK (status IN ('uploaded','mapping','validating','ready','importing','completed','failed','undone'))
                     NOT NULL DEFAULT 'uploaded',
  total_rows         INT          NOT NULL DEFAULT 0,
  processed_rows     INT          NOT NULL DEFAULT 0,
  created_count      INT          NOT NULL DEFAULT 0,
  updated_count      INT          NOT NULL DEFAULT 0,
  skipped_count      INT          NOT NULL DEFAULT 0,
  failed_count       INT          NOT NULL DEFAULT 0,
  headers            jsonb         NULL,
  mapping            jsonb         NULL,
  settings           jsonb         NULL,
  assignment         jsonb         NULL,
  error_message      TEXT         NULL,
  created_by_user_id varchar(36)     NULL,
  started_at         timestamptz(3)  NULL,
  finished_at        timestamptz(3)  NULL,
  undo_deadline_at   timestamptz(3)  NULL,
  undone_at          timestamptz(3)  NULL,
  created_at         timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_import_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- Every row of the file, with what became of it. This is what makes the failed
-- rows downloadable and the 24-hour undo possible: the import knows exactly
-- which contacts it created.
CREATE TABLE import_rows (
  id             varchar(36) NOT NULL PRIMARY KEY,
  import_id      varchar(36) NOT NULL,
  line_number    INT      NOT NULL,
  -- Named line_number rather than row_number: the latter is a reserved word
  -- once window functions exist, on MariaDB as well as MySQL 8.
  raw            jsonb     NOT NULL,
  normalized     jsonb     NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','created','updated','skipped','invalid','failed')),
  reason         VARCHAR(255) NULL,
  contact_id     varchar(36) NULL,
  opportunity_id varchar(36) NULL,
  CONSTRAINT uq_import_row UNIQUE (import_id, line_number),
  CONSTRAINT fk_import_row_import FOREIGN KEY (import_id) REFERENCES imports (id) ON DELETE CASCADE,
  CONSTRAINT fk_import_row_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE SET NULL,
  CONSTRAINT fk_import_row_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL
);

-- A saved column mapping, so the next file from the same source is one click.
CREATE TABLE import_mappings (
  id                 varchar(36)     NOT NULL PRIMARY KEY,
  name               VARCHAR(120) NOT NULL,
  mapping            jsonb         NOT NULL,
  created_by_user_id varchar(36)     NULL,
  created_at         timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at         timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_import_mapping_name UNIQUE (name),
  CONSTRAINT fk_import_mapping_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Lists and campaigns
-- ---------------------------------------------------------------------------

-- A static list holds explicit members; a smart list stores filters and is
-- evaluated when it is read, so it stays current on its own.
CREATE TABLE lists (
  id                 varchar(36)     NOT NULL PRIMARY KEY,
  name               VARCHAR(160) NOT NULL,
  description        VARCHAR(500) NULL,
  kind text NOT NULL DEFAULT 'static' CHECK (kind IN ('static','smart')),
  filters            jsonb         NULL,
  owner_user_id      varchar(36)     NULL,
  recycle_after_days INT          NULL,
  recycle_action text NULL CHECK (recycle_action IN ('reassign','pool')),
  created_by_user_id varchar(36)     NULL,
  created_at         timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at         timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_list_name UNIQUE (name),
  CONSTRAINT fk_list_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_list_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE list_members (
  list_id          varchar(36)    NOT NULL,
  contact_id       varchar(36)    NOT NULL,
  opportunity_id   varchar(36)    NULL,
  added_by_user_id varchar(36)    NULL,
  added_at         timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, contact_id),
  CONSTRAINT fk_list_member_list FOREIGN KEY (list_id) REFERENCES lists (id) ON DELETE CASCADE,
  CONSTRAINT fk_list_member_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_list_member_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL
);

-- A call campaign is worked by a person through the dialler; a WhatsApp
-- campaign is sent by a throttled background job under the bulk-send guard.
CREATE TABLE campaigns (
  id                 varchar(36)     NOT NULL PRIMARY KEY,
  name               VARCHAR(160) NOT NULL,
  kind text NOT NULL CHECK (kind IN ('call','whatsapp')),
  list_id            varchar(36)     NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','completed','cancelled')),
  template_name      VARCHAR(160) NULL,
  template_language  VARCHAR(12)  NULL,
  throttle_per_minute INT         NOT NULL DEFAULT 20,
  paused_reason      VARCHAR(255) NULL,
  total_members      INT          NOT NULL DEFAULT 0,
  skipped_no_consent INT          NOT NULL DEFAULT 0,
  created_by_user_id varchar(36)     NULL,
  started_at         timestamptz(3)  NULL,
  finished_at        timestamptz(3)  NULL,
  created_at         timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at         timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_campaign_list FOREIGN KEY (list_id) REFERENCES lists (id) ON DELETE SET NULL,
  CONSTRAINT fk_campaign_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE campaign_members (
  id               varchar(36)    NOT NULL PRIMARY KEY,
  campaign_id      varchar(36)    NOT NULL,
  contact_id       varchar(36)    NOT NULL,
  opportunity_id   varchar(36)    NULL,
  assigned_user_id varchar(36)    NULL,
  sort_order       INT         NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','sent','done','skipped','failed')),
  outcome text NULL CHECK (outcome IN ('answered','no_answer','busy','wrong_number','not_interested','interested')),
  attempts         INT         NOT NULL DEFAULT 0,
  skip_reason      VARCHAR(160) NULL,
  notes            TEXT        NULL,
  last_attempt_at  timestamptz(3) NULL,
  completed_at     timestamptz(3) NULL,
  CONSTRAINT uq_campaign_member UNIQUE (campaign_id, contact_id),
  CONSTRAINT fk_campaign_member_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT fk_campaign_member_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_campaign_member_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL,
  CONSTRAINT fk_campaign_member_agent FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- Imported leads do not start Workflow A, so an old database of 40,000 rows
-- cannot fire 40,000 welcome messages. This records where each opportunity came
-- from, so that decision is auditable rather than implicit in a job payload.
ALTER TABLE opportunities
  ADD COLUMN import_id varchar(36) NULL;

-- "Claim the oldest lead in the pool" is
--   WHERE owner_user_id IS NULL AND status = 'open' ORDER BY created_at LIMIT 1
--     FOR UPDATE SKIP LOCKED
-- Without this index that ORDER BY is a filesort, and a filesort reads and
-- locks every matching row before it can sort them — so the first agent to
-- press "Claim next lead" would lock the entire pool and everyone else would
-- be told it was empty. With the index the order comes for free and exactly
-- one row is locked.



-- Indexes (MySQL declares these inside CREATE TABLE).
CREATE INDEX idx_team_manager ON teams (manager_user_id);
CREATE INDEX idx_team_member_user ON team_members (user_id);
CREATE INDEX idx_assignment_rule_team ON assignment_rules (target_team_id);
CREATE INDEX idx_pool_user_open ON lead_pool_claims (user_id, released_at);
CREATE INDEX idx_pool_opportunity ON lead_pool_claims (opportunity_id);
CREATE INDEX idx_import_status ON imports (status, created_at);
CREATE INDEX idx_import_creator ON imports (created_by_user_id);
CREATE INDEX idx_import_row_status ON import_rows (import_id, status);
CREATE INDEX idx_import_row_contact ON import_rows (contact_id);
CREATE INDEX idx_list_owner ON lists (owner_user_id);
CREATE INDEX idx_list_member_contact ON list_members (contact_id);
CREATE INDEX idx_campaign_status ON campaigns (status, kind);
CREATE INDEX idx_campaign_list ON campaigns (list_id);
CREATE INDEX idx_campaign_member_work ON campaign_members (campaign_id, status, sort_order);
CREATE INDEX idx_campaign_member_agent ON campaign_members (campaign_id, assigned_user_id, status);
CREATE INDEX idx_opportunity_import ON opportunities (import_id);
CREATE INDEX idx_opportunity_pool ON opportunities (owner_user_id, status, created_at);

-- MySQL refreshes updated_at by itself; Postgres needs to be asked.
CREATE TRIGGER teams_set_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER assignment_rules_set_updated_at BEFORE UPDATE ON assignment_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER import_mappings_set_updated_at BEFORE UPDATE ON import_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER lists_set_updated_at BEFORE UPDATE ON lists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER campaigns_set_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
