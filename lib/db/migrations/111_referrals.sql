-- «ادعُ صديقاً»: a customer shares their link; a friend new to the shop gets
-- a discount on their first order, and the customer gets a code once that
-- order is completed. A phone can be someone's friend only once.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS referral_code varchar(12);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_referral_code ON customers (org_id, referral_code) WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_referrals (
  id             serial PRIMARY KEY,
  org_id         integer NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  referrer_phone varchar(40) NOT NULL,
  friend_phone   varchar(40) NOT NULL,
  order_id       integer,
  status         varchar(10) NOT NULL DEFAULT 'pending',
  reward_deal_id integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  rewarded_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_friend ON customer_referrals (org_id, friend_phone);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON customer_referrals (org_id, referrer_phone);
