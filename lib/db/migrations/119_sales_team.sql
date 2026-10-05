-- The Menu For You sales employee: the restaurants it talks to, and every
-- message, reply, click and lesson on each one.
CREATE TABLE IF NOT EXISTS sales_prospects (
  id            serial PRIMARY KEY,
  wa_user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone         varchar(20) NOT NULL,
  name          varchar(120),
  business      varchar(160),
  vertical      varchar(20),
  city          varchar(80),
  source        varchar(40) NOT NULL DEFAULT 'manual',
  stage         varchar(16) NOT NULL DEFAULT 'new',
  step          integer NOT NULL DEFAULT 0,
  token         varchar(12) NOT NULL UNIQUE,
  priority      integer NOT NULL DEFAULT 0,
  next_at       timestamptz,
  first_sent_at timestamptz,
  last_sent_at  timestamptz,
  last_reply_at timestamptz,
  replies       integer NOT NULL DEFAULT 0,
  clicks        integer NOT NULL DEFAULT 0,
  last_click_at timestamptz,
  links_sent    jsonb NOT NULL DEFAULT '[]'::jsonb,
  facts         jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary       text,
  interest      smallint,
  org_id        integer REFERENCES orgs(id) ON DELETE SET NULL,
  stop_reason   varchar(80),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wa_user_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_sales_due ON sales_prospects (wa_user_id, stage, next_at);
CREATE INDEX IF NOT EXISTS idx_sales_new ON sales_prospects (wa_user_id, stage, priority DESC, id);

CREATE TABLE IF NOT EXISTS sales_touches (
  id          serial PRIMARY KEY,
  prospect_id integer NOT NULL REFERENCES sales_prospects(id) ON DELETE CASCADE,
  wa_user_id  integer NOT NULL,
  kind        varchar(16) NOT NULL,
  step        integer,
  text        text,
  links       jsonb NOT NULL DEFAULT '[]'::jsonb,
  by          varchar(12) NOT NULL DEFAULT 'ai',
  status      varchar(12) NOT NULL DEFAULT 'sent',
  meta        jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_touch_p   ON sales_touches (prospect_id, at);
CREATE INDEX IF NOT EXISTS idx_sales_touch_day ON sales_touches (wa_user_id, kind, at);
