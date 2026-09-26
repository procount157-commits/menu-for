-- Meetings, because the message bus was not a conversation.
--
-- Sixteen messages had passed between the employees and not one was a question
-- or an answer; one had ever been read. Everything went one way to the manager
-- and nothing came back. That is a notification log, and a team that only
-- files reports at each other is not discussing anything.
--
-- A meeting is a transcript with an order: the chair opens on an agenda built
-- from real numbers, each employee speaks having read what was said before
-- them, the chair puts a pointed question to whoever needs it, and closes with
-- decisions that become standing instructions in the memory of whoever they
-- apply to.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/019_meetings.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS meetings (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- daily | pipeline | postmortem
  kind        VARCHAR(20) NOT NULL DEFAULT 'daily',
  title       VARCHAR(160) NOT NULL,
  -- The numbers the meeting was called on, so a decision can be read against
  -- what was actually known at the time.
  agenda      JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary     TEXT,
  -- [{ role, rule }] — what the chair decided, and for whom.
  decisions   JSONB NOT NULL DEFAULT '[]'::jsonb,
  status      VARCHAR(20) NOT NULL DEFAULT 'running',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_meetings ON meetings (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS meeting_turns (
  id         SERIAL PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  role       VARCHAR(30) NOT NULL,
  -- open | report | reply | question | answer | decide
  kind       VARCHAR(20) NOT NULL DEFAULT 'report',
  -- Set when this turn answers an earlier one, so the thread is readable.
  in_reply_to INTEGER,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meeting_turns ON meeting_turns (meeting_id, seq);
