-- «يُطلب معه»: how many items were added to carts from the suggestion.
ALTER TABLE menu_stats_daily ADD COLUMN IF NOT EXISTS upsells integer NOT NULL DEFAULT 0;
