-- ── 127 · الحاجز التلقائي من الحظر، بسلّمٍ إلى ١٥٠٠ ───────────────
-- منقولٌ من Flow Hub (064). صاحب العمل (٢٠ أكتوبر): «أبني جدار لكل حد… هم
-- عملاء سابقين، ومن اختار "لا" خلاص ما هرسل له تاني. بس أبنيها عشان يوصل
-- ١٥٠٠ في اليوم بالتدريج». حالة الحاجز لكل رقم، ودفتر كل رسالة أذن بها،
-- وسجلّه. يُعاد تشغيله بأمان.
CREATE TABLE IF NOT EXISTS wa_firewall (
  user_id             integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode                varchar(14) NOT NULL DEFAULT 'normal',
  frozen_until        timestamptz,
  reason              text,
  convalescent_until  timestamptz,
  manual_freeze       boolean NOT NULL DEFAULT false,
  cold_daily_cap      integer,
  interactive_allowed boolean NOT NULL DEFAULT false,
  paused_campaigns    jsonb NOT NULL DEFAULT '[]',
  freezes             integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- السلّم: الدرجة، منذ متى، ومتى حُكم عليها آخر مرة؛ وكلمة واتساب نفسه عن الحساب.
ALTER TABLE wa_firewall ADD COLUMN IF NOT EXISTS rung integer NOT NULL DEFAULT -1;
ALTER TABLE wa_firewall ADD COLUMN IF NOT EXISTS rung_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE wa_firewall ADD COLUMN IF NOT EXISTS rung_checked_on varchar(10);
ALTER TABLE wa_firewall ADD COLUMN IF NOT EXISTS wa_lock jsonb;
ALTER TABLE wa_firewall ADD COLUMN IF NOT EXISTS wa_cap jsonb;
ALTER TABLE wa_firewall ADD COLUMN IF NOT EXISTS wa_checked_at timestamptz;
ALTER TABLE wa_firewall ADD COLUMN IF NOT EXISTS wa_warned_status varchar(16);

CREATE TABLE IF NOT EXISTS wa_firewall_sends (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone       varchar(50) NOT NULL,
  kind        varchar(14) NOT NULL,
  cold        boolean NOT NULL,
  message_id  varchar(120),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_firewall_sends_user ON wa_firewall_sends (user_id, at);
CREATE TABLE IF NOT EXISTS wa_firewall_events (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        varchar(16) NOT NULL,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_firewall_events_user ON wa_firewall_events (user_id, created_at);

-- ── «من اختار لا، خلاص» ───────────────────────────────────────────
-- 120_stop_period جعل الإيقاف مؤقتاً (platform_settings.messaging.stopDays،
-- ١٥٠ يوماً). الآن: من طلب الإيقاف لا يُراسَل بعدها أبداً.
-- ١) مدة الإيقاف صفر = للأبد، فلا يضع المُشغِّل تاريخاً على الصفوف الجديدة.
INSERT INTO platform_settings (key, value) VALUES ('messaging', '{"stopDays":0}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = platform_settings.value || '{"stopDays":0}'::jsonb, updated_at = now();
-- ٢) المُشغِّل نفسه: بلا إعداد = للأبد (كان ١٥٠).
CREATE OR REPLACE FUNCTION unsub_set_until() RETURNS trigger AS $$
DECLARE days integer;
BEGIN
  IF NEW.until IS NULL THEN
    SELECT coalesce((value->>'stopDays')::int, 0) INTO days FROM platform_settings WHERE key = 'messaging';
    IF days IS NULL THEN days := 0; END IF;
    IF days > 0 THEN NEW.until := now() + make_interval(days => days); END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
-- ٣) ما كان مؤقتاً صار دائماً (ومنه ما انتهى ولم يُكنس بعد).
UPDATE unsubscribed_phones SET until = NULL WHERE until IS NOT NULL;
