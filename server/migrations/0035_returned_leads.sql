-- Leads that came back to the person who gave them out.
--
-- When an agent runs out of time on a lead a person handed them, the lead
-- returns to that person. It then sits in their own leads looking like any
-- other lead of theirs, with no way to hand it on in bulk -- which is how
-- Emir ended up holding a pile of leads his agents were mid-conversation with
-- and no screen that would give them back.
--
-- This marks them, so Incoming can list them beside the leads nobody owns:
-- both are leads waiting to be placed. Cleared the moment the lead is given
-- to somebody, or worked by the person holding it.
ALTER TABLE opportunities
  ADD COLUMN returned_at DATETIME(3) NULL;

-- Read on every load of Incoming, which is behind the sidebar badge.
CREATE INDEX idx_opportunity_returned ON opportunities (owner_user_id, returned_at);

-- And the ones already stuck.
--
-- Leads came back under this rule for an hour before the column existed, so
-- they are sitting in somebody's own leads with nothing to mark them. The
-- activity written at the time is the record: find it and set the mark, so
-- they appear in Incoming like the rest.
--
-- Skipped if the person has since rung them, because then they are not
-- waiting for anybody.
UPDATE opportunities o
  JOIN activities a
    ON a.opportunity_id = o.id AND a.type = 'lead.returned'
   SET o.returned_at = a.created_at
 WHERE o.returned_at IS NULL
   AND o.status = 'open'
   AND o.owner_user_id IS NOT NULL
   AND o.deleted_at IS NULL
   AND (o.last_contact_at IS NULL OR o.last_contact_at < a.created_at);
