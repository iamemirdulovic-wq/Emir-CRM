-- 0013: accept-or-bounce routing.
--
-- A lead is still assigned the moment it arrives — the 30-second reply is the
-- point of the system and nothing here delays it. What changes is what happens
-- next: the agent has to *accept* it and then *do* something, and if they do
-- not, it goes back to the owner rather than quietly to another agent.
--
-- No routing_status column. The state is already knowable from columns that
-- exist — owner_user_id NULL means it is waiting in Incoming, accepted_at NULL
-- means it was assigned but nobody has picked it up, bounce_count says how
-- many agents have let it go — and a second copy of that state is a second
-- thing to keep in step.

ALTER TABLE opportunities
  -- When the agent said "mine". Until then the first timer is running.
  ADD COLUMN accepted_at  DATETIME(3) NULL AFTER assigned_at,
  -- How many times an agent has been given this lead and let the clock run out.
  ADD COLUMN bounce_count INT NOT NULL DEFAULT 0 AFTER sla_breached;

-- Every time a lead was handed to someone, and what became of it.
--
-- `opportunities` only ever holds the current owner, so without this the
-- history is gone the moment a lead moves: who was slow, who actually worked
-- it, how long each one took to answer. The agent speed figures the owners
-- want all come from this table.
CREATE TABLE lead_assignments (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  opportunity_id  CHAR(36)     NOT NULL,
  contact_id      CHAR(36)     NOT NULL,
  agent_user_id   CHAR(36)     NOT NULL,
  -- NULL when the CRM assigned it by itself, which is the normal case.
  assigned_by_user_id CHAR(36) NULL,
  assigned_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  accepted_at     DATETIME(3)  NULL,
  first_action_at DATETIME(3)  NULL,
  outcome         ENUM('working','bounced','reassigned','closed') NOT NULL DEFAULT 'working',
  -- Assignment to first real action, in seconds. The one number that predicts
  -- whether a lead converts, so it is stored rather than recomputed from
  -- timestamps that later rows may overwrite.
  responded_in_seconds INT     NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_assign_agent (agent_user_id, assigned_at),
  KEY idx_assign_opportunity (opportunity_id, assigned_at),
  KEY idx_assign_open (outcome, assigned_at),
  CONSTRAINT fk_assign_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT fk_assign_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_assign_agent FOREIGN KEY (agent_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_assign_by FOREIGN KEY (assigned_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Incoming is "open, nobody owns it", read on every page load for the badge.
-- The existing idx_opp_owner starts with owner_user_id, which MySQL will not
-- use for IS NULL ordered by arrival, so Incoming gets its own.
CREATE INDEX idx_opp_incoming ON opportunities (status, owner_user_id, created_at);
