-- Telegram, and what the data collector works out about each contact.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/017_telegram_segments.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS telegram_settings (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bot_token   VARCHAR(200) NOT NULL,
  -- Only known once the owner has messaged the bot: Telegram will not let a
  -- bot open a conversation, so there is no way to derive this.
  chat_id     VARCHAR(50),
  chat_title  VARCHAR(120),
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  linked_at   TIMESTAMPTZ,
  last_error  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per contact per assessment. Kept rather than computed on demand so
-- a segment can be compared with yesterday's — "moved from read to replied"
-- is the interesting fact, and a live query cannot see it.
CREATE TABLE IF NOT EXISTS contact_segments (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone       VARCHAR(50) NOT NULL,
  segment     VARCHAR(30) NOT NULL,
  -- Why it landed there, in the collector's own words.
  reason      TEXT,
  -- 0..100. Ordering for "who should we chase first".
  score       INTEGER NOT NULL DEFAULT 0,
  sent        INTEGER NOT NULL DEFAULT 0,
  delivered   INTEGER NOT NULL DEFAULT 0,
  read        INTEGER NOT NULL DEFAULT 0,
  replied     INTEGER NOT NULL DEFAULT 0,
  last_read_at  TIMESTAMPTZ,
  last_reply_at TIMESTAMPTZ,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_segment_current ON contact_segments (user_id, phone);
CREATE INDEX IF NOT EXISTS idx_segment_score ON contact_segments (user_id, segment, score DESC);
