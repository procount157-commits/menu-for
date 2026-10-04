-- A customer's birthday (day and month only, given by them), so the shop can
-- send a greeting with a one-time gift code; and the owner's settings for
-- that gift and for «ادعُ صديقاً».

ALTER TABLE customers ADD COLUMN IF NOT EXISTS birth_month smallint;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birth_day smallint;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday_sent_year integer;
CREATE INDEX IF NOT EXISTS idx_customers_birthday ON customers (org_id, birth_month, birth_day) WHERE birth_month IS NOT NULL;

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS growth_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
