-- The weekly report to the shop owner's phone: what the week brought, in one
-- WhatsApp message — and a record of each one so a week is never sent twice.

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS report_prefs jsonb NOT NULL DEFAULT '{"enabled":true,"weekday":0,"hour":10}'::jsonb;

CREATE TABLE IF NOT EXISTS owner_reports (
  id         serial PRIMARY KEY,
  org_id     integer NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  stats      jsonb NOT NULL,
  text       text NOT NULL,
  sent_to    jsonb NOT NULL DEFAULT '[]'::jsonb,
  manual     varchar(10),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One scheduled report per week; the owner's «send now» copies are not limited.
DROP INDEX IF EXISTS uq_owner_report_week;
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_report_week ON owner_reports (org_id, week_start) WHERE manual IS NULL;
CREATE INDEX IF NOT EXISTS idx_owner_reports_org ON owner_reports (org_id, created_at DESC);
