-- Shop brings shop: each shop has a code; a shop that subscribes through it
-- is remembered, and when it first pays, both get a month free.

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS referral_code varchar(12);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_referral_code ON orgs (referral_code) WHERE referral_code IS NOT NULL;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS referred_by_org_id integer REFERENCES orgs(id) ON DELETE SET NULL;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS referral_rewarded_at timestamptz;
ALTER TABLE subscription_leads ADD COLUMN IF NOT EXISTS referral_code varchar(12);
