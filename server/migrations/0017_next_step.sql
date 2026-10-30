-- The next step, and when anyone last spoke to them.
--
-- The CRM can already say what stage a lead is at. It cannot answer the two
-- questions an agent actually opens it with: who am I supposed to ring today,
-- and who have I not spoken to in a week. Stage does not answer either — a
-- lead can sit at "Engaged" for a month with nobody owing it anything.
--
-- `next_step_at` is the promise: a date somebody committed to. `last_contact_at`
-- is the record: when a human last reached out. Between them they drive every
-- tab on My Leads, and the "No next step" tab exists to be emptied.
--
-- Additive: new nullable columns and indexes. Existing rows are left NULL,
-- which reads as "nothing promised yet" — correct for every lead that predates
-- this, and exactly what the No next step tab is for.

ALTER TABLE opportunities
  ADD COLUMN next_step_type ENUM('call','whatsapp','email','meeting','viewing','other') NULL AFTER sub_status,
  ADD COLUMN next_step_at   DATETIME(3) NULL AFTER next_step_type,
  ADD COLUMN next_step_note VARCHAR(255) NULL AFTER next_step_at,
  -- Set by every outbound action: a call, a WhatsApp, an email. Distinct from
  -- `last_inbound_at` on contacts, which is when *they* last spoke to us.
  ADD COLUMN last_contact_at DATETIME(3) NULL AFTER next_step_note,
  -- Counted so "tried three times, never answered" is a fact rather than
  -- something an agent has to reconstruct from the timeline.
  ADD COLUMN no_answer_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER last_contact_at;

-- "What do I owe today?" — the default tab, so it gets its own index with the
-- deleted and status fences in front, which is how the query is written.
ALTER TABLE opportunities
  ADD KEY idx_opp_next_step (deleted_at, status, owner_user_id, next_step_at),
  ADD KEY idx_opp_last_contact (deleted_at, status, owner_user_id, last_contact_at);

-- Backfill: the last outbound thing anyone did, so "overdue" is true on day
-- one instead of marking every existing lead as never contacted.
UPDATE opportunities o
   SET o.last_contact_at = (
     SELECT MAX(a.created_at) FROM activities a
      WHERE a.opportunity_id = o.id
        AND a.type IN ('call', 'message.outbound', 'whatsapp', 'email_sent', 'no_answer')
   )
 WHERE o.last_contact_at IS NULL;

-- Where there is no activity at all, fall back to the first response time,
-- then to nothing. A lead nobody ever touched should read as untouched.
UPDATE opportunities
   SET last_contact_at = first_response_at
 WHERE last_contact_at IS NULL AND first_response_at IS NOT NULL;
