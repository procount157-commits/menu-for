-- What the sales team knows about each lead, as fields rather than as prose.
--
-- The conversation map skill tells an employee to know which stage of the
-- sale it is in and what it has already learnt. Until now that was inferred
-- from the transcript on every reply — badly, because a ten-message history
-- rarely says "licence: free zone" in so many words, and the model asked
-- again. The card is written from the customer's own messages by rules, read
-- into every prompt, and shown to the owner.
--
-- It also records when a person has taken the thread over. A bot that keeps
-- answering after the owner has replied from their phone is the fastest way
-- to lose a customer who was about to sign.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/021_lead_cards.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS lead_cards (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone          VARCHAR(50) NOT NULL,
  -- 1 open · 2 discovery · 3 diagnosis · 4 value · 5 offer · 6 objection · 7 agreed
  stage          INTEGER NOT NULL DEFAULT 1,
  licence        VARCHAR(20),
  activity       VARCHAR(80),
  size           VARCHAR(80),
  staff          VARCHAR(40),
  tax_status     VARCHAR(40),
  accountant     VARCHAR(80),
  pain           VARCHAR(120),
  objection      VARCHAR(80),
  agreed_at      TIMESTAMPTZ,
  -- A person holds the thread until this passes; the bot and the follow-ups
  -- stay silent for it.
  human_until    TIMESTAMPTZ,
  human_by       VARCHAR(20),
  last_intent    VARCHAR(20),
  turns          INTEGER NOT NULL DEFAULT 0,
  -- The highest stage the owner has been told about, so "hot lead" and
  -- "agreed" each arrive once.
  notified_stage INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_lead_cards_stage ON lead_cards (user_id, stage, updated_at DESC);
