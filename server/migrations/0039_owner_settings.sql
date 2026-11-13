-- 0039: what the owner's own settings screens need behind them.
--
-- Eight screens were audited against their design files (docs/v2/audit-4.md
-- §36-43, audit-2.md §21) and most of what was missing was missing because
-- there was nowhere to put it. This is that: the columns and tables the
-- feedback inbox, the home banners and the system-health page read.
--
-- Nothing here is dropped or rewritten. Every column is added with a default
-- that matches what the running CRM already does, so a row written before this
-- migration reads the same afterwards.

-- ---------------------------------------------------------------------------
-- 1. Feedback: a number to quote, a title to scan, an urgency, and a thread
-- ---------------------------------------------------------------------------

-- `design/web/feedback-inbox.html` is a table whose first column is `#1042`
-- and whose second is a short title with "where · when" beneath it. The build
-- had neither: it used the whole report body as the heading, so a long report
-- became a paragraph-length row, and there was no way for an owner and an
-- agent to refer to the same report out loud.
--
-- `ref` is a plain counter rather than AUTO_INCREMENT, because the table
-- already has an AUTO_INCREMENT-free CHAR(36) primary key and MySQL allows
-- only one auto column. It is assigned in `v2/feedback.ts` under the table
-- lock, and is UNIQUE so two writers cannot land on the same number.
ALTER TABLE feedback_tickets
  ADD COLUMN ref INT NULL AFTER id,
  ADD COLUMN title VARCHAR(160) NULL AFTER kind,
  ADD COLUMN urgency ENUM('low','normal','blocking') NOT NULL DEFAULT 'normal' AFTER blocking,
  ADD COLUMN screenshot_path VARCHAR(500) NULL AFTER screen,
  ADD COLUMN voice_path VARCHAR(500) NULL AFTER screenshot_path,
  ADD COLUMN voice_seconds INT NULL AFTER voice_path,
  ADD UNIQUE KEY uq_feedback_ref (ref);

-- The design's four type chips are Bug · Issue · New feature · Idea. The
-- column is an ENUM of three written in migration 0036: bug, idea, question.
--
-- Widening it would be `ALTER TABLE ... MODIFY`, which `migrations.safety.test.ts`
-- refuses on principle: a MODIFY can truncate real values, and every push to
-- this branch is a release to ten people mid-morning. So the full type gets a
-- column of its own beside the old one, exactly as `lost_reason_v2` sits
-- beside `lost_reason` in 0038:
--
--   * `kind_v2` holds what the agent actually picked, in the design's words.
--   * `kind` keeps being written with the nearest of its own three, so
--     anything still reading the old column carries on working.
--
-- The backfill maps what was stored to what was *shown*: the old build's
-- third option was labelled "Issue" on screen and stored as `question`
-- (`KIND_WORD` in the old `Feedback.tsx`), so that is what it becomes.
ALTER TABLE feedback_tickets
  ADD COLUMN kind_v2 VARCHAR(24) NULL AFTER kind;

UPDATE feedback_tickets
   SET kind_v2 = CASE kind
     WHEN 'question' THEN 'issue'
     ELSE kind
   END;

-- Every report that already exists gets a number, oldest first, so the
-- sequence runs the same way round as the dates.
SET @n := 1000;
UPDATE feedback_tickets SET ref = (@n := @n + 1) ORDER BY created_at, id;

-- `blocking` already says "this stops me working". It stays — the sweep that
-- sorts the inbox reads it — and the new column carries the design's third
-- value, which the old boolean could not express.
UPDATE feedback_tickets SET urgency = 'blocking' WHERE blocking = 1;

-- A thread, not one reply.
--
-- `feedback_tickets.reply` holds exactly one answer and overwrites it, so
-- "planned, later phase" replacing "we are looking at it" lost the first
-- half of the conversation. The single column stays as the latest reply, for
-- the agent's own page which reads it; this is where the whole exchange lives.
CREATE TABLE feedback_replies (
  id          CHAR(36)    NOT NULL PRIMARY KEY,
  ticket_id   CHAR(36)    NOT NULL,
  author_id   CHAR(36)    NULL,
  body        TEXT        NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_feedback_reply_ticket (ticket_id, created_at),
  CONSTRAINT fk_feedback_reply_ticket FOREIGN KEY (ticket_id)
    REFERENCES feedback_tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_feedback_reply_author FOREIGN KEY (author_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The replies already written keep their place at the front of their thread.
INSERT INTO feedback_replies (id, ticket_id, author_id, body, created_at)
SELECT UUID(), id, replied_by, reply, COALESCE(replied_at, updated_at)
  FROM feedback_tickets
 WHERE reply IS NOT NULL AND TRIM(reply) <> '';

-- ---------------------------------------------------------------------------
-- 2. Banners: the label, the button, where it goes, and who sees it
-- ---------------------------------------------------------------------------

-- `design/web/home-banners.html` asks for five things the table could not
-- hold: the coloured label above the headline (From Emir / Office / Project /
-- Best of Homes / Training), the words on the button, which of four places
-- the button opens, and whether the banner is for everyone, for agents only,
-- or for one desk.
ALTER TABLE banners
  ADD COLUMN label VARCHAR(40) NOT NULL DEFAULT 'From Emir' AFTER title,
  ADD COLUMN button_text VARCHAR(40) NULL AFTER body,
  ADD COLUMN opens VARCHAR(40) NOT NULL DEFAULT 'Project page' AFTER button_text,
  ADD COLUMN audience ENUM('everyone','agents','desk') NOT NULL DEFAULT 'everyone' AFTER opens,
  ADD COLUMN desk_id CHAR(36) NULL AFTER audience,
  ADD CONSTRAINT fk_banner_desk FOREIGN KEY (desk_id) REFERENCES desks (id) ON DELETE SET NULL;

-- "seen by 9 of 10". One row the first time a person is shown a banner; the
-- count is what tells an owner whether anybody read the thing.
CREATE TABLE banner_views (
  banner_id  CHAR(36)    NOT NULL,
  user_id    CHAR(36)    NOT NULL,
  first_seen DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (banner_id, user_id),
  CONSTRAINT fk_banner_view_banner FOREIGN KEY (banner_id) REFERENCES banners (id) ON DELETE CASCADE,
  CONSTRAINT fk_banner_view_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. System health: history, so the bars mean something
-- ---------------------------------------------------------------------------

-- `design/web/system-health.html` draws a thirty-day bar per service, a
-- response time, an uptime percentage in a tooltip and a timeline of past
-- problems. None of that could be true, because nothing was recorded: the
-- page could only ever say what was configured at the moment you opened it,
-- and the build said so rather than drawing green bars nobody was counting.
--
-- This is the recording. One row per service per check, written by the
-- `health.check` job every five minutes, which is what the design's own
-- sub-line promises ("Checked by itself every 5 minutes").
--
-- `state` is three-valued on purpose. "Not configured" is not the same fault
-- as "configured and slow", and collapsing them is how an owner ends up
-- phoning an agent about a push problem that is really a missing key.
CREATE TABLE service_checks (
  id         CHAR(36)    NOT NULL PRIMARY KEY,
  service    VARCHAR(40) NOT NULL,
  state      ENUM('ok','slow','down') NOT NULL,
  -- How long the check itself took, where there is something to time.
  ms         INT         NULL,
  -- One short line for the screen: "6.2 GB used", "no device registered".
  note       VARCHAR(200) NULL,
  checked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_service_check (service, checked_at),
  KEY idx_service_check_time (checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
