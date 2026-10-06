-- A «إيقاف الرسائل» keeps our messages away for the platform's stop period
-- (platform_settings.messaging.stopDays, 150 by default; 0 = for good).
-- Set here, by trigger, so every place that records a stop gets it — the
-- campaign opt-out, the intent classifier, the sales employee. Rows from before
-- this migration stay permanent (until is NULL). Expired rows are swept hourly.
ALTER TABLE unsubscribed_phones ADD COLUMN IF NOT EXISTS until timestamptz;
CREATE INDEX IF NOT EXISTS idx_unsub_until ON unsubscribed_phones (until) WHERE until IS NOT NULL;

CREATE OR REPLACE FUNCTION unsub_set_until() RETURNS trigger AS $$
DECLARE days integer;
BEGIN
  IF NEW.until IS NULL THEN
    SELECT coalesce((value->>'stopDays')::int, 150) INTO days FROM platform_settings WHERE key = 'messaging';
    IF days IS NULL THEN days := 150; END IF;
    IF days > 0 THEN NEW.until := now() + make_interval(days => days); END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_unsub_until ON unsubscribed_phones;
CREATE TRIGGER trg_unsub_until BEFORE INSERT ON unsubscribed_phones FOR EACH ROW EXECUTE FUNCTION unsub_set_until();
