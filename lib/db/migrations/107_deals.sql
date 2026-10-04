-- Coupons and timed deals: a code typed at checkout, or a deal that applies
-- by itself during its hours («ساعة سعيدة»). Personal codes (a birthday, a
-- referral reward) carry the one phone they are for.

CREATE TABLE IF NOT EXISTS shop_deals (
  id             serial PRIMARY KEY,
  org_id         integer NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  branch_id      integer REFERENCES branches(id) ON DELETE CASCADE,
  code           varchar(24),
  title          varchar(80) NOT NULL,
  kind           varchar(8) NOT NULL DEFAULT 'pct',
  value          numeric(10,2) NOT NULL,
  min_subtotal   numeric(10,2) NOT NULL DEFAULT 0,
  max_discount   numeric(10,2),
  days           integer[] NOT NULL DEFAULT '{}',
  from_time      varchar(5),
  to_time        varchar(5),
  starts_at      timestamptz,
  ends_at        timestamptz,
  max_uses       integer,
  uses           integer NOT NULL DEFAULT 0,
  once_per_phone boolean NOT NULL DEFAULT false,
  phone          varchar(40),
  source         varchar(12) NOT NULL DEFAULT 'owner',
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_deal_code ON shop_deals (org_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shop_deals_org ON shop_deals (org_id, is_active);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deal_id integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deal_title varchar(80);
