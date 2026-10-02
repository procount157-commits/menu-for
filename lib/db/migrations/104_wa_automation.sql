-- WhatsApp, finished for shops: receipts on notifications (who received it,
-- who opened it), alerts to the shop's own phones, the weekly autopilot and
-- its runs, and model keys per channel.

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_notifications_wa_msg ON notifications (wa_message_id) WHERE wa_message_id IS NOT NULL;

ALTER TABLE branches ADD COLUMN IF NOT EXISTS alert_phones jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS wa_autopilot (
  wa_user_id     integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id         integer NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  enabled        boolean NOT NULL DEFAULT false,
  weekday        integer NOT NULL DEFAULT 4,
  hour           integer NOT NULL DEFAULT 17,
  audience       varchar(20) NOT NULL DEFAULT 'opted_in',
  mode           varchar(10) NOT NULL DEFAULT 'approval',
  source         varchar(10) NOT NULL DEFAULT 'agent',
  fixed_message  text,
  instructions   text,
  max_recipients integer NOT NULL DEFAULT 300,
  rest_days      integer NOT NULL DEFAULT 6,
  last_run_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wa_autopilot_runs (
  id          serial PRIMARY KEY,
  wa_user_id  integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id      integer NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  kind        varchar(20) NOT NULL DEFAULT 'weekly',
  status      varchar(20) NOT NULL,
  campaign_id integer,
  group_id    integer,
  audience    varchar(20),
  recipients  integer NOT NULL DEFAULT 0,
  message     text,
  written_by  varchar(30),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_wa_autopilot_runs ON wa_autopilot_runs (wa_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS llm_keys (
  id         serial PRIMARY KEY,
  channel    varchar(12) NOT NULL,
  provider   varchar(30) NOT NULL,
  api_key    varchar(400) NOT NULL,
  model      varchar(120),
  label      varchar(80),
  is_active  boolean NOT NULL DEFAULT true,
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_llm_keys_channel ON llm_keys (channel, is_active, sort);

-- The Pro plan now carries the weekly campaign; say so where the seeded text
-- is still the original (an owner's own wording is left alone).
UPDATE subscription_plans SET
  features = '["كل مميزات الأساسية","صف الانتظار الرقمي","الحجوزات والطلبات المسبقة","إشعارات واتساب «جاء دورك»","المضيف الذكي على واتساب","حملة أسبوعية آلية لزبائنك","حتى 3 فروع و10 موظفين"]'::jsonb,
  features_en = '["Everything in Basic","Digital queue","Bookings & pre-orders","WhatsApp \"your turn\" alerts","Smart WhatsApp host","Automatic weekly campaign","Up to 3 branches, 10 staff"]'::jsonb
WHERE plan_key = 'pro'
  AND features = '["كل مميزات الأساسية","صف الانتظار الرقمي","الحجوزات والطلبات المسبقة","إشعارات واتساب «جاء دورك»","المضيف الذكي على واتساب","حتى 3 فروع و10 موظفين"]'::jsonb;
UPDATE subscription_plans SET
  features = '["كل مميزات الاحترافية","فروع وموظفون بلا حد","رقم واتساب لكل فرع","حملات بلا حد وإعادة الاستهداف","شاشة «الآن يُخدم»","أولوية في الدعم"]'::jsonb,
  features_en = '["Everything in Pro","Unlimited branches & staff","A WhatsApp number per branch","Unlimited campaigns & retargeting","\"Now serving\" screen","Priority support"]'::jsonb
WHERE plan_key = 'business'
  AND features = '["كل مميزات الاحترافية","فروع وموظفون بلا حد","رقم واتساب لكل فرع","الحملات والمتابعات","شاشة «الآن يُخدم»","أولوية في الدعم"]'::jsonb;
