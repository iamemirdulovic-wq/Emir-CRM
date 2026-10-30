-- An agent's own page, and the card they send to clients.
--
-- `users` already gained job_title, brn and photo_url for the email
-- signature. This is the rest: the things that belong to the person rather
-- than to their login, and the public slug the business card is served from.
--
-- Separate from `users` on purpose. A profile is edited by the person
-- themselves and read by the public; a user row carries the password hash,
-- the role and the routing weight. Keeping them apart means the query that
-- serves a public business card cannot accidentally select a password hash.
--
-- Additive: one new table.

CREATE TABLE IF NOT EXISTS agent_profiles (
  user_id        CHAR(36)     NOT NULL PRIMARY KEY,
  -- The public card lives at /card/{slug}. Not the user id: an id in a URL
  -- somebody shares is an id anybody can count upwards from.
  slug           VARCHAR(80)  NOT NULL,
  headline       VARCHAR(160) NULL,
  bio            TEXT         NULL,
  -- Which of the generated covers. No photograph: a stock skyline is either
  -- licensed or stolen, and the CRM must not be either.
  cover_key      VARCHAR(40)  NOT NULL DEFAULT 'marina-dusk',
  languages      JSON         NULL,
  specialities   JSON         NULL,
  -- Where a client can reach them, separately from the login email.
  public_phone   VARCHAR(32)  NULL,
  public_email   VARCHAR(255) NULL,
  whatsapp       VARCHAR(32)  NULL,
  instagram      VARCHAR(120) NULL,
  linkedin       VARCHAR(160) NULL,
  joined_on      DATE         NULL,
  -- Off by default. A card nobody switched on is a card that cannot leak.
  is_public      TINYINT(1)   NOT NULL DEFAULT 0,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY uq_agent_profile_slug (slug),
  CONSTRAINT fk_agent_profile_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
