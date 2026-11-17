-- Homes AI can hand an agent a ready message.
--
-- The assistant writes a WhatsApp or an email for a named lead and the agent
-- opens that lead with the words already in the box. It is still the agent who
-- presses send: this column holds a draft, never an outbox.
--
-- JSON rather than a table because a draft belongs to the one answer that
-- produced it, is never queried across rows, and dies with the conversation.
ALTER TABLE ai_messages
  ADD COLUMN drafts JSON NULL
  COMMENT 'Message drafts the assistant wrote with this answer. Never sent.';
