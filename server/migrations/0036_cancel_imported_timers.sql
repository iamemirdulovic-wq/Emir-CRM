-- Call off the clocks already ticking on imported leads.
--
-- Emir imported 47 leads with "treat these as brand-new leads" ticked, and 47
-- five-minute timers were armed. The switch is gone now, but removing it does
-- nothing for the jobs already queued: each one still has its `run_at`, still
-- fires, and still takes the lead off the agent holding it.
--
-- This cancels those and only those: still pending, a speed-to-lead timer, and
-- on an opportunity that an import created. A lead that came from an ad, the
-- website or a hand-over keeps its clock, because those are the clocks that
-- are supposed to run.
--
-- An UPDATE with a WHERE, not a DELETE: the rows stay, so the history of what
-- was queued and what became of it is still readable afterwards.
UPDATE jobs j
  JOIN import_rows ir
    ON ir.opportunity_id = j.payload ->> '$.opportunityId'
   SET j.status = 'cancelled',
       j.last_error = 'Cancelled: a bulk import no longer starts the five-minute clock'
 WHERE j.status = 'pending'
   AND j.type IN ('workflow.a.sla_check', 'workflow.a.sla_reminder');
