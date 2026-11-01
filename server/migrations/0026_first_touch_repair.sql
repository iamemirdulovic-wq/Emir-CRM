-- Repair `opportunities.first_touch_at`, which recorded a stage change rather
-- than a real attempt to reach the client.
--
-- Until now any move off `new_lead` set it, including closing a lead as Lost
-- and including moves made by the automation account. Two numbers are built on
-- this column and both were wrong because of it:
--
--   * the funnel's "Contacted" figure, which read 42 of 43 on a board where
--     most leads had never been called;
--   * speed-to-lead, whose median sat at exactly 7,200 seconds — the
--     follow-up timer, not a human being answering.
--
-- The code no longer writes it that way (see countsAsFirstTouch in
-- services/opportunities.ts). This repairs the rows already written, by
-- recomputing the column from the activity log, which is the only honest
-- record of whether anybody actually made contact.
--
-- REVERSIBLE. Every old value is copied into `first_touch_repair` before
-- anything changes, so the previous state can be restored with:
--
--   UPDATE opportunities o
--     JOIN first_touch_repair r ON r.opportunity_id = o.id
--      SET o.first_touch_at = r.old_first_touch_at;
--
-- Drop that table once the numbers have been checked and look right.

CREATE TABLE IF NOT EXISTS first_touch_repair (
  opportunity_id      CHAR(36)    NOT NULL PRIMARY KEY,
  old_first_touch_at  DATETIME(3) NULL,
  new_first_touch_at  DATETIME(3) NULL,
  repaired_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What counts as evidence that somebody reached the client: the activity types
-- the lead action bar writes for a call, a WhatsApp, a no-answer and a booked
-- meeting, plus a real outbound email. A stage change, a note, an assignment
-- and an automated follow-up are all absent on purpose.
INSERT INTO first_touch_repair (opportunity_id, old_first_touch_at, new_first_touch_at)
SELECT o.id,
       o.first_touch_at,
       (SELECT MIN(a.created_at)
          FROM activities a
         WHERE a.opportunity_id = o.id
           AND a.user_id IS NOT NULL
           AND a.type IN ('call', 'whatsapp', 'no_answer', 'meeting_set', 'email'))
  FROM opportunities o
 WHERE o.first_touch_at IS NOT NULL
ON DUPLICATE KEY UPDATE opportunity_id = first_touch_repair.opportunity_id;

UPDATE opportunities o
  JOIN first_touch_repair r ON r.opportunity_id = o.id
   SET o.first_touch_at = r.new_first_touch_at;
