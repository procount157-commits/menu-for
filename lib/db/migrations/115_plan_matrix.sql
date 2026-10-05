-- Plans become rows the platform owner edits in full: a switch per feature,
-- a number per limit, a monthly and a yearly price. A free plan and a trial
-- plan join the three paid ones; a shop's usage is counted per month; the
-- admin can give one shop more room or extra messages.

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS price_yearly numeric(10,2);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS extra_branch_price numeric(10,2);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS contact_sales boolean NOT NULL DEFAULT false;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS limits jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS toggles jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_plan_key ON subscription_plans (plan_key) WHERE plan_key IS NOT NULL;

-- The free and trial plans, if this install does not have them yet.
INSERT INTO subscription_plans (name, name_en, price, period, period_label, features, features_en, is_active, is_public, is_featured, sort_order, plan_key)
SELECT 'مجاني', 'Free', 0, 'monthly', 'درهم / شهر', '[]'::jsonb, '[]'::jsonb, true, true, false, -1, 'free'
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE plan_key = 'free');
INSERT INTO subscription_plans (name, name_en, price, period, period_label, features, features_en, is_active, is_public, is_featured, sort_order, plan_key)
SELECT 'تجريبي', 'Trial', 0, 'monthly', 'درهم / شهر', '[]'::jsonb, '[]'::jsonb, true, false, false, 99, 'trial'
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE plan_key = 'trial');
UPDATE subscription_plans SET name = 'الباقة الكاملة', name_en = 'Full package' WHERE plan_key = 'business' AND name = 'الأعمال';
-- The seeded bullets are replaced by ones written from the matrix (an owner's own text is kept).
UPDATE subscription_plans SET features = '[]'::jsonb, features_en = '[]'::jsonb
WHERE plan_key IN ('basic','pro','business')
  AND (features::text LIKE '%منيو رقمي بالصور والأقسام%' OR features::text LIKE '%كل مميزات الأساسية%' OR features::text LIKE '%كل مميزات الاحترافية%');

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS limit_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS message_credits integer NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS trial_extended_at timestamptz;

CREATE TABLE IF NOT EXISTS org_usage (
  org_id        integer NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  month         varchar(7) NOT NULL,
  messages      integer NOT NULL DEFAULT 0,
  marketing     integer NOT NULL DEFAULT 0,
  agent_replies integer NOT NULL DEFAULT 0,
  campaigns     integer NOT NULL DEFAULT 0,
  credits_used  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, month)
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key        varchar(40) PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings (key, value) VALUES ('trial', '{"days":30,"extensionDays":15,"extensionWithinDays":7,"extensionMinItems":10,"afterPlan":"free","graceShare":0.1}'::jsonb)
ON CONFLICT (key) DO NOTHING;
