-- A follow-up that is argued over before it is sent.
--
-- The ladder already existed — 1h, 6h, 12h, 1d, 3d, 1w, 30d — and it fired on
-- a timer. A timer knows the hour and nothing else: not whether this person
-- ever opened a message, not whether the number is currently at risk, not
-- whether a seventh nudge to someone who has ignored six is worth the
-- complaint it invites. Each step now has to be argued for, and the argument
-- is kept.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/018_followup_deliberation.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS followup_deliberations (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id       INTEGER REFERENCES follow_up_jobs(id) ON DELETE SET NULL,
  phone        VARCHAR(50) NOT NULL,
  step         INTEGER NOT NULL,
  -- What the evidence said, so a verdict can be audited later.
  segment      VARCHAR(30),
  opens        INTEGER NOT NULL DEFAULT 0,
  -- send | hold | drop
  verdict      VARCHAR(20) NOT NULL,
  reason       TEXT,
  -- Each voice kept separately: the manager judges worth, operations judges risk.
  manager_view TEXT,
  ops_view     TEXT,
  -- What would have gone out. Kept even when nothing is sent, which is the
  -- whole point of the rehearsal.
  draft        TEXT,
  -- FALSE while the owner is still watching it rehearse.
  executed     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_delib ON followup_deliberations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delib_phone ON followup_deliberations (user_id, phone, step);

-- Live until the owner says otherwise. The ladder runs, the team argues, the
-- drafts are written and nothing reaches a customer — so the judgement can be
-- read before it is trusted.
ALTER TABLE follow_up_sequences
  ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT TRUE;

-- Where a queued contact came from, so the intake coordinator's work is
-- visible rather than implied.
ALTER TABLE lead_sources
  ADD COLUMN IF NOT EXISTS queued_by   VARCHAR(30),
  ADD COLUMN IF NOT EXISTS queue_note  TEXT;
