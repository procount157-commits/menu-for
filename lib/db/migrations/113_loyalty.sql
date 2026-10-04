-- The stamp card: a stamp per visit or order (one a day), and a gift code
-- when the card is full.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS stamps integer NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS stamps_total integer NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_stamp_day date;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_rewards integer NOT NULL DEFAULT 0;
