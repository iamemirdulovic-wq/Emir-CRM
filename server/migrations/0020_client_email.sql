-- Client email: templates, campaigns, and what happened to each message.
--
-- Three things deliberately NOT here:
--
-- 1. No `email_messages` table. A sent email is a message in `messages`,
--    beside the WhatsApp and the notes, because the unified inbox is one
--    thread per contact. A parallel table would mean the inbox had to read
--    two places and would drift the first time one of them gained a column.
--
-- 2. No unsubscribe-token column. The token is an HMAC of the contact id, so
--    there is nothing to create before the first email and nothing to look up
--    on the click.
--
-- 3. No change to the `campaigns.kind` enum. Email campaigns get their own
--    table rather than an ALTER that rewrites a live table in place.
--
-- Additive: four new tables, three new columns.

CREATE TABLE IF NOT EXISTS email_templates (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  -- Stable key for the ones the CRM ships, e.g. 'first_reply'. Null for one
  -- somebody wrote themselves.
  template_key  VARCHAR(64)  NULL,
  name          VARCHAR(160) NOT NULL,
  category      ENUM('first_reply','follow_up','project','appointment','offer','nurture','other')
                NOT NULL DEFAULT 'other',
  language      VARCHAR(12)  NOT NULL DEFAULT 'en',
  subject       VARCHAR(255) NOT NULL,
  -- What the agent typed: paragraphs, with {{merge_fields}}. The branded
  -- wrapper is added at send time, so changing the branding does not mean
  -- editing every template.
  body          MEDIUMTEXT   NOT NULL,
  -- The line shown under the subject in an inbox list.
  preview_text  VARCHAR(255) NULL,
  -- A template the CRM ships. Editable, but never deleted: an agent who
  -- deletes "First reply" leaves the team with no first reply.
  is_system     TINYINT(1)   NOT NULL DEFAULT 0,
  enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) NULL,
  updated_by_user_id CHAR(36) NULL,
  deleted_at    DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY uq_email_template_key (template_key, language),
  KEY idx_email_template_list (enabled, deleted_at, category),
  CONSTRAINT fk_email_template_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_email_template_editor FOREIGN KEY (updated_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS email_campaigns (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(160) NOT NULL,
  list_id       CHAR(36)     NULL,
  template_id   CHAR(36)     NULL,
  subject       VARCHAR(255) NOT NULL,
  body          MEDIUMTEXT   NOT NULL,
  preview_text  VARCHAR(255) NULL,
  -- Whose name and signature it goes out under.
  from_user_id  CHAR(36)     NULL,
  status        ENUM('draft','scheduled','sending','paused','sent','cancelled')
                NOT NULL DEFAULT 'draft',
  scheduled_at  DATETIME(3)  NULL,
  -- Sending a thousand emails in a minute is how a new domain gets blocked.
  throttle_per_hour INT      NOT NULL DEFAULT 200,

  total_members      INT NOT NULL DEFAULT 0,
  skipped_no_consent INT NOT NULL DEFAULT 0,
  sent_count         INT NOT NULL DEFAULT 0,
  opened_count       INT NOT NULL DEFAULT 0,
  clicked_count      INT NOT NULL DEFAULT 0,
  bounced_count      INT NOT NULL DEFAULT 0,
  unsubscribed_count INT NOT NULL DEFAULT 0,
  failed_count       INT NOT NULL DEFAULT 0,

  created_by_user_id CHAR(36) NULL,
  started_at    DATETIME(3)  NULL,
  finished_at   DATETIME(3)  NULL,
  deleted_at    DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  KEY idx_email_campaign_status (status, scheduled_at),
  CONSTRAINT fk_email_campaign_list FOREIGN KEY (list_id) REFERENCES lists (id) ON DELETE SET NULL,
  CONSTRAINT fk_email_campaign_template FOREIGN KEY (template_id) REFERENCES email_templates (id) ON DELETE SET NULL,
  CONSTRAINT fk_email_campaign_sender FOREIGN KEY (from_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_email_campaign_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS email_campaign_members (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  campaign_id   CHAR(36)     NOT NULL,
  contact_id    CHAR(36)     NOT NULL,
  -- The row in `messages` once it has been sent, so the campaign report and
  -- the contact's inbox thread are the same record.
  message_id    CHAR(36)     NULL,
  status        ENUM('pending','sent','skipped','failed') NOT NULL DEFAULT 'pending',
  -- Why it was skipped, in words: "no email address", "unsubscribed".
  reason        VARCHAR(160) NULL,
  sent_at       DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- One send per person per campaign, enforced rather than hoped for: a
  -- retried job must never email the same client twice.
  UNIQUE KEY uq_email_campaign_member (campaign_id, contact_id),
  KEY idx_email_member_status (campaign_id, status),
  KEY idx_email_member_contact (contact_id),
  CONSTRAINT fk_email_member_campaign FOREIGN KEY (campaign_id) REFERENCES email_campaigns (id) ON DELETE CASCADE,
  CONSTRAINT fk_email_member_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_email_member_message FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- What happened after it left: opened, clicked, bounced, complained.
-- A row per event rather than a flag per message, because "opened four times
-- over two days" is a different lead from "opened once".
CREATE TABLE IF NOT EXISTS email_events (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  message_id    CHAR(36)     NULL,
  contact_id    CHAR(36)     NOT NULL,
  campaign_id   CHAR(36)     NULL,
  type          ENUM('delivered','opened','clicked','bounced','complained','unsubscribed','deferred')
                NOT NULL,
  url           VARCHAR(1024) NULL,
  user_agent    VARCHAR(255) NULL,
  city          VARCHAR(120) NULL,
  -- The provider's own id for this event, so a webhook delivered twice is
  -- recorded once.
  provider_event_id VARCHAR(191) NULL,
  occurred_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE KEY uq_email_event_provider (provider_event_id),
  KEY idx_email_event_message (message_id, type),
  KEY idx_email_event_contact (contact_id, occurred_at),
  KEY idx_email_event_campaign (campaign_id, type),
  CONSTRAINT fk_email_event_message FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE,
  CONSTRAINT fk_email_event_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_email_event_campaign FOREIGN KEY (campaign_id) REFERENCES email_campaigns (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Summary columns on the message itself, so the inbox can show "opened" on a
-- thread of fifty messages without reading every event for each one.
ALTER TABLE messages ADD COLUMN opened_at  DATETIME(3) NULL;
ALTER TABLE messages ADD COLUMN clicked_at DATETIME(3) NULL;
ALTER TABLE messages ADD COLUMN email_campaign_id CHAR(36) NULL;


-- The agent's own details, which the email signature needs today and the
-- business card in Step 12 needs next. A property email from a name, a mobile
-- and a BRN gets answered; one from "Marketing" does not.
ALTER TABLE users ADD COLUMN job_title VARCHAR(120) NULL;
-- Broker Registration Number. A UAE broker must show it on client-facing
-- material, so it is a field, not a line someone remembers to type.
ALTER TABLE users ADD COLUMN brn VARCHAR(40) NULL;
ALTER TABLE users ADD COLUMN photo_url VARCHAR(500) NULL;
