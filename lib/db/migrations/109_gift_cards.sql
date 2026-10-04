-- Gift cards: sold at the counter (or asked for on WhatsApp), sent to the
-- recipient's WhatsApp, spent at the counter or with their code in the cart,
-- in one go or bit by bit.

CREATE TABLE IF NOT EXISTS gift_cards (
  id              serial PRIMARY KEY,
  org_id          integer NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  code            varchar(24) NOT NULL,
  token           varchar(32) NOT NULL UNIQUE,
  amount          numeric(10,2) NOT NULL,
  balance         numeric(10,2) NOT NULL,
  buyer_name      varchar(80),
  buyer_phone     varchar(40),
  recipient_name  varchar(80),
  recipient_phone varchar(40),
  message         text,
  status          varchar(10) NOT NULL DEFAULT 'active',
  expires_at      timestamptz,
  created_by      varchar(80),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_card_code ON gift_cards (org_id, code);

CREATE TABLE IF NOT EXISTS gift_card_uses (
  id           serial PRIMARY KEY,
  gift_card_id integer NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  amount       numeric(10,2) NOT NULL,
  order_id     integer,
  note         varchar(200),
  by_who       varchar(80),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gift_card_uses ON gift_card_uses (gift_card_id, created_at);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_card_id integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_amount numeric(10,2) NOT NULL DEFAULT 0;
