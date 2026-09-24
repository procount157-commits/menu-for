-- The operator's internal assistant. Threads are kept server-side so a
-- conversation survives a reload and follows the user between devices.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/007_assistant.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS assistant_threads (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(255) NOT NULL DEFAULT 'محادثة جديدة',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assistant_threads_user ON assistant_threads (user_id, updated_at);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id         SERIAL PRIMARY KEY,
  thread_id  INTEGER NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       VARCHAR(12) NOT NULL,
  content    TEXT NOT NULL,
  provider   VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assistant_msgs_thread ON assistant_messages (thread_id, created_at);
