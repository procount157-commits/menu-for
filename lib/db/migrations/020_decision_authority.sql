-- What a meeting may decide on its own, and what it may only propose.
--
-- The first real meeting ran on 42 replies of which zero had a recorded
-- outcome — no wins, no losses, no evidence of any kind — and produced four
-- standing rules. One of them froze follow-ups indefinitely by making خالد
-- wait for a report فهد does not produce. Another told the salesman to stop
-- asking about the licence type first, overriding a skill that names it the
-- single most important question, on the strength of a conversation between
-- language models about numbers that said nothing.
--
-- Two limits follow. A meeting with no outcome evidence may discuss and report
-- but not legislate. And a decision that changes how the business operates —
-- stopping sending, freezing follow-ups, changing limits — is a proposal the
-- owner approves, never a rule that applies itself.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/020_decision_authority.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS meeting_proposals (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id  INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
  -- Whose behaviour it would change.
  role        VARCHAR(30) NOT NULL,
  role_name   VARCHAR(80),
  rule        TEXT NOT NULL,
  -- Why it needs the owner: 'operational' stops or limits the business.
  reason      TEXT,
  -- pending | approved | rejected
  status      VARCHAR(20) NOT NULL DEFAULT 'pending',
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proposals ON meeting_proposals (user_id, status, created_at DESC);

-- Whether the meeting had enough evidence to decide anything at all.
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS evidence_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS could_decide   BOOLEAN NOT NULL DEFAULT TRUE;
