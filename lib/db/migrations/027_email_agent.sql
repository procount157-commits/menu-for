-- Sectors, segments, and an email agent that is trained and runs missions.
--
-- The owner's complaint was that everything lands in one pile: 3,852
-- companies in one list with no way to say "the contractors" or "the
-- brokers in Dubai who opened but did not reply". A sector is now worked out
-- for every contact from its name and activity, and a segment is a saved
-- filter over sector, city, list, status and what the contact has done.
--
-- The email agent (نورة) is a new employee with a memory of its own,
-- including knowledge the owner teaches it, each item optionally tied to a
-- sector (agent_memory.topic). A mission is the agent working a segment
-- towards a goal: it writes, tests two subjects, sends, follows up openers
-- and non-openers differently, and writes down what it learned.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/027_email_agent.sql
-- Safe to re-run.

ALTER TABLE email_contacts ADD COLUMN IF NOT EXISTS sector VARCHAR(60);
CREATE INDEX IF NOT EXISTS idx_email_contacts_sector ON email_contacts (user_id, sector);

ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS topic VARCHAR(80);

CREATE TABLE IF NOT EXISTS email_segments (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(160) NOT NULL,
  -- { sectors?, cities?, listIds?, statuses?, engagement?, q? }
  filter      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS segment_id INTEGER REFERENCES email_segments(id) ON DELETE SET NULL;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS mission_id INTEGER;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS created_by VARCHAR(20) NOT NULL DEFAULT 'owner';

CREATE TABLE IF NOT EXISTS email_missions (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(160) NOT NULL,
  goal            TEXT NOT NULL,
  -- The audience, as a filter, so the mission follows the data rather than a snapshot.
  filter          JSONB NOT NULL DEFAULT '{}',
  language        VARCHAR(10) NOT NULL DEFAULT 'ar',
  tone            VARCHAR(40),
  -- draft → awaiting_approval → sending → following_up → done ; paused
  stage           VARCHAR(30) NOT NULL DEFAULT 'draft',
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  require_approval BOOLEAN NOT NULL DEFAULT TRUE,
  -- What the agent proposed and is waiting on: { kind, subjects[], html, followups[] … }
  pending         JSONB,
  campaign_id     INTEGER,
  warm_sequence_id INTEGER,
  cold_sequence_id INTEGER,
  follow_after_hours INTEGER NOT NULL DEFAULT 48,
  report          JSONB,
  last_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_missions_user ON email_missions (user_id, status);

CREATE TABLE IF NOT EXISTS email_mission_log (
  id          SERIAL PRIMARY KEY,
  mission_id  INTEGER NOT NULL REFERENCES email_missions(id) ON DELETE CASCADE,
  kind        VARCHAR(20) NOT NULL DEFAULT 'note',
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_mission_log ON email_mission_log (mission_id, created_at);
