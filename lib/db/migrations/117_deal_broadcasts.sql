-- «أرسله لزبائني»: each time a deal is sent to customers, which campaign
-- carried it, when, and to how many.
ALTER TABLE shop_deals ADD COLUMN IF NOT EXISTS broadcasts jsonb NOT NULL DEFAULT '[]'::jsonb;
