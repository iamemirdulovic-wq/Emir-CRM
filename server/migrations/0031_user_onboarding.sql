-- The welcome an agent gets the first time they sign in.
--
-- Five questions about where they are going, asked once, kept so the owner can
-- read them and so the agent can change their mind later. Emir, Nov 4, 2026.
--
-- Two things are deliberate here.
--
-- **Skipping is a first-class state, not a missing row.** An agent at a sales
-- centre with a client in front of them must be able to get into the CRM in
-- two seconds. `skipped_at` says "asked, said not now", which is a different
-- thing from "never asked", and only the second one should nag.
--
-- **The agent is told the owner reads this**, in the flow itself, before the
-- first question. Answers somebody thought were private, quoted back at them
-- later, is how a team stops writing anything honest in a CRM.

CREATE TABLE user_onboarding (
  user_id        CHAR(36)     NOT NULL PRIMARY KEY,
  -- What they want to be called, which is not always what payroll calls them.
  -- Blank means fall back to users.name.
  preferred_name VARCHAR(80)  NULL,
  -- The five answers, keyed by question id. JSON rather than a column each:
  -- the questions are Emir's and will be reworded, and a reworded question
  -- must not need a migration.
  answers        JSON         NULL,
  -- Set when they reach the end. Null while they are part way through, so a
  -- half-finished welcome resumes where it stopped rather than starting over.
  completed_at   DATETIME(3)  NULL,
  -- Set when they chose "finish later". Cleared if they come back and finish.
  skipped_at     DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- The owner's screen lists who has finished and who has not.
  KEY idx_onboarding_done (completed_at),
  CONSTRAINT fk_onboarding_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
