-- How every email looks: a branded layout (header with the logo, the message
-- in a card, a footer with the firm's details) or the plain one it had.
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS layout        VARCHAR(10) NOT NULL DEFAULT 'branded';
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS brand_name    VARCHAR(80);
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS brand_tagline VARCHAR(120);
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS brand_color   VARCHAR(9);
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS brand_accent  VARCHAR(9);
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS logo_url      TEXT;
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS website       VARCHAR(200);
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS phone         VARCHAR(40);
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS address       VARCHAR(200);
