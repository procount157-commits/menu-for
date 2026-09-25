-- An employee that learns, a list of duties, and a manager over them.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/012_agent_memory_tasks.sql
-- Safe to re-run.

-- What an employee carries from one conversation to the next.
--   instruction — a standing order the owner wrote. Always obeyed.
--   win / loss  — an approach that did or did not lead anywhere, learnt from
--                 what the customer said next.
--   gap         — a question it could not answer.
CREATE TABLE IF NOT EXISTS agent_memory (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(30) NOT NULL,
  kind        VARCHAR(20) NOT NULL,
  content     TEXT NOT NULL,
  -- How often this has been seen. A lesson observed nine times outranks one
  -- seen once, which is what makes the list worth reading back.
  times       INTEGER NOT NULL DEFAULT 1,
  -- Set for win/loss so a lesson can be traced to the exchange behind it.
  phone       VARCHAR(50),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_memory ON agent_memory (user_id, role, kind, times DESC);
-- One row per distinct lesson per employee, so repeats increment rather than pile up.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_uniq
  ON agent_memory (user_id, role, kind, md5(content));

-- An employee can be given more than one duty.
CREATE TABLE IF NOT EXISTS agent_tasks (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(30) NOT NULL,
  task        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_tasks ON agent_tasks (user_id, role, sort_order);

-- What the manager concluded on its last round, and what it told whom.
CREATE TABLE IF NOT EXISTS manager_reviews (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary     TEXT NOT NULL,
  directives  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_manager_reviews ON manager_reviews (user_id, created_at DESC);

-- The reply an outcome is attributed to. Without this the learner cannot tell
-- which of an employee's replies the customer was reacting to.
ALTER TABLE auto_reply_log
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(20);
