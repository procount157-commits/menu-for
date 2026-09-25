-- What the employees say to each other.
--
-- Handoffs were already recorded, but a handoff is an event, not a sentence:
-- it says a conversation moved and why, and nothing about what the outgoing
-- employee knew that the incoming one needs. The owner asked to watch them
-- talk, and there was nothing to watch.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/016_agent_messages.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS agent_messages (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_role  VARCHAR(30) NOT NULL,
  -- NULL addresses the whole team — a notice rather than a message.
  to_role    VARCHAR(30),
  -- handoff | directive | alert | report | question | answer
  kind       VARCHAR(20) NOT NULL DEFAULT 'report',
  body       TEXT NOT NULL,
  -- The customer this is about, when it is about one.
  phone      VARCHAR(50),
  -- Set when the recipient has actually used it in a reply, which is the only
  -- meaning of "read" that matters for a bot.
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_messages      ON agent_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_to   ON agent_messages (user_id, to_role, read_at);
CREATE INDEX IF NOT EXISTS idx_agent_messages_phone ON agent_messages (user_id, phone, created_at DESC);
