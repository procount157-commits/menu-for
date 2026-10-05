-- More on an item (how many it serves, how long it takes, pinned to the top
-- of its section) and hours for a section (breakfast 7–11, Fridays only…).
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS serves integer;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS prep_min integer;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS hours jsonb;
