-- Notifications that survive the phone being face-down.
--
-- Push today is fire-and-forget: it goes to the device or it does not, and
-- either way nothing is written down. An agent whose phone was in a pocket, or
-- who never allowed notifications, has no way to find out that a lead was
-- given to them at 11:40 — the information existed for a second and then did
-- not. The bell needs somewhere to read from.
--
-- Additive: one new table, nothing existing touched.

CREATE TABLE IF NOT EXISTS notifications (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  user_id       CHAR(36)     NOT NULL,
  type          VARCHAR(48)  NOT NULL,
  title         VARCHAR(160) NOT NULL,
  body          VARCHAR(500) NULL,
  -- Where it goes when tapped. A path, not a URL: the domain has moved once
  -- already and a stored link would still point at the old one.
  link          VARCHAR(255) NULL,
  contact_id    CHAR(36)     NULL,
  opportunity_id CHAR(36)    NULL,
  priority      ENUM('normal','high') NOT NULL DEFAULT 'normal',
  read_at       DATETIME(3)  NULL,
  sent_push_at  DATETIME(3)  NULL,
  sent_email_at DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- The bell's own query: this person's, newest first.
  KEY idx_notifications_user (user_id, created_at),
  -- And the unread count beside it, which runs on every page.
  KEY idx_notifications_unread (user_id, read_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
