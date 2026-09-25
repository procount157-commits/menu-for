-- Controls the operations officer can actually set, and the alerts it raises.
--
-- The ban-safety machinery already existed — delivery health, account health,
-- warm-up limits, adaptive pacing — but nothing owned it. Each piece reported
-- a number and the sending loop read some of them; no one was responsible for
-- the whole picture, and there was no way for a decision to persist. An officer
-- that can only report is a dashboard, not an employee.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/015_ops_controls.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS ops_controls (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Multiplies the gap between messages. 1 = as calculated, 3 = three times slower.
  throttle       NUMERIC(4,2) NOT NULL DEFAULT 1,
  -- Hard ceiling on today, below whatever the warm-up curve allows. NULL = none.
  daily_ceiling  INTEGER,
  -- All sending stops until this passes. The strongest action available.
  hold_until     TIMESTAMPTZ,
  reason         TEXT,
  -- 'agent' when the officer set it, 'owner' when a person did. An owner's
  -- decision is not overwritten by the next sweep.
  set_by         VARCHAR(20) NOT NULL DEFAULT 'agent',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ops_alerts (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level       VARCHAR(20) NOT NULL,              -- ok | warning | critical
  headline    VARCHAR(200) NOT NULL,
  body        TEXT,
  -- What it changed, so an action can be explained and undone.
  actions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Raw signals behind the decision, for auditing a call that looks wrong.
  signals     JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  -- Set once pushed to Telegram, so a restart does not resend.
  notified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ops_alerts ON ops_alerts (user_id, created_at DESC);
