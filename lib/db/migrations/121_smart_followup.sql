-- The follow-up خالد writes for each customer who spoke to the shop and went
-- quiet: off | dry (drafts recorded, nothing sent) | live. Starts in dry so
-- the owner reads a few days of drafts before any goes out.
ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS smart_followup VARCHAR(8) NOT NULL DEFAULT 'dry';
