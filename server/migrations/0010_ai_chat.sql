-- Ask Emir AI: the conversations people have with the assistant.
--
-- Kept because the spec asks for it and because an AI that answers questions
-- about real buyers is one whose answers someone will eventually need to
-- check. A thread belongs to the person who asked: an agent's questions are
-- not their manager's reading material.

CREATE TABLE ai_conversations (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  user_id    CHAR(36)     NOT NULL,
  title      VARCHAR(160) NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_ai_conv_user (user_id, updated_at),
  CONSTRAINT fk_ai_conv_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ai_messages (
  id              CHAR(36)    NOT NULL PRIMARY KEY,
  conversation_id CHAR(36)    NOT NULL,
  role            ENUM('user','assistant') NOT NULL,
  body            TEXT        NOT NULL,
  -- Which read-only tools the assistant used to answer, so an answer can be
  -- traced back to where its numbers came from.
  tools_used      JSON        NULL,
  model           VARCHAR(64) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_ai_msg_conv (conversation_id, created_at),
  CONSTRAINT fk_ai_msg_conv FOREIGN KEY (conversation_id) REFERENCES ai_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
