-- 0004: make Workflow A exactly-once per opportunity.
--
-- The application-level "has it already run?" check was a read followed by a
-- write, so two concurrent callers — a retried job and a direct call — could
-- both pass it and send the lead two welcome messages.
--
-- `singleton_key` is set by the application to 'A:<opportunity_id>' for
-- Workflow A and left NULL for every other workflow. A unique index treats
-- NULLs as distinct, so the constraint binds Workflow A alone and the INSERT
-- itself becomes the lock.
--
-- A plain column rather than a generated one: MariaDB rejects CASE expressions
-- in GENERATED ALWAYS AS, and this has to work on MySQL 8 and MariaDB alike.

ALTER TABLE workflow_runs
  ADD COLUMN singleton_key VARCHAR(96) NULL,
  ADD UNIQUE KEY uq_workflow_run_singleton (singleton_key);
