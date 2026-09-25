-- Employees become agents: each with a personality, a specialty that decides
-- what reaches them, and a colleague to hand a conversation to.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/011_agent_personas.sql
-- Safe to re-run.

ALTER TABLE bot_employees
  ADD COLUMN IF NOT EXISTS persona     TEXT,
  ADD COLUMN IF NOT EXISTS specialties JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS handoff_to  VARCHAR(30),
  ADD COLUMN IF NOT EXISTS priority    INTEGER NOT NULL DEFAULT 100;

-- Which agent handled a conversation, and why it moved between them.
CREATE TABLE IF NOT EXISTS agent_handoffs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone       VARCHAR(50) NOT NULL,
  from_role   VARCHAR(30),
  to_role     VARCHAR(30) NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_handoffs_user ON agent_handoffs (user_id, phone, created_at);

-- Who is currently on a conversation, so a thread does not change hands on
-- every message.
CREATE TABLE IF NOT EXISTS conversation_owner (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone      VARCHAR(50) NOT NULL,
  role       VARCHAR(30) NOT NULL,
  since      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, phone)
);

-- Which employee sent a reply, so each card's numbers are its own.
ALTER TABLE auto_reply_log
  ADD COLUMN IF NOT EXISTS agent_role VARCHAR(30);
CREATE INDEX IF NOT EXISTS idx_auto_reply_agent ON auto_reply_log (user_id, agent_role, created_at);
