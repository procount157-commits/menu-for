-- What the bot remembers about a person between conversations.
-- Recent turns are read from wa_thread_messages; this is only the durable part.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/006_memory.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS contact_memory (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone      VARCHAR(50) NOT NULL,
  facts      JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary    TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, phone)
);
