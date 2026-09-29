-- Every reply is checked before it is sent, and the owner can grade it.
--
-- quality_score / quality_notes: what the checker found (100 = clean).
-- rewritten: the first draft failed the check and was rewritten once.
-- owner_rating / owner_note: the owner's own verdict from the review page —
-- the strongest signal there is, and it goes into the employee's memory.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/026_reply_quality.sql
-- Safe to re-run.

ALTER TABLE auto_reply_log ADD COLUMN IF NOT EXISTS quality_score INTEGER;
ALTER TABLE auto_reply_log ADD COLUMN IF NOT EXISTS quality_notes TEXT;
ALTER TABLE auto_reply_log ADD COLUMN IF NOT EXISTS rewritten     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE auto_reply_log ADD COLUMN IF NOT EXISTS owner_rating  INTEGER;
ALTER TABLE auto_reply_log ADD COLUMN IF NOT EXISTS owner_note    TEXT;
