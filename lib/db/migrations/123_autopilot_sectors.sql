-- The sectors the email team works — empty for every sector Menu For You
-- fits. Pick «حلويات» and only sweets shops are written to, each sector with
-- its own campaign.
ALTER TABLE email_autopilot ADD COLUMN IF NOT EXISTS sectors JSONB NOT NULL DEFAULT '[]'::jsonb;
