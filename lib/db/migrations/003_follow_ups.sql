-- Automatic follow-up for leads, with the source they arrived from.
--
-- A click-to-WhatsApp ad stamps the first incoming message with referral data,
-- so ad leads identify themselves; lead_sources records that once per contact.
-- follow_up_sequences holds the plan, follow_up_jobs one row per scheduled
-- message so a restart cannot lose or duplicate a send.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/003_follow_ups.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS lead_sources (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone         VARCHAR(50) NOT NULL,
  source        VARCHAR(20) NOT NULL DEFAULT 'organic',
  ad_source_id  TEXT,
  ad_source_url TEXT,
  ad_title      TEXT,
  ctwa_clid     TEXT,
  entry_point   TEXT,
  raw_referral  JSONB,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_lead_sources_source ON lead_sources (user_id, source);

CREATE TABLE IF NOT EXISTS follow_up_sequences (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT false,
  source_filter VARCHAR(20) NOT NULL DEFAULT 'ad',
  steps         JSONB NOT NULL,
  stop_on_reply BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS follow_up_jobs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sequence_id INTEGER NOT NULL REFERENCES follow_up_sequences(id) ON DELETE CASCADE,
  phone       VARCHAR(50) NOT NULL,
  step_index  INTEGER NOT NULL,
  due_at      TIMESTAMPTZ NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending',
  sent_at     TIMESTAMPTZ,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enrolment runs on every inbound message, so it has to be idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_follow_up_jobs_unique
  ON follow_up_jobs (sequence_id, phone, step_index);
CREATE INDEX IF NOT EXISTS idx_follow_up_jobs_due
  ON follow_up_jobs (status, due_at);
