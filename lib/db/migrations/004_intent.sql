-- Reply intent, so a follow-up sequence can react to what a customer said
-- rather than continuing regardless.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/004_intent.sql
-- Safe to re-run.

ALTER TABLE lead_sources
  ADD COLUMN IF NOT EXISTS last_intent       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS last_intent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS last_message      TEXT;

-- Which intents let the sequence keep running. Default: a greeting or an
-- unreadable message is not real engagement, so those continue; anything else
-- stops it.
ALTER TABLE follow_up_sequences
  ADD COLUMN IF NOT EXISTS continue_on_intents JSONB NOT NULL DEFAULT '["greeting","unclear"]'::jsonb,
  ADD COLUMN IF NOT EXISTS use_ai BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_lead_sources_intent ON lead_sources (user_id, last_intent);
