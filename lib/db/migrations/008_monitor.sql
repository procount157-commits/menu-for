-- Reports from the monitoring agent. One row per run, kept so a problem can be
-- traced backwards to when the verdict changed.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/008_monitor.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS monitor_reports (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level      VARCHAR(12) NOT NULL,
  summary    TEXT NOT NULL,
  findings   JSONB NOT NULL DEFAULT '[]'::jsonb,
  metrics    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monitor_reports_user ON monitor_reports (user_id, created_at);
