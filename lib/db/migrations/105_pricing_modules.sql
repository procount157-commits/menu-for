-- Pricing as sold from October 2026, and the queue and bookings as switches.
--
-- Two offers: «الأساسية» at 99 a month (the menu and ordering), and
-- «الشاملة» — everything, WhatsApp and email marketing included — at 199 a
-- month or 800 a year. «الاحترافية» cost the same as the full package would,
-- so it is no longer offered; anyone already on it keeps it.
--
-- The queue and bookings stop being on for every shop: many restaurants want
-- neither. Which kinds of shop start with them is the super admin's call
-- (platform_settings.module_defaults); each shop then turns them on or off.

CREATE TABLE IF NOT EXISTS platform_settings (
  key        varchar(60) PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (key, value) VALUES ('module_defaults', '{
  "restaurant": {"queue": false, "booking": false},
  "cafe":       {"queue": false, "booking": false},
  "sweets":     {"queue": false, "booking": false},
  "beauty":     {"queue": true,  "booking": true}
}'::jsonb) ON CONFLICT (key) DO NOTHING;

UPDATE subscription_plans SET is_active = false, is_featured = false WHERE plan_key = 'pro';

UPDATE subscription_plans SET
  name = 'الشاملة', name_en = 'Full',
  price = 199, period = 'monthly', period_label = 'درهم / شهر',
  features = '["كل مميزات الأساسية","صف الانتظار الرقمي والحجوزات","إشعارات واتساب «جاء دورك» و«طلبك جاهز»","المضيف الذكي على واتساب","حملات واتساب بلا حد وإعادة الاستهداف","حملة أسبوعية آلية لزبائنك","التسويق بالبريد الإلكتروني","فروع وموظفون بلا حد","رقم واتساب لكل فرع","شاشة «الآن يُخدم»"]'::jsonb,
  features_en = '["Everything in Basic","Digital queue & bookings","WhatsApp \"your turn\" and \"order ready\" alerts","Smart WhatsApp host","Unlimited WhatsApp campaigns & retargeting","Automatic weekly campaign","Email marketing","Unlimited branches & staff","A WhatsApp number per branch","\"Now serving\" screen"]'::jsonb,
  badge = 'الأكثر طلباً', badge_en = 'Most popular', is_featured = true, is_active = true, sort_order = 1
WHERE plan_key = 'business' AND period = 'monthly';

INSERT INTO subscription_plans (name, name_en, price, period, period_label, features, features_en, badge, badge_en, is_featured, sort_order, plan_key)
SELECT 'الشاملة — سنوي', 'Full — yearly', 800, 'yearly', 'درهم / سنة',
  '["كل مميزات الشاملة","سنة كاملة بسعر 4 أشهر","وفّر 1,588 درهم"]'::jsonb,
  '["Everything in Full","A full year for the price of four months","Save AED 1,588"]'::jsonb,
  'وفّر 66%', 'Save 66%', false, 2, 'business'
WHERE EXISTS (SELECT 1 FROM subscription_plans)
  AND NOT EXISTS (SELECT 1 FROM subscription_plans WHERE plan_key = 'business' AND period = 'yearly');
