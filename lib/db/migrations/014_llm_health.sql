-- How each model has actually behaved, so the next call picks by evidence.
--
-- The fallback chain was ordered by hand: the account's provider, then whoever
-- had a key, then a keyless last resort. That order says nothing about which
-- one answers. Measured over one afternoon: Gemini returned 503 on every
-- attempt, four of OpenRouter's popular free models were permanently
-- rate-limited, and Groq answered in under a second and a half every time.
-- A hand-written order cannot know that; a table of outcomes can.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/014_llm_health.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS llm_health (
  provider      VARCHAR(30) NOT NULL,
  model         VARCHAR(120) NOT NULL DEFAULT '',
  ok            INTEGER NOT NULL DEFAULT 0,
  fail          INTEGER NOT NULL DEFAULT 0,
  -- Drives the cooldown. Reset by any success.
  streak_fails  INTEGER NOT NULL DEFAULT 0,
  -- Rolling mean, not a total: a model that got slower should look slower.
  avg_ms        INTEGER NOT NULL DEFAULT 0,
  last_ok_at    TIMESTAMPTZ,
  last_fail_at  TIMESTAMPTZ,
  last_error    TEXT,
  -- Skipped entirely until this passes. A model that is rate-limited upstream
  -- costs a round trip and a timeout every call otherwise.
  cooldown_until TIMESTAMPTZ,
  PRIMARY KEY (provider, model)
);
