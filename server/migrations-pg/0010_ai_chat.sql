-- Ask Emir AI: the conversations people have with the assistant.
--
-- Kept because the spec asks for it and because an AI that answers questions
-- about real buyers is one whose answers someone will eventually need to
-- check. A thread belongs to the person who asked: an agent's questions are
-- not their manager's reading material.

CREATE TABLE ai_conversations (
  id         varchar(36)     NOT NULL PRIMARY KEY,
  user_id    varchar(36)     NOT NULL,
  title      VARCHAR(160) NULL,
  created_at timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_ai_conv_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE ai_messages (
  id              varchar(36)    NOT NULL PRIMARY KEY,
  conversation_id varchar(36)    NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  body            TEXT        NOT NULL,
  -- Which read-only tools the assistant used to answer, so an answer can be
  -- traced back to where its numbers came from.
  tools_used      jsonb        NULL,
  model           VARCHAR(64) NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT fk_ai_msg_conv FOREIGN KEY (conversation_id) REFERENCES ai_conversations (id) ON DELETE CASCADE
);


-- Indexes (MySQL declares these inside CREATE TABLE).
CREATE INDEX idx_ai_conv_user ON ai_conversations (user_id, updated_at);
CREATE INDEX idx_ai_msg_conv ON ai_messages (conversation_id, created_at);

-- MySQL refreshes updated_at by itself; Postgres needs to be asked.
CREATE TRIGGER ai_conversations_set_updated_at BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
