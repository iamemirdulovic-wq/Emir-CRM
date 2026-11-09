-- Who came to the office, and when.
--
-- Emir, Nov 9 2026: agents tap once when they arrive, and the tap only counts
-- from the office Wi-Fi. Someone at a sales centre marks "working outside"
-- instead, with a note, because an agent at Emaar all morning is doing the job
-- and must not read as absent.
--
-- One row per person per day, which is what `uq_attendance_day` enforces. The
-- alternative — a row per tap — turns "was Layla in on Tuesday" into a
-- group-by, and invites a double tap to look like two arrivals.
--
-- `seen_ip` is kept deliberately. The Wi-Fi check is a deterrent rather than a
-- lock: a VPN into the office, or a browser told to lie about its address,
-- defeats it. Recording what the server actually saw means a day that looks
-- wrong can be looked at, rather than argued about.

CREATE TABLE attendance (
  id          CHAR(36)    NOT NULL PRIMARY KEY,
  user_id     CHAR(36)    NOT NULL,
  -- The working day in Dubai, not UTC: a 10pm tap belongs to that evening's
  -- date for the person tapping, and the server runs on UTC.
  on_date     DATE        NOT NULL,
  -- 'office' only ever written after the address matched; 'outside' may be
  -- marked from anywhere, which is the point of it.
  kind        ENUM('office','outside') NOT NULL,
  marked_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- True when the tap landed after the day's start time plus the grace.
  -- Stored rather than computed later, because the hours can change and a
  -- past day must keep the verdict it was given on the day.
  was_late    TINYINT(1)  NOT NULL DEFAULT 0,
  -- Where they said they are. Only for 'outside'.
  note        VARCHAR(160) NULL,
  seen_ip     VARCHAR(45) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE KEY uq_attendance_day (user_id, on_date),
  KEY idx_attendance_date (on_date),
  CONSTRAINT fk_attendance_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
