-- Task manager: attachments, and the state a deadline nudge needs.
--
-- The tasks table already carries title, notes, priority, due_at, assignee and
-- completion, because Workflows A and B have been creating call tasks since
-- Phase 5. What it has never had is a way to attach a photo to one, or any
-- memory of having warned somebody that a deadline was coming.

-- --------------------------------------------------------------------------
-- Deadline reminders
-- --------------------------------------------------------------------------

-- Written when the nudge goes out, so a sweep that runs every few minutes does
-- not email the same person about the same task over and over. Null means
-- "never warned", which is the state every task starts in.
ALTER TABLE tasks
  ADD COLUMN reminder_sent_at timestamptz(3) NULL;

-- The sweep asks: not done, not already warned, due within the window. Leading
-- with completed_at and reminder_sent_at puts the two null checks first, which
-- is what makes the range scan on due_at small — most tasks in a busy CRM are
-- done, and a done task is never reminded about.


-- The calendar asks for a window of time across a whole team, which the
-- existing idx_task_assignee_due cannot serve because it leads with the
-- assignee. This one leads with the date.


-- --------------------------------------------------------------------------
-- Attachments
-- --------------------------------------------------------------------------

CREATE TABLE task_attachments (
  id            varchar(36)     NOT NULL PRIMARY KEY,
  task_id       varchar(36)     NOT NULL,
  -- What the person called it. Shown, never used to build a path: the file on
  -- disk is named row's id, so nothing a user types can escape the
  -- upload directory.
  filename      VARCHAR(255) NOT NULL,
  content_type  VARCHAR(127) NOT NULL,
  byte_size     bigint NOT NULL,
  -- Absolute path on disk. Checked against UPLOAD_DIR before anything is ever
  -- read or deleted, the same guard the import files use.
  storage_path  VARCHAR(512) NOT NULL,
  uploaded_by_user_id varchar(36) NULL,
  created_at    timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_attachment_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT fk_attachment_uploader FOREIGN KEY (uploaded_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);


-- Indexes (MySQL declares these inside CREATE TABLE).
CREATE INDEX idx_attachment_task ON task_attachments (task_id, created_at);
CREATE INDEX idx_task_reminder ON tasks (completed_at, reminder_sent_at, due_at);
CREATE INDEX idx_task_due ON tasks (due_at, assigned_user_id);
