-- Adaptive pacing: campaigns derive their own gap instead of using a fixed
-- delayMin/delayMax pair. Existing campaigns move to "auto" because a hand-set
-- pace cannot hit a daily target; delay_min/delay_max are left in place so a
-- campaign can still be pinned by switching pacing_mode back to 'manual'.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/001_pacing_mode.sql
-- Safe to re-run.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS pacing_mode VARCHAR(10) NOT NULL DEFAULT 'auto';
