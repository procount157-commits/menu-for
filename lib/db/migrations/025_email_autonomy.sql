-- Email that runs itself, within limits.
--
-- The owner's instruction was that the section does the work: a file goes
-- in, and the sending, the follow-up and the answering happen. Three things
-- make that safe rather than reckless:
--
--   auto_reply     the salesman's draft is sent on its own, after a delay a
--                  person would take, and only for intents where a wrong
--                  answer costs little (a question, interest, a greeting) —
--                  never a complaint or a refusal.
--   warmup         a new sending address ramps from 50 a day, whatever
--                  daily cap the owner typed, because mailbox providers
--                  judge a new sender by its first weeks.
--   A/B subjects   a campaign can test two subjects on a slice of the list
--                  and send the rest with whichever was opened more.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/025_email_autonomy.sql
-- Safe to re-run.

ALTER TABLE email_settings  ADD COLUMN IF NOT EXISTS auto_reply           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE email_settings  ADD COLUMN IF NOT EXISTS auto_reply_delay_min INTEGER NOT NULL DEFAULT 12;
ALTER TABLE email_settings  ADD COLUMN IF NOT EXISTS warmup               BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS subject_b     VARCHAR(300);
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS ab_pct        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS ab_wait_hours INTEGER NOT NULL DEFAULT 4;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS ab_winner     VARCHAR(1);
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS ab_decided_at TIMESTAMPTZ;

-- 'A' or 'B' for a test message, the winner's letter once the rest is released.
ALTER TABLE email_messages  ADD COLUMN IF NOT EXISTS variant       VARCHAR(1);

-- When the drafted reply goes out on its own; NULL means it waits for a person.
ALTER TABLE email_inbound   ADD COLUMN IF NOT EXISTS auto_send_at  TIMESTAMPTZ;
