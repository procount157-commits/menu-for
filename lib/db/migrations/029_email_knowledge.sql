-- What the owner uploads about the company and its field, for the email
-- section: each document kept whole (for passages quoted when writing), and
-- the facts نورة drew from it kept in agent_memory, tied back to it so that
-- deleting a document takes its facts with it.
CREATE TABLE IF NOT EXISTS email_knowledge_docs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  category    VARCHAR(30)  NOT NULL DEFAULT 'company',
  sector      VARCHAR(80),
  file_name   VARCHAR(255),
  content     TEXT NOT NULL,
  chars       INTEGER NOT NULL DEFAULT 0,
  status      VARCHAR(20) NOT NULL DEFAULT 'processing',
  facts       INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_knowledge_docs_user ON email_knowledge_docs (user_id, category);

ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS doc_id INTEGER REFERENCES email_knowledge_docs(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_agent_memory_doc ON agent_memory (doc_id) WHERE doc_id IS NOT NULL;
