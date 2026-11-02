-- Sign-in links: a one-time link emailed instead of typing a password.
--
-- Added alongside password sign-in, not in place of it. Owners and admins keep
-- passwords on purpose, so there is always an account that can get into the
-- CRM when email itself is the thing that is broken — which, on the day this
-- was written, it was.
--
-- The token is never stored. Only its SHA-256 hash is kept, the same way
-- session tokens are, so a copy of this table is not a set of working keys.

CREATE TABLE login_links (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  user_id       CHAR(36)     NOT NULL,
  -- SHA-256 of the token that went out in the email. Unique so a lookup is an
  -- index hit and two links can never collide.
  token_hash    CHAR(64)     NOT NULL,
  expires_at    DATETIME(3)  NOT NULL,
  -- Set the moment it is spent. A link works exactly once: a second use, a
  -- forwarded email, a link sitting in a browser history, all get nothing.
  used_at       DATETIME(3)  NULL,
  requested_ip  VARCHAR(45)  NULL,
  used_ip       VARCHAR(45)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_login_link_token (token_hash),
  -- The consume path looks up by hash; the request path expires the user's
  -- older unused links.
  KEY idx_login_link_user (user_id, used_at, expires_at),
  CONSTRAINT fk_login_link_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
