-- Repair leads that were moved back to an open stage but kept a closed status.
--
-- An action such as "Interested" or "No answer" on a Lost or Won lead moved
-- its stage and left `status` alone, so the Pipeline board drew it in an open
-- column while the dashboard counted it Lost (2,038 open against 2,037 in the
-- v2 test of 16 Nov 2026). The code now reopens the lead (leads/actions.ts);
-- this puts the rows already written in line with the stage the agent chose.
--
-- REVERSIBLE. Every row changed is copied into `reopened_status_repair` first,
-- so the previous state can be restored with:
--
--   UPDATE opportunities o JOIN reopened_status_repair r ON r.id = o.id
--      SET o.status = r.old_status, o.closed_at = r.old_closed_at;

CREATE TABLE IF NOT EXISTS reopened_status_repair (
  id            CHAR(36)    NOT NULL PRIMARY KEY,
  old_status    VARCHAR(16) NOT NULL,
  old_closed_at DATETIME(3) NULL,
  stage_key     VARCHAR(64) NOT NULL,
  repaired_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO reopened_status_repair (id, old_status, old_closed_at, stage_key)
SELECT id, status, closed_at, stage_key
  FROM opportunities
 WHERE status IN ('lost', 'won') AND stage_key NOT IN ('lost', 'won');

UPDATE opportunities
   SET status = 'open', closed_at = NULL
 WHERE status IN ('lost', 'won') AND stage_key NOT IN ('lost', 'won');
