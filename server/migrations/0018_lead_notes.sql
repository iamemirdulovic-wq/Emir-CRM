-- Notes that belong to somebody.
--
-- Until now an internal note was appended to the activity timeline as a plain
-- `note` row: no author shown beside it, no way to correct a typo, no way to
-- pin the one line that matters, and the client's objection scrolling out of
-- sight under three months of "called, no answer".
--
-- Nothing is moved or deleted. The old `note` activities stay exactly where
-- they are and keep showing in the timeline, and `contacts.notes` — which is
-- not team notes at all, but whatever the client typed into the ad form —
-- stays too; the lead page now shows it above the notes, labelled as theirs.
--
-- Additive: one new table.

CREATE TABLE IF NOT EXISTS lead_notes (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  contact_id    CHAR(36)     NOT NULL,
  -- Which enquiry it was about. Null for something true of the person rather
  -- than of one deal ("prefers to be called after 6").
  opportunity_id CHAR(36)    NULL,
  author_id     CHAR(36)     NULL,
  type          ENUM('general','call_summary','viewing_feedback','budget','objection','next_step')
                NOT NULL DEFAULT 'general',
  body          TEXT         NOT NULL,
  -- Pinned notes stay at the top for good: the budget, the objection, the
  -- thing you must not say. Everything else is history.
  pinned        TINYINT(1)   NOT NULL DEFAULT 0,
  attachments   JSON         NULL,
  -- Who was tagged, so a mention can be found later and not only when the
  -- notification arrives.
  mentions      JSON         NULL,
  edited_at     DATETIME(3)  NULL,
  deleted_at    DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- The panel's own query: this lead's notes, pinned first, newest after.
  KEY idx_notes_contact (contact_id, deleted_at, pinned, created_at),
  KEY idx_notes_opportunity (opportunity_id, deleted_at),
  KEY idx_notes_author (author_id, created_at),
  CONSTRAINT fk_notes_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_notes_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL,
  CONSTRAINT fk_notes_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
