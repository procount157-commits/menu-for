-- The onboarding interview: a kind of assistant thread.
--
-- A new account gets a bot with an empty knowledge base, and nobody fills a
-- knowledge base by hand. So the manager interviews the owner instead — ten
-- questions, one at a time — and writes the profile and the entries herself.
-- The thread is marked so the assistant knows which conversation it is in.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/022_interview.sql
-- Safe to re-run.

ALTER TABLE assistant_threads ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'chat';
