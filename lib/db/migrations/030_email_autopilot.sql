-- The email team working on its own: what the owner set it to do, what each
-- agent did, and the lists it keeps by stage (opened, clicked, replied, not
-- opened) under each list it works.
CREATE TABLE IF NOT EXISTS email_autopilot (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  -- approve: every new campaign waits for the owner; auto: it goes out unless the guard stops it.
  mode               VARCHAR(10) NOT NULL DEFAULT 'approve',
  list_ids           JSONB NOT NULL DEFAULT '[]',
  folder_ids         JSONB NOT NULL DEFAULT '[]',
  wave_size          INTEGER NOT NULL DEFAULT 150,
  follow_after_hours INTEGER NOT NULL DEFAULT 48,
  max_touches        INTEGER NOT NULL DEFAULT 3,
  quiet_days         INTEGER NOT NULL DEFAULT 4,
  language           VARCHAR(5) NOT NULL DEFAULT 'ar',
  last_run_at        TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_agent_activity (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       VARCHAR(30) NOT NULL,
  action     VARCHAR(30) NOT NULL,
  text       TEXT NOT NULL,
  ref        JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_agent_activity ON email_agent_activity (user_id, created_at DESC);

ALTER TABLE email_lists ADD COLUMN IF NOT EXISTS parent_list_id INTEGER REFERENCES email_lists(id) ON DELETE CASCADE;
ALTER TABLE email_lists ADD COLUMN IF NOT EXISTS stage VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_lists_stage ON email_lists (parent_list_id, stage) WHERE parent_list_id IS NOT NULL;

ALTER TABLE email_missions ADD COLUMN IF NOT EXISTS agent_role VARCHAR(30);
ALTER TABLE email_missions ADD COLUMN IF NOT EXISTS source_list_id INTEGER REFERENCES email_lists(id) ON DELETE SET NULL;
