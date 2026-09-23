-- Business knowledge the bot answers from, the standing profile every answer
-- is written against, and a log of what it actually said.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/005_knowledge.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS knowledge_base (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(255) NOT NULL,
  content    TEXT NOT NULL,
  keywords   TEXT,
  category   VARCHAR(50),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kb_user ON knowledge_base (user_id, is_active);

CREATE TABLE IF NOT EXISTS business_profile (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(255),
  industry    VARCHAR(120),
  description TEXT,
  tone        VARCHAR(30) DEFAULT 'friendly',
  guardrails  TEXT,
  auto_reply  BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auto_reply_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone      VARCHAR(50) NOT NULL,
  incoming   TEXT,
  reply      TEXT,
  provider   VARCHAR(30),
  kb_ids     TEXT,
  intent     VARCHAR(20),
  skipped    VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auto_reply_user ON auto_reply_log (user_id, created_at);
