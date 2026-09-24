-- The bots as named staff. A table rather than constants because the owner
-- expects to rename them, take one off duty, and hire more.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/009_employees.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS bot_employees (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(80) NOT NULL,
  role       VARCHAR(30) NOT NULL,
  kind       VARCHAR(20) NOT NULL DEFAULT 'customer',
  title      VARCHAR(120),
  avatar     VARCHAR(16),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bot_employees_user ON bot_employees (user_id);

-- One of each role per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_employees_role ON bot_employees (user_id, role);
