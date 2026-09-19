-- Secrets the owner can set from inside the CRM.
--
-- The hard rule says secrets live in environment variables and tokens are
-- encrypted at rest. Both still hold: an environment variable always wins over
-- this table, and anything stored here is AES-256-GCM encrypted with
-- ENCRYPTION_KEY, which is itself an environment variable and never in the
-- database.
--
-- This exists because the owner cannot reach a terminal. Managed hosting means
-- every environment variable is a trip through a control panel and a restart,
-- and an API key that can only be set that way is an API key that never gets
-- set. The encryption key is the one thing that must come from the environment,
-- because a key stored beside the data it protects protects nothing.
CREATE TABLE app_secrets (
  name        VARCHAR(64)  NOT NULL PRIMARY KEY,
  -- v1:<iv>:<tag>:<ciphertext>. Never returned to a browser; the UI is shown
  -- the last four characters so a person can tell which key is in place.
  value_enc   TEXT         NOT NULL,
  hint        VARCHAR(32)  NULL,
  updated_by_user_id CHAR(36) NULL,
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_secret_user FOREIGN KEY (updated_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plain settings that are not secret but should not need a redeploy either:
-- which model to use, what the monthly cap is.
CREATE TABLE app_settings (
  name        VARCHAR(64)  NOT NULL PRIMARY KEY,
  value       VARCHAR(255) NULL,
  updated_by_user_id CHAR(36) NULL,
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_setting_user FOREIGN KEY (updated_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
