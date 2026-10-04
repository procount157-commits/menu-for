-- Happy customers are pointed to the shop's Google review page; unhappy ones
-- stay a private note to the owner. When each rating came, and who was
-- invited to Google, so the owner can see it working.

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS google_review_url text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS rated_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS google_invited_at timestamptz;
