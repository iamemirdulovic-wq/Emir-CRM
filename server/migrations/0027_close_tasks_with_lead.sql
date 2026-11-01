-- Tasks outlived the lead they belonged to.
--
-- Marking a lead Won or Lost cleared its next step but left its tasks open, so
-- the team's Tasks list filled with "Call the lead" on leads closed weeks ago,
-- overdue since the day the lead died and impossible to clear without opening
-- each one by hand. It is also most of the reason Tasks reported 94 overdue
-- while the dashboard reported 2.
--
-- A task dropped because its lead closed is not a task somebody completed, and
-- recording it as completed would quietly inflate everyone's numbers. So it
-- gets its own column.

ALTER TABLE tasks
  ADD COLUMN cancelled_at DATETIME(3) NULL AFTER completed_by_user_id,
  ADD COLUMN cancelled_reason VARCHAR(64) NULL AFTER cancelled_at;

-- "Open" is now two null checks, and every list and count asks for both.
ALTER TABLE tasks
  ADD KEY idx_task_open (completed_at, cancelled_at, due_at);

-- Close the ones already stranded: open tasks whose lead is no longer open.
UPDATE tasks t
  JOIN opportunities o ON o.id = t.opportunity_id
   SET t.cancelled_at = NOW(3),
       t.cancelled_reason = 'lead_closed'
 WHERE t.completed_at IS NULL
   AND t.cancelled_at IS NULL
   AND o.status IN ('won', 'lost');
