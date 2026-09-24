-- Model provider credentials, so a key can be set from the UI and survive a
-- restart instead of living only in .env. Never returned by the API in full.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/010_llm_settings.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS llm_settings (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider   VARCHAR(30) NOT NULL,
  api_key    VARCHAR(400) NOT NULL,
  model      VARCHAR(120),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
