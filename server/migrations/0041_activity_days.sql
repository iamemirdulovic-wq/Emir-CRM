-- Minutes of use, per person per Dubai day.
--
-- `session_log.active_seconds` is one running total per sign-in, and a
-- remember-me sign-in lasts for weeks. Team activity added up only the
-- sessions *started* today, so somebody who signed in on Monday and worked
-- all Tuesday showed "0 min" and "Not seen today" on Tuesday while Team live
-- listed them as seen "now" (the v2 test, 16 Nov 2026).
--
-- The heartbeat now adds the same capped gap to this row as well, keyed by
-- the Dubai date of the beat, so a day's minutes are that day's whatever
-- session they came through.
--
-- Additive: one new table.

CREATE TABLE IF NOT EXISTS activity_days (
  user_id        CHAR(36)     NOT NULL,
  on_date        DATE         NOT NULL,
  active_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  first_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, on_date),
  KEY idx_activity_days_date (on_date),
  CONSTRAINT fk_activity_days_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
