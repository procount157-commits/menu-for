-- ماجد's round needs to know which domains were asked about and when, and
-- whether the account holds back its riskiest addresses: a personal mailbox
-- at a domain where another personal mailbox already bounced (a restaurant
-- group's manager who left). On by default; such addresses are taken out of
-- the lists the team works and stay in the audience.
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS skip_risky BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE email_contacts ADD COLUMN IF NOT EXISTS mx_checked_at TIMESTAMPTZ;
