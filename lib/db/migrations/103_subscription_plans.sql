-- The plans shown on the home page and the sign-up requests it collects.
-- routes/plans.ts and routes/leads.ts have always read and written these two
-- tables, but no migration ever created them (they lived only in the old
-- hosted database), so the admin's plans and requests tabs failed and the
-- home page fell back to its built-in prices.

CREATE TABLE IF NOT EXISTS subscription_plans (
  id             serial PRIMARY KEY,
  name           varchar(120) NOT NULL,
  name_en        varchar(120),
  price          numeric(10,2) NOT NULL,
  period         varchar(20) NOT NULL DEFAULT 'monthly',
  period_label   varchar(60),
  description    text,
  description_en text,
  features       jsonb NOT NULL DEFAULT '[]'::jsonb,
  features_en    jsonb NOT NULL DEFAULT '[]'::jsonb,
  badge          varchar(60),
  badge_en       varchar(60),
  is_active      boolean NOT NULL DEFAULT true,
  is_featured    boolean NOT NULL DEFAULT false,
  sort_order     integer NOT NULL DEFAULT 0,
  -- which PLAN_LIMITS tier a subscriber of this plan is put on
  plan_key       varchar(20),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_leads (
  id                  serial PRIMARY KEY,
  name                varchar(160),
  phone               varchar(40) NOT NULL,
  plan_name           varchar(120),
  business_type       varchar(80),
  estimated_customers varchar(60),
  notes               text,
  source              varchar(40) NOT NULL DEFAULT 'landing',
  status              varchar(20) NOT NULL DEFAULT 'new',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscription_leads_status ON subscription_leads (status, created_at DESC);

-- Starting plans, only when there are none. The prices are placeholders for
-- the owner to change under الإدارة ← الخطط.
INSERT INTO subscription_plans (name, name_en, price, period, period_label, features, features_en, badge, badge_en, is_featured, sort_order, plan_key)
SELECT * FROM (VALUES
  ('الأساسية', 'Basic', 99::numeric, 'monthly', 'درهم / شهر',
   '["منيو رقمي بالصور والأقسام","الطلب على واتساب","QR جاهز للطباعة","عربي وإنجليزي","فرع واحد","3 موظفين"]'::jsonb,
   '["Photo menu with sections","WhatsApp ordering","Print-ready QR","Arabic & English","One branch","3 staff"]'::jsonb,
   NULL, NULL, false, 0, 'basic'),
  ('الاحترافية', 'Pro', 199::numeric, 'monthly', 'درهم / شهر',
   '["كل مميزات الأساسية","صف الانتظار الرقمي","الحجوزات والطلبات المسبقة","إشعارات واتساب «جاء دورك»","المضيف الذكي على واتساب","حتى 3 فروع و10 موظفين"]'::jsonb,
   '["Everything in Basic","Digital queue","Bookings & pre-orders","WhatsApp \"your turn\" alerts","Smart WhatsApp host","Up to 3 branches, 10 staff"]'::jsonb,
   'الأكثر طلباً', 'Most popular', true, 1, 'pro'),
  ('الأعمال', 'Business', 399::numeric, 'monthly', 'درهم / شهر',
   '["كل مميزات الاحترافية","فروع وموظفون بلا حد","رقم واتساب لكل فرع","الحملات والمتابعات","شاشة «الآن يُخدم»","أولوية في الدعم"]'::jsonb,
   '["Everything in Pro","Unlimited branches & staff","A WhatsApp number per branch","Campaigns & follow-ups","\"Now serving\" screen","Priority support"]'::jsonb,
   NULL, NULL, false, 2, 'business')
) AS v
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans);
