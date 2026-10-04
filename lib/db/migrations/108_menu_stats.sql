-- What customers look at on the menu, per day: menu opens, item opens,
-- adds to cart, cart opens. Counters only — no person is tracked. Item 0 is
-- the menu itself.

CREATE TABLE IF NOT EXISTS menu_stats_daily (
  org_id    integer NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  branch_id integer NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  day       date NOT NULL,
  item_id   integer NOT NULL DEFAULT 0,
  views     integer NOT NULL DEFAULT 0,
  adds      integer NOT NULL DEFAULT 0,
  carts     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, branch_id, day, item_id)
);
CREATE INDEX IF NOT EXISTS idx_menu_stats_org_day ON menu_stats_daily (org_id, day);
