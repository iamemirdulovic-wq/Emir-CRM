-- Everything the new version needs that does not exist yet.
--
-- The master prompt v3 (12 Nov 2026) asks for a CRM roughly twice the size of
-- the one running today. Sixteen of its tables had no equivalent at all, which
-- is the honest measure of the job: it is not a re-skin.
--
-- Two rules hold throughout, and they are what make the switch reversible:
--
--   1. This file only ADDS. No table is dropped, no column renamed, no type
--      changed. The build running today could still run against this schema
--      afterwards, which is what lets us roll back in one step for fourteen
--      days after the cutover.
--   2. Every new column on an existing table is nullable or has a default, so
--      a row written by the old code is still a valid row.
--
-- Money is not stored here at all; where a price appears it is an integer of
-- fils, never a float, as the brief has required from the start.

-- ---------------------------------------------------------------------------
-- 1. Calls, and the check-in rule
-- ---------------------------------------------------------------------------

-- Every call an agent starts from the CRM.
--
-- The CRM cannot know whether a call connected -- it hands the number to the
-- phone and the phone takes over. So this records the attempt and what the
-- agent said happened, and never claims more than that. `outcome` NULL means
-- the agent has not answered yet, which is itself worth reporting on.
--
-- `not_checked_in` is the whole point of the check-in rule. An agent who taps
-- "call anyway" is not stopped, but the call carries the flag and owners see
-- it. Stored on the call rather than worked out later, because the shift
-- times can change and a past call must keep the verdict it was given.
CREATE TABLE call_logs (
  id              CHAR(36)    NOT NULL PRIMARY KEY,
  opportunity_id  CHAR(36)    NULL,
  contact_id      CHAR(36)    NOT NULL,
  user_id         CHAR(36)    NOT NULL,
  started_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- What the agent reported. NULL until they answer.
  outcome         ENUM('interested','no_answer','busy','call_back','wrong_number','not_interested') NULL,
  outcome_at      DATETIME(3) NULL,
  note            VARCHAR(500) NULL,
  -- Set when the agent chose "call anyway" while not checked in.
  not_checked_in  TINYINT(1)  NOT NULL DEFAULT 0,
  -- Which screen it was started from, so the dialler can be measured against
  -- one-off calls from a lead page.
  source          ENUM('lead','dialler','followup','incoming','other') NOT NULL DEFAULT 'lead',
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_call_user_day (user_id, started_at),
  KEY idx_call_contact (contact_id, started_at),
  KEY idx_call_opportunity (opportunity_id, started_at),
  KEY idx_call_unanswered (user_id, outcome, started_at),
  KEY idx_call_flagged (not_checked_in, started_at),
  CONSTRAINT fk_call_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_call_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL,
  CONSTRAINT fk_call_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. WhatsApp and Telegram, without an API
-- ---------------------------------------------------------------------------

-- The agent opened WhatsApp. That is all this records, and all it may record.
--
-- There is no WhatsApp API in the new version: each agent messages from their
-- own number, and the CRM only opens the app with a message ready. So it logs
-- the tap, measures how long the agent was away, and asks what happened when
-- they come back. "Sent" is a word this table is never allowed to write,
-- because the CRM did not send anything.
--
-- `answered_at` NULL is a question still open, and those surface on My Day and
-- on the lead until the agent answers them.
CREATE TABLE message_taps (
  id             CHAR(36)    NOT NULL PRIMARY KEY,
  opportunity_id CHAR(36)    NULL,
  contact_id     CHAR(36)    NOT NULL,
  user_id        CHAR(36)    NOT NULL,
  app            ENUM('whatsapp','telegram') NOT NULL,
  -- The message the CRM put in front of them. Kept because an agent editing
  -- it before sending is useful to know, and because a template that nobody
  -- ever sends unedited is a template to rewrite.
  template_key   VARCHAR(80)  NULL,
  message_text   TEXT         NULL,
  tapped_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- How long the app had focus. Seconds, and NULL when the browser could not
  -- tell us -- which is a real case, not a bug.
  away_seconds   INT          NULL,
  result         ENUM('sent','replied','no_reply','wrong_number','changed_mind','not_sent') NULL,
  answered_at    DATETIME(3) NULL,
  note           VARCHAR(500) NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tap_open (user_id, answered_at, tapped_at),
  KEY idx_tap_contact (contact_id, tapped_at),
  KEY idx_tap_opportunity (opportunity_id, tapped_at),
  CONSTRAINT fk_tap_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_tap_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL,
  CONSTRAINT fk_tap_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A link the CRM made, so it can tell the agent when the client opened it.
CREATE TABLE tracking_links (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  -- The short code in the URL. Unique, and the only thing the public sees.
  code           VARCHAR(24)  NOT NULL,
  opportunity_id CHAR(36)     NULL,
  contact_id     CHAR(36)     NULL,
  user_id        CHAR(36)     NULL,
  kind           ENUM('brochure','payment_plan','location','video','project','offer','other')
                 NOT NULL DEFAULT 'other',
  target_url     VARCHAR(1000) NOT NULL,
  label          VARCHAR(160) NULL,
  revoked_at     DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tracking_code (code),
  KEY idx_tracking_contact (contact_id, created_at),
  CONSTRAINT fk_tracking_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_tracking_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL,
  CONSTRAINT fk_tracking_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per open. Deliberately not deduplicated: a client who opens the
-- brochure four times in an evening is the signal, and collapsing that into
-- "opened: yes" throws the signal away.
CREATE TABLE link_opens (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  link_id    CHAR(36)     NOT NULL,
  opened_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- Coarse on purpose. Enough to say "opened from Dubai on a phone", never
  -- enough to follow somebody around.
  device     VARCHAR(40)  NULL,
  city       VARCHAR(80)  NULL,
  KEY idx_open_link (link_id, opened_at),
  CONSTRAINT fk_open_link FOREIGN KEY (link_id) REFERENCES tracking_links (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. The calendar, which does not exist in the CRM at all today
-- ---------------------------------------------------------------------------

-- A plan: a meeting, a site visit, a call, a follow-up, a team event.
--
-- `lead_id` is nullable because a team event belongs to nobody's lead, but the
-- design picks a lead from a list rather than free text for everything else.
--
-- The result is the part that matters. A meeting whose result nobody records
-- is a meeting that did not teach us anything, so `result` NULL after the end
-- time is what the 20:00 reminder and the owner's 21:00 report both look for.
CREATE TABLE meetings (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  opportunity_id CHAR(36)     NULL,
  contact_id     CHAR(36)     NULL,
  user_id        CHAR(36)     NOT NULL,
  kind           ENUM('meeting','site_visit','call','follow_up','team') NOT NULL DEFAULT 'meeting',
  title          VARCHAR(160) NULL,
  starts_at      DATETIME(3)  NOT NULL,
  ends_at        DATETIME(3)  NOT NULL,
  -- A plan may cross midnight and may cross months; the design says so and
  -- the week and month views both have to cope.
  all_day        TINYINT(1)   NOT NULL DEFAULT 0,
  place          VARCHAR(200) NULL,
  reminder_minutes INT        NULL,
  result         ENUM('showed','no_show','rescheduled','booked','cancelled') NULL,
  result_note    VARCHAR(500) NULL,
  -- How warm they were, recorded here because this is the only place in the
  -- whole design where interest is set. "Hot" on My Day reads from this.
  interest       ENUM('hot','warm','cold') NULL,
  result_at      DATETIME(3)  NULL,
  cancelled_by   ENUM('client','us')       NULL,
  created_by     CHAR(36)     NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3)  NULL,
  KEY idx_meeting_day (user_id, starts_at),
  KEY idx_meeting_opportunity (opportunity_id, starts_at),
  -- The query behind "who has not told us how it went": ended, no result.
  KEY idx_meeting_unanswered (result, ends_at),
  CONSTRAINT fk_meeting_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_meeting_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE SET NULL,
  CONSTRAINT fk_meeting_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL,
  CONSTRAINT fk_meeting_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. Attendance: working outside, and leave
-- ---------------------------------------------------------------------------

-- A trip out of the office.
--
-- The location is stored once, when it is shared, and never again -- the brief
-- is explicit about that, and a record that quietly keeps following somebody
-- is a different product from the one Emir asked for.
CREATE TABLE outside_trips (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  user_id     CHAR(36)     NOT NULL,
  on_date     DATE         NOT NULL,
  reason      VARCHAR(200) NOT NULL,
  -- Typed, and required by the design: "somewhere" is not an answer an owner
  -- can do anything with.
  place       VARCHAR(200) NOT NULL,
  with_whom   VARCHAR(200) NULL,
  back_by     DATETIME(3)  NULL,
  left_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  returned_at DATETIME(3)  NULL,
  -- Shared once, at the start. Null when they chose not to.
  lat         DECIMAL(9,6) NULL,
  lng         DECIMAL(9,6) NULL,
  note        VARCHAR(500) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_trip_user_day (user_id, on_date),
  KEY idx_trip_open (user_id, returned_at),
  CONSTRAINT fk_trip_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE leave_requests (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  user_id       CHAR(36)     NOT NULL,
  kind          ENUM('annual','sick','unpaid','emergency','other') NOT NULL DEFAULT 'annual',
  from_date     DATE         NOT NULL,
  to_date       DATE         NOT NULL,
  -- Working days, counted when the request is made and kept, so changing the
  -- days off later does not rewrite a decision somebody already took.
  working_days  INT          NOT NULL DEFAULT 0,
  reason        VARCHAR(500) NULL,
  note_path     VARCHAR(500) NULL,
  status        ENUM('pending','approved','refused','cancelled') NOT NULL DEFAULT 'pending',
  decided_by    CHAR(36)     NULL,
  decided_at    DATETIME(3)  NULL,
  -- Required when refusing, and changeable afterwards: the design says an
  -- owner may change their mind, and a refusal with no reason is the thing
  -- an agent cannot act on.
  decision_note VARCHAR(500) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_leave_user (user_id, from_date),
  KEY idx_leave_pending (status, from_date),
  CONSTRAINT fk_leave_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_leave_decider FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The office networks, as rows rather than one packed setting.
--
-- They have lived in `app_settings.ATT_OFFICE_IPS` as a JSON list since 10 Nov,
-- which works but cannot say who added one or when. The design has an owner
-- adding and removing them with at least one always present, so they become
-- rows. The old setting is left exactly where it is: the live build still
-- reads it, and this migration must not break the build it is replacing.
CREATE TABLE office_networks (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  label       VARCHAR(80)  NOT NULL,
  -- The address the office's traffic arrives from. Not a Wi-Fi name: no
  -- browser will ever tell a web page the Wi-Fi name. See docs/v2/decisions.md §5.
  ip          VARCHAR(45)  NOT NULL,
  added_by    CHAR(36)     NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  removed_at  DATETIME(3)  NULL,
  UNIQUE KEY uq_office_ip (ip),
  CONSTRAINT fk_office_adder FOREIGN KEY (added_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. Moving a lead between people
-- ---------------------------------------------------------------------------

-- One agent asking another to take a lead.
--
-- The lead stays with the sender until the receiver accepts -- that is the
-- rule that stops a lead falling into a gap between two people. Everything
-- about the request is kept, including the reason, because the question this
-- table really answers is asked months later and starts "whose commission".
CREATE TABLE lead_transfers (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  opportunity_id CHAR(36)     NOT NULL,
  from_user_id   CHAR(36)     NOT NULL,
  to_user_id     CHAR(36)     NOT NULL,
  reason         ENUM('language','leave','client_asked','knows_project','too_many','other') NOT NULL,
  note           VARCHAR(500) NULL,
  status         ENUM('pending','needs_approval','accepted','refused','expired','cancelled')
                 NOT NULL DEFAULT 'pending',
  -- A transfer out of Meeting or Offer needs an owner first, and then the
  -- receiver still has to accept. Two gates, not one.
  approved_by    CHAR(36)     NULL,
  approved_at    DATETIME(3)  NULL,
  decided_at     DATETIME(3)  NULL,
  requested_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- End of the working day. No answer by then and the request lapses.
  expires_at     DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_transfer_to (to_user_id, status, requested_at),
  KEY idx_transfer_from (from_user_id, status, requested_at),
  KEY idx_transfer_approval (status, requested_at),
  KEY idx_transfer_opportunity (opportunity_id, requested_at),
  CONSTRAINT fk_transfer_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT fk_transfer_from FOREIGN KEY (from_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_transfer_to FOREIGN KEY (to_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_transfer_approver FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A VIP lead the owner handed to somebody, and what became of it.
--
-- Separate from `lead_assignments` because a VIP hand-off has a deadline and a
-- promise attached, and the owner's "VIP leads I gave" screen is a list of
-- promises kept or broken rather than a history of ownership.
CREATE TABLE vip_handoffs (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  opportunity_id CHAR(36)     NOT NULL,
  given_by       CHAR(36)     NOT NULL,
  given_to       CHAR(36)     NOT NULL,
  -- The per-lead choice: 15 min, 30 min, 1 hour, today. It beats the default
  -- in Automations where it is set -- see docs/v2/decisions.md §2.1.
  call_within_minutes INT     NULL,
  deadline_at    DATETIME(3)  NULL,
  accepted_at    DATETIME(3)  NULL,
  refused_at     DATETIME(3)  NULL,
  refused_note   VARCHAR(500) NULL,
  first_call_at  DATETIME(3)  NULL,
  returned_at    DATETIME(3)  NULL,
  private_note   VARCHAR(500) NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_vip_owner (given_by, created_at),
  KEY idx_vip_agent (given_to, accepted_at),
  KEY idx_vip_due (deadline_at, first_call_at),
  CONSTRAINT fk_vip_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT fk_vip_giver FOREIGN KEY (given_by) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_vip_taker FOREIGN KEY (given_to) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 6. Desks, projects on sale, banners, feedback
-- ---------------------------------------------------------------------------

-- A desk is a group of agents for routing and import.
--
-- `teams` already exists and is close, but it carries a manager and is used by
-- the live assignment rules; a desk carries a maximum number of open leads
-- instead. Rather than widen `teams` and change what the running code means by
-- it mid-deploy, desks are their own thing. If they turn out to be the same
-- idea, merging them later is a decision with data to look at.
CREATE TABLE desks (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  name           VARCHAR(120) NOT NULL,
  description    VARCHAR(500) NULL,
  max_open_leads INT          NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_desk_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE desk_members (
  desk_id    CHAR(36)    NOT NULL,
  user_id    CHAR(36)    NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (desk_id, user_id),
  KEY idx_desk_member_user (user_id),
  CONSTRAINT fk_desk_member_desk FOREIGN KEY (desk_id) REFERENCES desks (id) ON DELETE CASCADE,
  CONSTRAINT fk_desk_member_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The projects the team is selling right now.
--
-- `projects` is the full library -- units, prices, payment plans, documents.
-- This is the short list an agent sees on My Day with the owner's own pitch
-- next to it, which is a different question from "what is in the library".
CREATE TABLE live_projects (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  project_id   CHAR(36)     NULL,
  -- Kept as text as well, so a project removed from the library does not
  -- silently empty this list.
  name         VARCHAR(200) NOT NULL,
  status       ENUM('selling_now','launching_soon','hidden') NOT NULL DEFAULT 'selling_now',
  pitch        TEXT         NULL,
  brochure_path VARCHAR(500) NULL,
  position     INT          NOT NULL DEFAULT 0,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_live_project_status (status, position),
  CONSTRAINT fk_live_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What the owner puts at the top of everyone's My Day.
CREATE TABLE banners (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  title      VARCHAR(160) NOT NULL,
  body       VARCHAR(500) NULL,
  link_url   VARCHAR(500) NULL,
  image_path VARCHAR(500) NULL,
  starts_at  DATETIME(3)  NULL,
  ends_at    DATETIME(3)  NULL,
  position   INT          NOT NULL DEFAULT 0,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  created_by CHAR(36)     NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_banner_live (is_active, position),
  CONSTRAINT fk_banner_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "Report a bug or an idea", and what the owner did about it.
CREATE TABLE feedback_tickets (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  user_id     CHAR(36)     NOT NULL,
  kind        ENUM('bug','idea','question') NOT NULL DEFAULT 'bug',
  body        TEXT         NOT NULL,
  -- Where they were when they reported it. Saves the first question back.
  screen      VARCHAR(160) NULL,
  status      ENUM('new','planned','fixed','declined') NOT NULL DEFAULT 'new',
  reply       TEXT         NULL,
  replied_by  CHAR(36)     NULL,
  replied_at  DATETIME(3)  NULL,
  -- Something that stops an agent working, which the owner's list sorts first.
  blocking    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_feedback_open (status, blocking, created_at),
  KEY idx_feedback_user (user_id, created_at),
  CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_feedback_replier FOREIGN KEY (replied_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 7. Notifications: per-alert switches, quiet hours, the Telegram backup
-- ---------------------------------------------------------------------------

-- One row per person per alert. Absent means the alert's own default.
CREATE TABLE notification_prefs (
  user_id    CHAR(36)    NOT NULL,
  alert_key  VARCHAR(60) NOT NULL,
  push       TINYINT(1)  NOT NULL DEFAULT 1,
  in_app     TINYINT(1)  NOT NULL DEFAULT 1,
  email      TINYINT(1)  NOT NULL DEFAULT 0,
  telegram   TINYINT(1)  NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, alert_key),
  CONSTRAINT fk_npref_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE telegram_links (
  user_id     CHAR(36)     NOT NULL PRIMARY KEY,
  chat_id     VARCHAR(40)  NOT NULL,
  username    VARCHAR(80)  NULL,
  linked_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  unlinked_at DATETIME(3)  NULL,
  UNIQUE KEY uq_telegram_chat (chat_id),
  CONSTRAINT fk_telegram_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 8. New columns on tables that already exist
-- ---------------------------------------------------------------------------

-- All nullable or defaulted, so a row the live build writes is still valid.
--
-- `stage_v2` sits BESIDE `stage_key` rather than replacing it. The two
-- vocabularies line up almost one to one, but renaming in place would break
-- the running build the moment the new one deployed, and there would be no way
-- back. Both are written during the overlap; the old one is retired months
-- after the switch, as its own decision.
ALTER TABLE opportunities
  ADD COLUMN stage_v2 ENUM('new','called','interested','meeting','offer','won','lost') NULL,
  ADD COLUMN is_vip TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN source_detail VARCHAR(160) NULL,
  ADD COLUMN wants VARCHAR(500) NULL,
  -- `lost_reason` is deliberately absent: opportunities already has one.
  ADD COLUMN no_show_count INT NOT NULL DEFAULT 0,
  ADD COLUMN desk_id CHAR(36) NULL;

ALTER TABLE opportunities
  ADD KEY idx_opp_vip (is_vip, created_at),
  ADD KEY idx_opp_stage_v2 (stage_v2, created_at);

ALTER TABLE contacts
  ADD COLUMN telegram VARCHAR(40) NULL,
  ADD COLUMN whatsapp_number VARCHAR(32) NULL,
  ADD COLUMN nationality VARCHAR(80) NULL;

-- Profile fields the design needs: the languages an agent speaks feed the
-- language filter in lead transfer and in Meet the team, and the BRN is
-- required on the business card.
-- `languages` and `brn` are already on `users`; only `title` and the quiet
-- hours are new. Checked against the real schema rather than assumed -- the
-- first draft of this migration added all three and failed on the duplicates.
ALTER TABLE users
  ADD COLUMN title VARCHAR(80) NULL,
  ADD COLUMN quiet_from VARCHAR(5) NULL,
  ADD COLUMN quiet_to VARCHAR(5) NULL;
