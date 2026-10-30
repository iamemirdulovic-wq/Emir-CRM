-- Files and voice notes on a lead note.
--
-- A voice note exists because of what an agent is doing when they have most to
-- say: walking out of a viewing, in the car, phone in one hand. Thirty seconds
-- of talking is a note that would otherwise never get typed, and a note that
-- is never typed is a client detail the team loses.
--
-- The bytes live on disk under UPLOAD_DIR, named after this row's id. The
-- filename the uploader chose is kept only to show and to download as.
--
-- Additive: one new table.

CREATE TABLE IF NOT EXISTS note_files (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  note_id       CHAR(36)     NOT NULL,
  -- Also on the contact, so a lead's files can be listed without walking
  -- every note, and so the permission check is one join rather than two.
  contact_id    CHAR(36)     NOT NULL,
  kind          ENUM('file','voice') NOT NULL DEFAULT 'file',
  filename      VARCHAR(255) NOT NULL,
  content_type  VARCHAR(100) NOT NULL,
  byte_size     INT UNSIGNED NOT NULL,
  -- Seconds, for a voice note only: the player shows the length before it
  -- downloads anything, so an agent knows whether they have time to listen.
  duration_s    SMALLINT UNSIGNED NULL,
  storage_path  VARCHAR(512) NOT NULL,
  uploaded_by_user_id CHAR(36) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  KEY idx_note_files_note (note_id),
  KEY idx_note_files_contact (contact_id, created_at),
  CONSTRAINT fk_note_files_note FOREIGN KEY (note_id) REFERENCES lead_notes (id) ON DELETE CASCADE,
  CONSTRAINT fk_note_files_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_note_files_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
