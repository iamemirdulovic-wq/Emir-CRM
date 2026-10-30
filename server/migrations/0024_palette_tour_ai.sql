-- Step 14: what one person has seen, and what the AI thinks of a lead.
--
-- Three unrelated-looking things land together because they are all "something
-- the CRM remembers about a person or a lead that nobody typed into a form":
--
--  * `user_prefs` — the tour, and anything else that is this person's own
--    choice rather than a company setting. It is deliberately not `app_settings`:
--    that table is the company's, and a tour somebody finished on their laptop
--    should be finished on their phone too, which rules out localStorage.
--  * `lead_ai_scores` — one row per time the AI looked at a lead, kept rather
--    than overwritten, so "it said junk in March and hot in May" is a fact we
--    can show instead of a thing we have to take on trust.
--  * the digest columns on `opportunities` — the notes summary and the
--    suggested next step, cached beside the lead so opening it costs nothing.
--
-- Additive throughout: two new tables and nullable columns.

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id    CHAR(36)     NOT NULL,
  -- Short, known names: `tour_state`, `palette_recents`, `shortcuts_seen`.
  name       VARCHAR(48)  NOT NULL,
  -- JSON or a plain string, whichever the preference wants. Capped small on
  -- purpose: this is for choices, not for content.
  value      VARCHAR(1000) NULL,
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, name),
  CONSTRAINT fk_pref_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_ai_scores (
  id             CHAR(36)    NOT NULL PRIMARY KEY,
  opportunity_id CHAR(36)    NOT NULL,
  contact_id     CHAR(36)    NOT NULL,
  -- The four words an agent reads: hot, good, weak, junk. Deliberately not a
  -- number: a number invites being averaged, and this is a judgement.
  verdict        ENUM('hot','good','weak','junk') NOT NULL,
  -- One line, in words. Never a figure the AI invented: the prompt is given
  -- the lead's own stated budget and nothing else to quote.
  why            VARCHAR(255) NULL,
  -- What the rules alone said, what the AI moved it by, and the result. Stored
  -- separately so a wrong AI call can be seen for what it is rather than
  -- disappearing into one number.
  rule_score     SMALLINT     NOT NULL,
  adjustment     SMALLINT     NOT NULL DEFAULT 0,
  score          SMALLINT     NOT NULL,
  -- The suggestion, which an agent accepts or ignores. Nothing acts on it.
  next_step_type ENUM('call','whatsapp','email','meeting','viewing','other') NULL,
  next_step_in_days TINYINT UNSIGNED NULL,
  next_step_note VARCHAR(255) NULL,
  -- What it looked at, so a verdict can be argued with.
  signals        JSON         NULL,
  model          VARCHAR(64)  NULL,
  -- Bumped when the prompt or the weights change, so old verdicts are not
  -- quietly compared against new ones.
  version        VARCHAR(16)  NOT NULL DEFAULT 'v1',
  scored_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- "The latest verdict on this lead" — the only read the UI makes.
  KEY idx_ai_score_opp (opportunity_id, scored_at),
  KEY idx_ai_score_contact (contact_id, scored_at),
  -- The nightly sweep's own query: who has not been looked at lately.
  KEY idx_ai_score_when (scored_at),
  CONSTRAINT fk_ai_score_opp FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_score_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE opportunities
  -- The latest verdict, denormalised onto the lead so the pipeline board and
  -- My Leads can show a chip without joining a history table on every row.
  ADD COLUMN ai_verdict    ENUM('hot','good','weak','junk') NULL AFTER score_band,
  ADD COLUMN ai_verdict_at DATETIME(3) NULL AFTER ai_verdict,
  -- What the notes add up to, in three lines. Cached because the notes do not
  -- change between two page loads and a summary is not free.
  ADD COLUMN notes_digest  VARCHAR(1000) NULL AFTER ai_verdict_at,
  ADD COLUMN notes_digest_at DATETIME(3) NULL AFTER notes_digest,
  -- How many notes the digest covered. The cheapest possible staleness check:
  -- a fourth note means the three-line summary is now out of date.
  ADD COLUMN notes_digest_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER notes_digest_at;

-- The sweep picks leads by "when did we last look at this", so it needs an
-- index that puts the never-looked-at ones first behind the usual fences.
ALTER TABLE opportunities
  ADD KEY idx_opp_ai_verdict (deleted_at, status, ai_verdict_at);
