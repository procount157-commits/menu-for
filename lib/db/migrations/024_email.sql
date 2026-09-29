-- Email marketing.
--
-- The same shape as the WhatsApp side, on purpose: contacts and lists,
-- campaigns that enqueue messages, a follow-up ladder, and events read back
-- from the world — opens, clicks, replies, bounces — so a campaign is judged
-- by what happened rather than by what was sent. One row per email ever
-- sent, with a token that the tracking pixel, the click redirect and the
-- unsubscribe link all carry, so an event can always be tied to the message
-- and the person.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/024_email.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS email_settings (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider       VARCHAR(20) NOT NULL DEFAULT 'smtp',        -- smtp | resend | brevo
  smtp_host      VARCHAR(200),
  smtp_port      INTEGER DEFAULT 587,
  smtp_secure    BOOLEAN NOT NULL DEFAULT FALSE,
  smtp_user      VARCHAR(200),
  smtp_pass      VARCHAR(400),
  api_key        VARCHAR(400),
  from_name      VARCHAR(120),
  from_email     VARCHAR(200),
  reply_to       VARCHAR(200),
  signature      TEXT,
  hourly_cap     INTEGER NOT NULL DEFAULT 40,
  daily_cap      INTEGER NOT NULL DEFAULT 300,
  tracking       BOOLEAN NOT NULL DEFAULT TRUE,
  -- Where replies are read from. IMAP, because that is what every mailbox has.
  imap_host      VARCHAR(200),
  imap_port      INTEGER DEFAULT 993,
  imap_user      VARCHAR(200),
  imap_pass      VARCHAR(400),
  imap_last_uid  INTEGER NOT NULL DEFAULT 0,
  imap_last_error TEXT,
  -- Providers that push inbound mail post to /api/email/inbound/<this>.
  inbound_token  VARCHAR(48),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_contacts (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email          VARCHAR(254) NOT NULL,
  name           VARCHAR(160),
  company        VARCHAR(200),
  phone          VARCHAR(50),
  industry       VARCHAR(120),
  city           VARCHAR(120),
  source         VARCHAR(60),
  -- active | unsubscribed | bounced | complained
  status         VARCHAR(20) NOT NULL DEFAULT 'active',
  tags           JSONB NOT NULL DEFAULT '[]',
  mx_ok          BOOLEAN,
  last_sent_at   TIMESTAMPTZ,
  last_opened_at TIMESTAMPTZ,
  last_replied_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);
CREATE INDEX IF NOT EXISTS idx_email_contacts_user ON email_contacts (user_id, status);

CREATE TABLE IF NOT EXISTS email_lists (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(160) NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS email_list_members (
  list_id    INTEGER NOT NULL REFERENCES email_lists(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES email_contacts(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, contact_id)
);

CREATE TABLE IF NOT EXISTS email_templates (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(160) NOT NULL,
  subject    VARCHAR(300) NOT NULL,
  html       TEXT NOT NULL,
  category   VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(160) NOT NULL,
  list_id       INTEGER REFERENCES email_lists(id) ON DELETE SET NULL,
  subject       VARCHAR(300) NOT NULL,
  html          TEXT NOT NULL,
  -- draft | scheduled | sending | paused | completed
  status        VARCHAR(20) NOT NULL DEFAULT 'draft',
  scheduled_at  TIMESTAMPTZ,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  sent_count    INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  open_count    INTEGER NOT NULL DEFAULT 0,
  click_count   INTEGER NOT NULL DEFAULT 0,
  reply_count   INTEGER NOT NULL DEFAULT 0,
  bounce_count  INTEGER NOT NULL DEFAULT 0,
  unsub_count   INTEGER NOT NULL DEFAULT 0,
  pause_reason  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_sequences (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(160) NOT NULL,
  -- [{ afterHours, subject, html }]
  steps         JSONB NOT NULL DEFAULT '[]',
  stop_on_reply BOOLEAN NOT NULL DEFAULT TRUE,
  stop_on_open  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_sequence_jobs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sequence_id INTEGER NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  contact_id  INTEGER NOT NULL REFERENCES email_contacts(id) ON DELETE CASCADE,
  step_index  INTEGER NOT NULL,
  due_at      TIMESTAMPTZ NOT NULL,
  -- pending | sent | cancelled | skipped | failed
  status      VARCHAR(20) NOT NULL DEFAULT 'pending',
  message_id  INTEGER,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_seq_jobs_due ON email_sequence_jobs (status, due_at);
CREATE INDEX IF NOT EXISTS idx_email_seq_jobs_contact ON email_sequence_jobs (user_id, contact_id, status);

CREATE TABLE IF NOT EXISTS email_messages (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id     INTEGER REFERENCES email_campaigns(id) ON DELETE SET NULL,
  sequence_job_id INTEGER REFERENCES email_sequence_jobs(id) ON DELETE SET NULL,
  contact_id      INTEGER REFERENCES email_contacts(id) ON DELETE SET NULL,
  to_email        VARCHAR(254) NOT NULL,
  subject         VARCHAR(300) NOT NULL,
  -- queued | sent | failed | bounced
  status          VARCHAR(20) NOT NULL DEFAULT 'queued',
  provider_id     VARCHAR(200),
  -- Carried by the pixel, the click redirect and the unsubscribe link.
  token           VARCHAR(48) NOT NULL UNIQUE,
  -- The RFC Message-ID we sent, so a reply's In-Reply-To finds us.
  message_id_hdr  VARCHAR(300),
  sent_at         TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  open_count      INTEGER NOT NULL DEFAULT 0,
  clicked_at      TIMESTAMPTZ,
  click_count     INTEGER NOT NULL DEFAULT 0,
  replied_at      TIMESTAMPTZ,
  bounced_at      TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_messages_queue ON email_messages (user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_email_messages_campaign ON email_messages (campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_contact ON email_messages (contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_events (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES email_messages(id) ON DELETE CASCADE,
  -- open | click | reply | bounce | unsubscribe | complaint | sent | failed
  type       VARCHAR(20) NOT NULL,
  url        TEXT,
  meta       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_events_user ON email_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_inbound (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id      INTEGER REFERENCES email_contacts(id) ON DELETE SET NULL,
  message_id      INTEGER REFERENCES email_messages(id) ON DELETE SET NULL,
  from_email      VARCHAR(254) NOT NULL,
  from_name       VARCHAR(160),
  subject         VARCHAR(300),
  text            TEXT,
  message_id_hdr  VARCHAR(300),
  in_reply_to     VARCHAR(300),
  intent          VARCHAR(20),
  summary         TEXT,
  -- What the salesman would answer, waiting for a person or sent.
  draft_reply     TEXT,
  draft_subject   VARCHAR(300),
  -- new | drafted | sent | ignored
  state           VARCHAR(20) NOT NULL DEFAULT 'new',
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_inbound_user ON email_inbound (user_id, received_at DESC);
