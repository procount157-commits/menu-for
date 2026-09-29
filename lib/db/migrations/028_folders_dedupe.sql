-- Folders for lists, and a number that cannot be in a list twice.
--
-- Folders: the owner keeps lists by kind of business — real estate
-- together, cleaning companies together — for WhatsApp number lists and
-- email lists alike. A list is in one folder or none; deleting a folder
-- leaves its lists where they were, unfoldered.
--
-- Duplicates: every path that adds numbers checked for them except one,
-- and none of them would have stopped two imports racing. A unique index
-- makes "the same number twice in one list" impossible rather than unlikely.
-- Any duplicate already there is removed first, keeping the copy that has a
-- name, then the older one.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/028_folders_dedupe.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS list_folders (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- wa | email
  kind        VARCHAR(10) NOT NULL DEFAULT 'wa',
  name        VARCHAR(120) NOT NULL,
  color       VARCHAR(20),
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_list_folders_user ON list_folders (user_id, kind, sort);

ALTER TABLE contact_groups ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES list_folders(id) ON DELETE SET NULL;
ALTER TABLE email_lists    ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES list_folders(id) ON DELETE SET NULL;

DELETE FROM contacts c
 USING contacts d
 WHERE c.group_id = d.group_id AND c.phone = d.phone AND c.id <> d.id
   AND ((c.name IS NULL AND d.name IS NOT NULL) OR ((c.name IS NULL) = (d.name IS NULL) AND c.id > d.id));

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_group_phone ON contacts (group_id, phone);
