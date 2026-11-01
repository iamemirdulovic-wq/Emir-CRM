-- Close queue rows for leads that already have an owner.
--
-- A lead goes into unassigned_queue when nobody can be found for it, and the
-- row is marked resolved when somebody claims it from the Incoming screen or
-- when Workflow A finds an agent. The other ways a lead gets an owner — a
-- manager reassigning, a bulk assignment, the SLA handover — never touched
-- the row.
--
-- So the queue kept rows for leads that had been worked for days. Settings →
-- Health counted those rows and reported "5 leads waiting for an owner" while
-- the Incoming screen, which looks at the leads themselves, said "Nothing
-- waiting", and the unread notifications went on naming leads that were long
-- since picked up.
--
-- Health now counts the leads rather than the queue, so the two cannot
-- disagree again. This clears the rows that were already stranded.

UPDATE unassigned_queue q
  JOIN opportunities o ON o.id = q.opportunity_id
   SET q.resolved_at = NOW(3)
 WHERE q.resolved_at IS NULL
   AND (o.owner_user_id IS NOT NULL OR o.status <> 'open' OR o.deleted_at IS NOT NULL);
