-- What Emir AI knows about this brokerage.
--
-- Not model training. The model is never reshaped — that is slow, expensive and
-- has to be redone every time a fact changes. This is *grounding*: text the
-- owner writes once, which is put in front of the model on every request. Edit
-- a line and the next answer already follows it.
--
-- The cost consideration is why `uses` exists. Everything in here is sent as
-- input tokens, every single call, so sending the whole thing to every feature
-- is how a cheap model produces an expensive bill. Each section declares which
-- features it is relevant to, and a request carries only those.

CREATE TABLE ai_knowledge (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  -- One of the fixed section keys in ai/knowledge.ts. Not free-form: the
  -- prompt builder has to know what each piece of text is for.
  section_key  VARCHAR(48)  NOT NULL,
  language     ENUM('en','ar') NOT NULL DEFAULT 'en',
  content      TEXT         NULL,
  updated_by_user_id CHAR(36) NULL,
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_knowledge (section_key, language),
  CONSTRAINT fk_knowledge_user FOREIGN KEY (updated_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every save keeps the previous text, so a bad edit is one click to undo. This
-- is the whole safety net for a screen that changes what every agent's AI says.
CREATE TABLE ai_knowledge_versions (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  section_key  VARCHAR(48)  NOT NULL,
  language     ENUM('en','ar') NOT NULL DEFAULT 'en',
  content      TEXT         NULL,
  updated_by_user_id CHAR(36) NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_knowledge_history (section_key, language, created_at),
  CONSTRAINT fk_knowledge_version_user FOREIGN KEY (updated_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What every AI request cost, so the monthly cap can be enforced and the owner
-- can see where the money went rather than only that it is gone.
CREATE TABLE ai_usage (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  user_id       CHAR(36)     NULL,
  feature       VARCHAR(48)  NOT NULL,
  model         VARCHAR(64)  NULL,
  input_tokens  INT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  -- Micro-dollars: integers, because money in floats is how totals drift.
  cost_micros   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ok            TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_usage_month (created_at, feature),
  CONSTRAINT fk_usage_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
