-- 0003: push tokens, ad feedback, brochure tracking, AI field provenance.

CREATE TABLE push_tokens (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  user_id    CHAR(36)     NOT NULL,
  token      VARCHAR(512) NOT NULL,
  platform   ENUM('web','android','ios') NOT NULL DEFAULT 'web',
  last_used_at DATETIME(3) NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_push_token (token(191)),
  KEY idx_push_user (user_id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lead-quality events reported back to Meta (CAPI for CRM) and Google (offline
-- conversions). One row per (opportunity, event) so we never double-report.
CREATE TABLE conversion_events (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  opportunity_id CHAR(36)     NOT NULL,
  contact_id     CHAR(36)     NOT NULL,
  destination    ENUM('meta','google') NOT NULL,
  event_name     VARCHAR(48)  NOT NULL,
  event_time     DATETIME(3)  NOT NULL,
  status         ENUM('pending','sent','skipped','failed') NOT NULL DEFAULT 'pending',
  request_payload JSON        NULL,
  response       JSON         NULL,
  error          VARCHAR(512) NULL,
  sent_at        DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_conversion_event (opportunity_id, destination, event_name),
  KEY idx_conversion_status (status, created_at),
  CONSTRAINT fk_conversion_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT fk_conversion_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Branded brochure links: /b/{project}?a={agent}
CREATE TABLE brochure_views (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  project_id  CHAR(36)     NULL,
  project_slug VARCHAR(120) NOT NULL,
  agent_user_id CHAR(36)   NULL,
  contact_id  CHAR(36)     NULL,
  ip          VARCHAR(64)  NULL,
  user_agent  VARCHAR(512) NULL,
  referrer    VARCHAR(1024) NULL,
  viewed_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_brochure_project (project_slug, viewed_at),
  KEY idx_brochure_agent (agent_user_id, viewed_at),
  KEY idx_brochure_contact (contact_id, viewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Provenance for AI-filled fields so the UI can show the "AI-filled" chip and
-- the agent can confirm or reject each one.
CREATE TABLE ai_field_suggestions (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  contact_id     CHAR(36)     NOT NULL,
  opportunity_id CHAR(36)     NULL,
  field          VARCHAR(80)  NOT NULL,
  value          VARCHAR(500) NOT NULL,
  confidence     DECIMAL(4,3) NULL,
  model          VARCHAR(80)  NULL,
  source_message_id CHAR(36)  NULL,
  status         ENUM('suggested','applied','confirmed','rejected') NOT NULL DEFAULT 'suggested',
  reviewed_by_user_id CHAR(36) NULL,
  reviewed_at    DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_ai_contact (contact_id, status),
  KEY idx_ai_opportunity (opportunity_id, status),
  CONSTRAINT fk_ai_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Round-robin cursor + per-agent counters, updated under SELECT … FOR UPDATE.
CREATE TABLE assignment_state (
  id             VARCHAR(48)  NOT NULL PRIMARY KEY,
  cursor_user_id CHAR(36)     NULL,
  counters       JSON         NULL,
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Leads nobody could take. Managers are alerted and work this queue.
CREATE TABLE unassigned_queue (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  opportunity_id CHAR(36)     NOT NULL,
  contact_id     CHAR(36)     NOT NULL,
  reason         VARCHAR(160) NOT NULL,
  resolved_at    DATETIME(3)  NULL,
  resolved_by_user_id CHAR(36) NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_unassigned_opportunity (opportunity_id),
  KEY idx_unassigned_open (resolved_at, created_at),
  CONSTRAINT fk_unassigned_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
