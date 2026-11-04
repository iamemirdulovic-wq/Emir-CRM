-- Pictures and GIFs posted to the team wall.
--
-- `wall_posts.media` has always held a list of descriptors and the API has
-- always accepted them; nothing could put a file on the server. This is the
-- row behind each one.
--
-- A wall image is not a task attachment. It is posted to the whole floor
-- rather than attached to one record, so it gets its own table and its own
-- folder: deleting a post should be able to take its pictures with it,
-- without reaching into somebody's task.

CREATE TABLE wall_media (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  -- Absolute path on disk. Every read checks it resolves inside UPLOAD_DIR
  -- before opening it, because a stored `../../etc/passwd` is otherwise a
  -- file this CRM would happily serve.
  storage_path  VARCHAR(512) NOT NULL,
  content_type  VARCHAR(100) NOT NULL,
  -- What the uploader called it. Shown, never used to build a path.
  filename      VARCHAR(255) NOT NULL,
  bytes         INT UNSIGNED NOT NULL,
  uploaded_by_user_id CHAR(36) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_wall_media_user (uploaded_by_user_id, created_at),
  CONSTRAINT fk_wall_media_user FOREIGN KEY (uploaded_by_user_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
