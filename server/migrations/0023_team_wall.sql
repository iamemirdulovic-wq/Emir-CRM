-- The Team Wall: what the floor is doing, and the points behind it.
--
-- A wall is a social feature in a tool people are paid to use, so two things
-- are built in from the start rather than added after somebody is upset:
--
--   * every post and comment can be deleted by its author and by an owner,
--     and a deleted one is a timestamp rather than a hole in a thread;
--   * deal values are hidden unless somebody deliberately shows them. What a
--     colleague earned is not everybody's business, and a wall that leaks it
--     is a wall people stop posting on.
--
-- Additive: six new tables.

CREATE TABLE IF NOT EXISTS wall_posts (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  author_id    CHAR(36)     NULL,
  kind         ENUM('post','deal_won','welcome','birthday','anniversary','badge','best_of_week','poll')
               NOT NULL DEFAULT 'post',
  body         TEXT         NULL,
  -- Uploaded images and video, as a list of note_files-style descriptors.
  media        JSON         NULL,
  -- For a poll: the question's options and who voted for what.
  poll         JSON         NULL,
  -- Who was tagged.
  mentions     JSON         NULL,
  -- What the post is about, when it was written by the CRM rather than a
  -- person: the deal, the badge, the person having a birthday.
  subject_type VARCHAR(32)  NULL,
  subject_id   VARCHAR(64)  NULL,
  -- Off unless somebody deliberately turns it on for this post.
  show_value   TINYINT(1)   NOT NULL DEFAULT 0,
  pinned_at    DATETIME(3)  NULL,
  pinned_by_user_id CHAR(36) NULL,
  deleted_at   DATETIME(3)  NULL,
  deleted_by_user_id CHAR(36) NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  KEY idx_wall_feed (deleted_at, pinned_at, created_at),
  KEY idx_wall_author (author_id, created_at),
  CONSTRAINT fk_wall_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_wall_pinner FOREIGN KEY (pinned_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS wall_comments (
  id         CHAR(36)    NOT NULL PRIMARY KEY,
  post_id    CHAR(36)    NOT NULL,
  author_id  CHAR(36)    NULL,
  body       TEXT        NOT NULL,
  mentions   JSON        NULL,
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  KEY idx_wall_comment_post (post_id, deleted_at, created_at),
  CONSTRAINT fk_wall_comment_post FOREIGN KEY (post_id) REFERENCES wall_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_wall_comment_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS wall_reactions (
  id         CHAR(36)    NOT NULL PRIMARY KEY,
  post_id    CHAR(36)    NOT NULL,
  user_id    CHAR(36)    NOT NULL,
  emoji      VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- One of each emoji per person per post, enforced rather than hoped for.
  UNIQUE KEY uq_wall_reaction (post_id, user_id, emoji),
  KEY idx_wall_reaction_post (post_id),
  CONSTRAINT fk_wall_reaction_post FOREIGN KEY (post_id) REFERENCES wall_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_wall_reaction_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Thanking a colleague. Five a week, so it means something.
CREATE TABLE IF NOT EXISTS kudos (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  from_user_id CHAR(36)   NOT NULL,
  to_user_id CHAR(36)     NOT NULL,
  reason     VARCHAR(400) NOT NULL,
  post_id    CHAR(36)     NULL,
  -- The Monday of the week it was given, in Dubai. The weekly allowance is
  -- counted against this rather than a rolling seven days, so everybody's
  -- five arrive at the same moment.
  week_of    DATE         NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  KEY idx_kudos_from_week (from_user_id, week_of),
  KEY idx_kudos_to (to_user_id, created_at),
  CONSTRAINT fk_kudos_from FOREIGN KEY (from_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_kudos_to FOREIGN KEY (to_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_kudos_post FOREIGN KEY (post_id) REFERENCES wall_posts (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Points, one row per thing that earned them. Never a running total in a
-- column: a total you can only add to is a total nobody can check, and the
-- first argument about somebody's score is unanswerable.
CREATE TABLE IF NOT EXISTS xp_events (
  id         CHAR(36)    NOT NULL PRIMARY KEY,
  user_id    CHAR(36)    NOT NULL,
  rule       VARCHAR(48) NOT NULL,
  points     SMALLINT    NOT NULL,
  -- What earned it, so the same lead cannot earn the same points twice.
  subject_type VARCHAR(32) NULL,
  subject_id VARCHAR(64)  NULL,
  -- The Dubai date, for daily caps.
  earned_on  DATE        NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- The anti-gaming rule, in the schema rather than in code: one award per
  -- rule per thing. Logging the same call twice earns nothing the second time.
  UNIQUE KEY uq_xp_once (user_id, rule, subject_type, subject_id),
  KEY idx_xp_user_day (user_id, earned_on),
  KEY idx_xp_user_time (user_id, created_at),
  CONSTRAINT fk_xp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS user_badges (
  id         CHAR(36)    NOT NULL PRIMARY KEY,
  user_id    CHAR(36)    NOT NULL,
  badge_key  VARCHAR(48) NOT NULL,
  -- Set when the person has been shown the unlock, so it is celebrated once.
  seen_at    DATETIME(3) NULL,
  earned_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE KEY uq_user_badge (user_id, badge_key),
  KEY idx_user_badge_unseen (user_id, seen_at),
  CONSTRAINT fk_user_badge_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
