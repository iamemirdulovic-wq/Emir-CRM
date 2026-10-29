-- 0003: push tokens, ad feedback, brochure tracking, AI field provenance.

CREATE TABLE push_tokens (
  id         varchar(36)     NOT NULL PRIMARY KEY,
  user_id    varchar(36)     NOT NULL,
  token      VARCHAR(512) NOT NULL,
  platform text NOT NULL DEFAULT 'web' CHECK (platform IN ('web','android','ios')),
  last_used_at timestamptz(3) NULL,
  created_at timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_push_token UNIQUE (token),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Lead-quality events reported back to Meta (CAPI for CRM) and Google (offline
-- conversions). One row per (opportunity, event) so we never double-report.
CREATE TABLE conversion_events (
  id             varchar(36)     NOT NULL PRIMARY KEY,
  opportunity_id varchar(36)     NOT NULL,
  contact_id     varchar(36)     NOT NULL,
  destination text NOT NULL CHECK (destination IN ('meta','google')),
  event_name     VARCHAR(48)  NOT NULL,
  event_time     timestamptz(3)  NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','skipped','failed')),
  request_payload jsonb        NULL,
  response       jsonb         NULL,
  error          VARCHAR(512) NULL,
  sent_at        timestamptz(3)  NULL,
  created_at     timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_conversion_event UNIQUE (opportunity_id, destination, event_name),
  CONSTRAINT fk_conversion_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT fk_conversion_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
);

-- Branded brochure links: /b/{project}?a={agent}
CREATE TABLE brochure_views (
  id          varchar(36)     NOT NULL PRIMARY KEY,
  project_id  varchar(36)     NULL,
  project_slug VARCHAR(120) NOT NULL,
  agent_user_id varchar(36)   NULL,
  contact_id  varchar(36)     NULL,
  ip          VARCHAR(64)  NULL,
  user_agent  VARCHAR(512) NULL,
  referrer    VARCHAR(1024) NULL,
  viewed_at   timestamptz(3)  NOT NULL DEFAULT now()
);

-- Provenance for AI-filled fields so the UI can show the "AI-filled" chip and
-- the agent can confirm or reject each one.
CREATE TABLE ai_field_suggestions (
  id             varchar(36)     NOT NULL PRIMARY KEY,
  contact_id     varchar(36)     NOT NULL,
  opportunity_id varchar(36)     NULL,
  field          VARCHAR(80)  NOT NULL,
  value          VARCHAR(500) NOT NULL,
  confidence     numeric(4,3) NULL,
  model          VARCHAR(80)  NULL,
  source_message_id varchar(36)  NULL,
  status text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','applied','confirmed','rejected')),
  reviewed_by_user_id varchar(36) NULL,
  reviewed_at    timestamptz(3)  NULL,
  created_at     timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_ai_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
);

-- Round-robin cursor + per-agent counters, updated under SELECT … FOR UPDATE.
CREATE TABLE assignment_state (
  id             VARCHAR(48)  NOT NULL PRIMARY KEY,
  cursor_user_id varchar(36)     NULL,
  counters       jsonb         NULL,
  updated_at     timestamptz(3)  NOT NULL DEFAULT now()
);

-- Leads nobody could take. Managers are alerted and work this queue.
CREATE TABLE unassigned_queue (
  id             varchar(36)     NOT NULL PRIMARY KEY,
  opportunity_id varchar(36)     NOT NULL,
  contact_id     varchar(36)     NOT NULL,
  reason         VARCHAR(160) NOT NULL,
  resolved_at    timestamptz(3)  NULL,
  resolved_by_user_id varchar(36) NULL,
  created_at     timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_unassigned_opportunity UNIQUE (opportunity_id),
  CONSTRAINT fk_unassigned_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE
);


-- Indexes (MySQL declares these inside CREATE TABLE).
CREATE INDEX idx_push_user ON push_tokens (user_id);
CREATE INDEX idx_conversion_status ON conversion_events (status, created_at);
CREATE INDEX idx_brochure_project ON brochure_views (project_slug, viewed_at);
CREATE INDEX idx_brochure_agent ON brochure_views (agent_user_id, viewed_at);
CREATE INDEX idx_brochure_contact ON brochure_views (contact_id, viewed_at);
CREATE INDEX idx_ai_contact ON ai_field_suggestions (contact_id, status);
CREATE INDEX idx_ai_opportunity ON ai_field_suggestions (opportunity_id, status);
CREATE INDEX idx_unassigned_open ON unassigned_queue (resolved_at, created_at);

-- MySQL refreshes updated_at by itself; Postgres needs to be asked.
CREATE TRIGGER assignment_state_set_updated_at BEFORE UPDATE ON assignment_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
