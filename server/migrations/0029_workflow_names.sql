-- Name the workflows after what they do.
--
-- "Workflow A", "Workflow B" and "Workflow C" are the names from the original
-- brief. They mean something to whoever wrote the brief and nothing to the
-- person reading the Automations screen, who has to learn a mapping before
-- they can tell whether the thing that is switched off matters.
--
-- The keys are unchanged — code and job rows refer to those, not the names.

UPDATE workflows SET
  name = 'New lead — assign and welcome',
  description = 'Picks an agent, sends the WhatsApp welcome, alerts their phone, and takes the lead back if nobody touches it within five minutes.'
 WHERE `key` = 'A_instant_capture';

UPDATE workflows SET
  name = 'No reply — chase for four days',
  description = 'Follows up at 2 hours, 24 hours and 3 days, then marks the lead Lost as unresponsive. Stops the moment they reply.'
 WHERE `key` = 'B_no_response_followup';

UPDATE workflows SET
  name = 'They replied — route it',
  description = 'Cancels the chasing, moves the lead to Engaged, works out what they asked for and answers or hands it to the agent.'
 WHERE `key` = 'C_inbound_routing';
