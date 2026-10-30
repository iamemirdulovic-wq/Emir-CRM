-- Knowing who is working, and noticing the sign-in that does not belong.
--
-- `sessions` already carried ip, user_agent and last_seen_at, so most of
-- this is adding the things that make those readable: the device as a
-- fingerprint, the city, and whether anything about the sign-in was odd.
--
-- A session is deleted when it expires, so the history of who signed in from
-- where would go with it. `session_log` keeps that separately: one row per
-- sign-in, kept after the session itself is gone, which is what an owner
-- needs when they come to ask "who was in the CRM last Tuesday".
--
-- Additive: one new table, five new columns.

ALTER TABLE sessions ADD COLUMN device_key VARCHAR(80) NULL;
ALTER TABLE sessions ADD COLUMN device_label VARCHAR(120) NULL;
ALTER TABLE sessions ADD COLUMN city VARCHAR(120) NULL;
ALTER TABLE sessions ADD COLUMN country VARCHAR(120) NULL;
-- The current page, so Team Activity can say what somebody is doing rather
-- than only that they are there. Set by the heartbeat.
ALTER TABLE sessions ADD COLUMN current_path VARCHAR(160) NULL;


CREATE TABLE IF NOT EXISTS session_log (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  user_id       CHAR(36)     NOT NULL,
  -- The session this came from, kept as plain text rather than a foreign key:
  -- the session row is deleted on logout and this must outlive it.
  session_id    CHAR(64)     NULL,
  ip            VARCHAR(64)  NULL,
  network       VARCHAR(64)  NULL,
  device_key    VARCHAR(80)  NULL,
  device_label  VARCHAR(120) NULL,
  city          VARCHAR(120) NULL,
  country       VARCHAR(120) NULL,
  -- What was odd about it, if anything: new device, new country, the middle
  -- of the night, two countries too close together to have flown between.
  flags         JSON         NULL,
  -- The worst of those, so a list can be coloured without reading the JSON.
  level         ENUM('none','info','watch','alarm') NOT NULL DEFAULT 'none',
  signed_in_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  signed_out_at DATETIME(3)  NULL,
  last_seen_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- Seconds of actual use, totted up from the heartbeats rather than from
  -- sign-in to sign-out: a laptop left open all weekend is not ten hours of
  -- work, and counting it that way makes every report a lie.
  active_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  KEY idx_session_log_user (user_id, signed_in_at),
  KEY idx_session_log_level (level, signed_in_at),
  KEY idx_session_log_session (session_id),
  CONSTRAINT fk_session_log_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
